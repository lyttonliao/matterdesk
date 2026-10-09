# Chapter 3 notes: Generation in practice

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Builds on Chapter 1 (logits, softmax, temperature) and Chapter 2 (KV cache). Every number marked "measured" came from the local `llama-server` (Qwen2.5-7B Q4_K_M, M4 Pro).

**The chapter in two questions:**
1. **How does the server pick the next token from the model's probabilities?** (the sampling pipeline)
2. **Where does the time go between sending a prompt and seeing the 50th token?** (latency)

## 1. The sampling pipeline ★★★

The model outputs one score (logit) per vocabulary token. Before a token is drawn, the server runs those scores through a **chain of filters**, in a fixed order. `llama-server` reports the chain in `GET /props` (`samplers`):

```
penalties → dry → top_n_sigma → top_k → typ_p → top_p → min_p → xtc → temperature → (draw)
```

- **Truncation samplers** (`top_k`, `top_p`, `min_p`) throw away unlikely tokens so a rare bad token can never be drawn.
- **Temperature** then reshapes whatever is left.
- **Penalties** (repetition, presence, frequency) lower the score of tokens that already appeared. Off by default here (`repeat_penalty` 1.0).
- The draw is random but **seeded**: the same `seed` and settings give the same token (see section 3).

**Key point: temperature comes last.** Truncation happens first, on the unscaled probabilities. Section 3 shows what that does.

## 2. The three truncation samplers ★★★

**What they do:** each one cuts the list of candidate tokens down to a shortlist, then the probabilities are renormalized to add to 1.

| Sampler | Rule | Server default |
|---|---|---|
| **top-k** | Keep the *k* most likely tokens. | 40 |
| **top-p** (nucleus) | Keep the fewest top tokens whose probabilities add up to *p*. | 0.95 |
| **min-p** | Keep tokens with probability ≥ *min_p* × (the top token's probability). | 0.05 |

**Worked example (measured):** the real next-token distribution after `"The tenant shall pay rent on the first day of the"`:

| token | probability | cumulative |
|---|---|---|
| ` month` | 84.62% | 84.62% |
| ` lease` | 3.40% | 88.02% |
| ` rental` | 3.14% | 91.15% |
| ` first` | 2.21% | 93.36% |
| ` calendar` | 1.18% | 94.54% |
| ` ten` | 0.57% | 95.10% |
| ` term` | 0.49% | 95.59% |
| ... | ... | ... |

- **top-k 40:** keeps 40 tokens. Barely a cut here (the tail beyond 40 is tiny).
- **top-p 0.95:** walk down until the cumulative reaches 95%. That happens at ` ten` (95.10%), so **6 tokens** survive.
- **min-p 0.05:** threshold = 0.05 × 84.62% = **4.23%**. ` lease` (3.40%) is below it, so **only ` month` survives**.

**Why min-p exists:** its cutoff scales with the leader. When the model is confident (84%), it cuts almost everything; when the model is unsure (top token 10%), the cutoff drops to 0.5% and many tokens survive. A fixed top-k can't adapt like that.

## 3. Measured: truncation runs before temperature ★★★

Experiment: 60 draws of the same next token at **T = 2** with different seeds (`n_predict: 1`), under different truncation settings.

| Settings | What came out (60 draws) |
|---|---|
| Server defaults (top-k 40, top-p 0.95, min-p 0.05) | ` month` **60 of 60** |
| Only top-k 40 | ` month` 24; ` rental`, ` (`, ` ten`, ` tenant`, ` rent`, ... |
| Only top-p 0.95 | ` month` 33; ` first` 8, ` lease` 7, ` calendar` 6, ` rental` 5, ` ten` 1 |
| No truncation (top-k 0, top-p 1, min-p 0) | ` month` 7; ` first`, ` ten`, ` beginning`, ` calendar`, ... and one garbage token |

**Full sweep (`labs/day1/temperature-sweep.ts`, 100 draws per row, seeds 0-99):**

| Truncation | T | ` month` | Distinct tokens drawn |
|---|---|---|---|
| defaults | 0, 0.5, 1, 2 | 100% | 1 |
| off | 0 | 100% | 1 |
| off | 0.5 | 98% | 2 |
| off | 1 | 82% | 12 |
| off | 2 | 8% | 83 |

- Off at T=1 matches the model's own distribution (84.6%; 82% is within sampling noise for 100 draws).
- Off at T=2: ` month` falls to 8%, and 100 draws gave 83 different tokens, which is close to noise.

What this means:
- With the defaults, **T = 2 changed nothing**: min-p had already reduced the shortlist to ` month` alone, and temperature can only reshape tokens that are still in the list.
- Temperature cannot bring back a token a truncation sampler removed. **To see the effect of temperature, switch truncation off** (`top_k: 0, top_p: 1.0, min_p: 0.0`). Without truncation, T = 2 produces junk, including a nonsense token.
- This corrects Chapter 1's "at T=2 a wrong token is ~40% likely at every step": true only with truncation disabled. With the server defaults, truncation protects you.
- **Practical rules:** for factual or legal output, keep truncation on and use a low T. Don't conclude "temperature is harmless" from a test run with defaults. Test the settings you will actually ship.

**Seed:** each request above used `seed: s`. The same seed and settings reproduce the same draw. For audits and tests, log the seed with every request.

## 4. Where the time goes ★★★

A request has two phases (Chapter 2 gave the cache; here are the clocks):

1. **Prefill:** the server reads the whole prompt at once and fills the KV cache. You wait; nothing streams yet.
2. **Decode:** the server generates one token at a time, each one streamed as it is produced.

Three numbers describe it:

| Metric | Meaning | Governed by |
|---|---|---|
| **TTFT** (time to first token) | Request sent → first token arrives | Queueing + prefill. Grows with *uncached* prompt length. |
| **Decode speed** (tokens/s); its inverse is time per output token (TPOT) | Pace once streaming starts | Memory reads per token. Slows as context grows. |
| **Total time** | TTFT + (output tokens × TPOT) | Both. |

**Measured (`stream-bench.ts`):**

| Run | TTFT | Decode | Server `prompt_n` / `cache_n` |
|---|---|---|---|
| Short prompt | 0.32 s | 49.8 tok/s | 15 / 24 |
| 17k prompt, cold | 47.36 s | 37.4 tok/s | 17,045 / 0 |
| Same 17k prompt, warm | 0.04 s | 39.0 tok/s | 1 / 17,044 |

**Worked total for a 500-token answer:**
- Short prompt: 0.32 + 500 / 49.8 ≈ **10.4 s**.
- 17k prompt, cold: 47.4 + 500 / 38 ≈ **60.5 s**. About 78% of that is the wait before anything appears.
- 17k prompt, warm: 0.04 + 500 / 38 ≈ **13.2 s**.

Lessons for building the app:
- **Prefill dominates for long documents.** Law-firm prompts stuffed with contract text are exactly the cold-cache case.
- **Put stable text first, variable text last.** The cache matches only a shared *prefix*. A system prompt and document placed before the user's question can be reused; a timestamp at the top (the lab's `nonce`) throws it all away.
- **Stream the output.** The user sees tokens after the TTFT instead of waiting for the whole answer.

## 5. Why prefill and decode behave differently ★★★

- **Prefill is compute-bound.** All 17,045 prompt tokens go through the model in parallel, so each weight loaded from memory is used for thousands of tokens' worth of arithmetic. The limit is how fast the chip can do math: measured **≈ 360 tokens/s**.
- **Decode is memory-bandwidth-bound.** Each new token needs one pass over *all* the weights (4.68 GB) plus the KV cache, but only a few arithmetic operations per weight. The limit is how fast memory can be read.

**Check against the measurements (an estimate):**
- Short prompt: 49.8 tok/s × 4.68 GB per token ≈ **233 GB/s** of memory traffic.
- The earlier note puts the machine's memory bandwidth at 273 GB/s (recalled, not re-measured), so decode reached roughly **85%** of the theoretical ceiling (273 / 4.68 ≈ 58 tok/s).
- At 17k context the cache adds ~1 GB (16,990 × 57,344 bytes ≈ 0.97 GB) to every token's reads: 233 / (4.68 + 0.97) ≈ **41 tok/s** predicted vs 37-39 measured. Close.
- **Quantization speeds up decode** because the weights are smaller: Q4 reads about a quarter of the bytes FP16 would (4.68 GB vs ~15.2 GB), so the ceiling is about 4x higher. This is the setup for Day 2.

**Weights are static; the data flowing through them is not.** The weights are fixed after training: the same 7.6 billion numbers serve every token and every request. What changes per token is the 3,584-number token vector that gets multiplied by them. Prefill loads each weight once and uses it for every prompt token in the batch (many multiply-adds per memory read). Decode loads each weight to use it for a single token (one multiply-add per memory read).
- Rough math (about 2 operations per parameter per token): one token ≈ 15 billion operations. Prefill at 360 tok/s ≈ 5.5 trillion operations/s; decode at 50 tok/s ≈ 0.76 trillion/s with memory nearly saturated.
- Caveat: the server probably processes a long prompt in chunks (weights reloaded per chunk). Chunk size not verified.

**Where weights come from (training, not softmax).** Weights are learned once: start random, predict the next token over trillions of tokens of text, compute a loss = −ln(probability given to the correct token), use backpropagation to find how each weight contributed, nudge every weight to shrink the loss, repeat. Our ` month` example: the model gave 84.62%, loss = −ln(0.8462) ≈ 0.17 (tiny correction); at 1% the loss would be 4.6 (big correction). Softmax produces the probabilities the loss looks at, but the weights are what gets adjusted. At inference nothing is learned; the GGUF is read-only. Fine-tuning (later) runs the same loop on a small dataset from existing weights.

## 6. Small details seen in the lab ★

- **Token count mismatch:** the client counted 25 content chunks; the server reported `predicted_n` = 26. Probably the end-of-sequence token, which has no text. Not verified.
- **Chat template prefix is cached:** the short run showed `cache_n` = 24: the Qwen chat-template tokens that every chat request starts with (system block), left over from an earlier request.
- **`/completion` vs `/v1/chat/completions`:** the first takes raw text; the second applies the model's chat template to `messages`. Use the chat endpoint for instruct models.

## Next
1. Day 2: quantization script.

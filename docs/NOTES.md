# Notes

Summary notes for `COURSE.md` / `PLAN.md`. Importance: **★★★ must know** · **★★ should know** · **★ reference, look up when needed**.

## RESUME HERE (for a fresh session)

- **Done:** Chapter 1 read. Lab 1 steps 1-3 (`labs/day1/tokenize.ts`, `completion.ts`, `generate.ts`), all typecheck.
- **Lab 1 step 4 done:** `labs/day1/temperature-sweep.ts` (results in `NOTES-ch3.md` section 3).
- **Chapters 2-4 done:** notes in `docs/NOTES-ch2.md`, `-ch3.md`, `-ch4.md`. Streaming client built (`labs/day1/stream.ts`, `stream-bench.ts`, committed). Chapter 4 notes written (`docs/NOTES-ch4.md`). **Next: Day 2 (quantization script).**
- **Server:** `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8080` (blocks the terminal; use a separate tab). Check with `curl localhost:8080/health`.
- **Lab code:** `labs/day1/` (`node file.ts`, `npm run typecheck`).
- **How we work:** book-style teaching with concrete numbers from this project; explain a command and its flags before running it; the user writes the lab code and I review it; no quizzes of any kind (user wants to move faster into development); typecheck before commit; no `Co-Authored-By` trailer.

---

# Chapter 1: Language models as probability machines

## 1. What a model is ★★★

A language model is a function: `f(sequence of tokens) -> a probability for every token in the vocabulary`.

- **Token:** a piece of text from a fixed vocabulary (~152k entries for Qwen2.5). Not a character, not a word. Common words are one token; rare strings (citations, party names) fragment.
- **Parameters** (the "B" in 7B): the learned numbers inside `f`. Fixed at inference.
- **One decode step outputs one list of ~152k scores**, one per vocabulary token. The 152k is the vocabulary size, not the weight count.

## 2. The generation loop ★★★

1. Tokenize the prompt.
2. One forward pass produces the next-token distribution. Sample **one** token.
3. Append it and repeat until the end-of-sequence token (EOS).

- Each output token is the next input, so **decode is serial** for one request. Parallelizable: prompt tokens (prefill), different requests (batching), and the math inside a step.
- You walk one path, not a tree. Nothing checks truth, so fluent fabrication is built in.

## 3. Logits, softmax, temperature ★★★

**Logit:** the raw score the model assigns to each vocabulary token at one step. A real number, can be negative, unbounded. It is *not* a probability (doesn't sum to 1). Only the **differences** between logits matter.

**Softmax with temperature `T`** turns logits `z` into probabilities:

```
p_i = exp(z_i / T) / Σ_j exp(z_j / T)
```

1. **Exponentiate:** makes everything positive and turns a score gap Δ into a probability ratio `e^Δ` (a gap of 3.2 means 24x as likely).
2. **Divide by the sum:** makes the probabilities add to 1.
- Adding a constant to every logit changes nothing (it cancels). That is why only gaps matter.
- **Temperature divides the logits, so it scales every gap by 1/T.** The ratio between two tokens becomes (original ratio)^(1/T).

**Behaviour at the extremes:**

| T | Gaps | Result |
|---|---|---|
| **→ 0** | blow up (÷ tiny number) | Top token → 100%, others → 0. **Greedy decoding (argmax).** T=0 is implemented as a special case, since 1/0 is undefined |
| **1** | unchanged | The model's native distribution |
| **→ ∞** | shrink to 0 | Every token → 1/152k (about 0.0007%): uniform noise |

**Worked example (real numbers).** Logits recovered from the logprobs of `"The tenant shall pay rent on the first day of the"`. Gap below `' month'`: lease 3.216, rental 3.295, first 3.647, calendar 4.276. Softmax over these five only (the real server numbers are lower for `' month'` because a ~5.5% tail is excluded):

| T | `' month'` | `' lease'` | `' rental'` | `' first'` | `' calendar'` |
|---|---|---|---|---|---|
| 0.5 | 99.6% | 0.2% | 0.1% | 0.1% | 0.0% |
| 1 | 89.5% | 3.6% | 3.3% | 2.3% | 1.2% |
| 2 | 59.8% | 12.0% | 11.5% | 9.7% | 7.0% |

- Low T concentrates probability on the leader; high T spreads it to the tail. At T=2 a wrong token is ~40% likely at every step, and each wrong token changes the context for everything after it, so long outputs drift. **Caveat (measured, Chapter 3 section 3): this holds only with truncation off. With the server defaults, T=2 still returned `' month'` 60/60 times, because top-k/top-p/min-p run before temperature.**
- **Logprob:** `logprob = z/T − log Σ exp(z_j/T)`, and `p = exp(logprob)`. Near 0 means near-certain; each −1 divides the probability by ~2.7.
- **The sampled token is not the top token unless T=0.** At the server default T=0.8, a 6.2% token (`' at'`) was drawn while a 26.3% one (`.`) was available.
- **Truncation:** top-k (40), top-p (0.95) and min-p (0.05) cut off the tail before sampling. **Server default is T=0.8**, neither native nor greedy: set sampling explicitly whenever you want reproducibility.
- **Greedy is not guaranteed bit-identical across runs** (batching and floating-point order can change the last digits; the sampled token only flips on a near-tie). For audit and tests, pin the seed and settings and log them.

## 4. Weights vs. context; the model is a pure function ★★★

| | Weights | Context |
|---|---|---|
| Size | Fixed (4.7 GB here) | Grows per request |
| Changes at inference | Never | Every request |
| Holds | General learned knowledge | The contract, the question |

- **Weight memory = parameters x bytes per parameter:** 7.6B x 2 bytes (FP16) ≈ 15 GB; 7.6B x ~4.85 bits (Q4_K_M) ≈ 4.6 GB.
- The model keeps **no memory between calls**. A conversation works because the app resends the history each turn (like HTTP statelessness). So history, retrieved documents and audit logs are the app's to store and secure; they can contain privileged content.
- The model has **no access control**: it uses anything in its context. Permissions must be enforced *before* text enters the context. Hence RAG (retrieve text into the context), since the firm's matters are never in the weights.

## 5. Why prompt rules fail and Row-Level Security (RLS) works ★★★

- A prompt rule ("don't reveal other matters") is just more text. It's a probabilistic request, defeated by prompt injection, or by retrieval that already put Matter B text into the prompt.
- **RLS** is a Postgres policy on every query from that connection: rows the user can't see are never returned, so they never reach the context.
- Conditions for "always":
  - The app must connect as a plain role: **superusers, `BYPASSRLS` roles and table owners (unless `FORCE ROW LEVEL SECURITY`) bypass RLS.**
  - Set the session variable per request with `SET LOCAL` inside a transaction. With connection pooling, a stale value is a cross-user leak.
  - Test the policies. RLS doesn't cover copies in caches, logs, traces or fine-tuned weights.
- **Where a Matter B answer can leak:** retrieval, context, shared state (shared prefix/answer cache, logs, a tool that fetches by ID without a check), fine-tuned weights. Enforce in the database and application layers, never in the model.

## 6. Tokenization ★★★

BPE (byte-pair encoding) starts from bytes and repeatedly merges the most frequent adjacent pairs.

- **The leading space belongs to the token:** `' of'` ≠ `'of'`. Mid-sentence words arrive space-prefixed. Trailing whitespace on a prompt becomes its own token and distorts the next-token distribution, so trim prompts.
- **Digits are single tokens in Qwen** (`12` → `1`, `2`). Amounts, dates and section numbers are many tokens. `$1,250,000` should be about 10 (expected, not yet measured).
- **Token boundaries ≠ logical boundaries.** Measured with `/tokenize`:

| Input | Tokens | Chars/token |
|---|---|---|
| `Change of Control` | `Change`, ` of`, ` Control` (3) | 5.7 |
| `§ 12.3(b)(iv)` | `§`, ` `, `1`, `2`, `.`, `3`, `(b`, `)(`, `iv`, `)` (10) | 1.3 |
| `Acme Holdings, LLC` | `Ac`, `me`, ` Holdings`, `,`, ` LLC` (5) | 3.6 |

- The same logical string tokenizes differently by neighbours (`(iv)` alone is `(iv` + `)`; inside a citation it is `iv` + `)`). The model must *learn* the equivalence, so it can misquote or transpose. This is why **hybrid search** (exact full-text plus vector, Day 6) exists.
- **Budget tokens with the real tokenizer** (`/tokenize`), never from characters or words: a fourfold spread between normal text and citations.
- **Numbers are fragile.** Each digit is a separate sampled choice with no look-ahead, so errors compound (0.99^7 ≈ 93%, 0.95^7 ≈ 70%). Copying a number from the context is easy; recalling or computing one is not. **Never trust a generated number without checking it against the source.**

## 7. Failure modes ★★

1. **Sampling nondeterminism:** same prompt, different outputs (matters for audit, tests).
2. **Tokenization surprises:** exact-match strings fragment unpredictably.
3. **Confident fabrication:** a high-probability continuation is not a verified fact.

---

# Hardware and performance

## Prefill vs. decode ★★★

- **Prefill** processes the prompt in parallel: **compute-bound**.
- **Decode** makes one token per step and reads every weight once, using each for ~2 math operations: **memory-bandwidth-bound**.
- **Speed ceiling = memory bandwidth / model bytes** = 273 GB/s / 4.7 GB ≈ 58 tokens/s (M4 Pro). Real numbers land lower.
- Quantization speeds up decode because fewer bytes are read per token. GPU sizing is built on this (Chapters 4 and 18).

## KV cache (Chapter 2 verifies this) ★★★

- Every processed token leaves a **key (K) vector** and **value (V) vector** at every layer; later tokens attend to them. Caching avoids recomputing the whole history each step.
- **Per-token size = 2 (K, V) x layers x KV heads x head dimension x bytes.** Qwen2.5-7B, *recalled from memory, verify*: 28 layers, 4 KV heads, head dim 128, FP16 → 2 x 28 x 4 x 128 x 2 = **57,344 bytes ≈ 57 KB/token**. A full 131,072-token context ≈ **7.5 GB**, on top of the 4.7 GB weights.
- **The cache grows with context, not with the weights:** it's a record of *this input*, one entry per token (linear in length). Depends on model shape (layers, KV heads, head dim), not directly on parameter count. Grouped-query attention (4 KV heads vs. 28 query heads) shrinks it ~7x.
- **Why it matters (observed, 11-token prompt, `cache_prompt: true`):**

```
call 1: prompt_n=1 cache_n=10   (prompt was already cached from an earlier run)
call 2: prompt_n=1 cache_n=11   (11-token prefix reused, only ' month' processed)
```

  - Generating 20 tokens from an 11-token prompt: **410 token evaluations without a cache** (11 + 12 + … + 30) vs. **30 with it** (11 + 19). Quadratic vs. linear.
  - The server matches the longest common **token prefix**. Re-tokenizing the concatenated text can shrink the match.
  - **Even a full match re-runs the last token:** sampling needs the logits from the last position, and logits are not stored in the KV cache. A cache hit saves the shared prefix; every request still costs ≥ 1 forward pass.
  - Not yet observed: a cold start should show `prompt_n=11, cache_n=0`.
- Open: is the 7.5 GB total or per slot? Measure memory idle vs. after a long prompt.

## Key terms ★★

| Term | Meaning |
|---|---|
| GGUF | One file holding weights, tokenizer and metadata. Made for llama.cpp |
| Quantization | Fewer bits per weight. `Q4_K_M`: ~4 bits, K = block-wise K-quant, M = medium size/accuracy mix |
| Instruct vs. base model | Instruct follows chat instructions; base only continues text |
| Unified memory + Metal | Apple Silicon: CPU and GPU share RAM; Metal is the GPU API. Docker on macOS has no Metal, so run the model natively and everything else in Docker |
| OpenAI-compatible API | `/v1/chat/completions` keeps app code portable across llama.cpp, Ollama, vLLM |

---

# llama-server cheat sheet ★

Hardware: Apple M4 Pro, 48 GB unified memory, 273 GB/s.

**Run:** `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8080`
- `-hf` downloads from Hugging Face (`:Q4_K_M` picks the quantization); cached under `~/Library/Caches/llama.cpp`. Pin `--port` explicitly (the default will change).
- Binds to `127.0.0.1`. **No API key and CORS allows all origins**, so any web page in your browser can hit it. Lock down on Day 12.
- Startup log: `n_slots = 4` (four concurrent conversations), `n_ctx_slot = 131072`, `kv_unified = true` (slots share one KV pool).

| Endpoint | Purpose |
|---|---|
| `GET /health` | `{"status":"ok"}` once loaded |
| `GET /props` | Server and default generation settings |
| `POST /tokenize` | `{"content": "<one string>"}` → IDs; add `"with_pieces": true` for pieces. An array input is concatenated into one flat list, so send one request per string. No `/v1` prefix |
| `POST /completion` | Raw completion: `prompt`, `n_predict`, `n_probs`, `temperature`, `cache_prompt` |
| `POST /v1/chat/completions` | Chat with `messages` of `{role, content}`, wrapped in the chat template. Answer in `choices[0].message.content`; `usage` and `timings` included |

**`/completion` response:**
- `content` is the **sampled** token. `completion_probabilities[0].top_logprobs` is the ranked candidate list (logprobs, convert with `Math.exp`).
- **`post_sampling_probs: false` (default): reported probabilities exclude temperature, top-k and top-p, so changing T won't change them.** Set it `true` to see the post-temperature distribution (inferred from the field name; confirm in step 4).
- **`stop` is `true` on every `n_predict: 1` response** (`stop_type: "limit"`). Use `stop_type === "eos"` for end-of-sequence.
- Measured top 5 for the lease prompt: `' month'` 84.6%, `' lease'` 3.4%, `' rental'` 3.1%, `' first'` 2.2%, `' calendar'` 1.2% (sum 94.5%). Peaked because it's a near-fixed idiom; a flat example (`"...hitting an SIR in "`) gave `2` 26.3%, `3` 24.8%, `1` 20.9%, `5` 13.1%, `4` 7.2%.

---

# TypeScript lessons from the lab ★★

- `tsc` passing ≠ it works: a scheme-less URL typechecks and fails at runtime. `fetch` hides the cause; read `error.cause`.
- `response.json()` is `any`; `as Type` is a compile-time claim, not validation. Validate at boundaries.
- Don't swallow errors by returning `null` from `catch`: callers can't tell "no data" from "server down".
- **Awaiting in a loop is correct when each iteration depends on the previous one** (generation). Independent requests belong in `Promise.all`. Suppress the lint with a reason (`// NOSONAR: ...`).
- Prefer top-level `await generate(...)` over a bare call: a rejection then crashes loudly instead of vanishing. Needs `"type": "module"` and `module: nodenext`.
- Never put response fields (`timings`) in the request `kwargs`; the server silently ignores them.
- Parameterize with a typed options object: `generate(text, { maxTokens = 30, temperature = 0 } = {})`.

---

# Mistakes to remember ★★

- **Predicting a sentence-ending frame:** at "first day of the ___" the model completes an *idiom* (`' month'`), it doesn't pick a subject. Candidates are alternatives for the next slot, all space-prefixed.
- **Sampled ≠ top:** `' at'` (6.2%) was a random draw at T=0.8; the T=0 pick was `.` (26.3%). Lowering T makes the leader *more* likely, and runner-ups less.
- **Cache counters are per call:** call 2 is `prompt_n=1, cache_n=11` (the 30 in my earlier example was the whole run's total).

# Open questions
- ~~Q4_K_M bits/weight~~ Answered (Chapter 4, section 3): 4.913 for this model = 80% Q4_K at 4.5 bits + 20% Q6_K at 6.5625 bits. The usual 4.85 is a generic figure that varies per model.
- ~~Is the KV cache budget total or per slot?~~ Answered (Chapter 2, section 8): total, one shared pool (inferred from memory size).

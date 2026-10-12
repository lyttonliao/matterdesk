# Chapter 6 notes: Architectures at scale (Mixture-of-Experts and Multi-head Latent Attention)

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Builds on Chapter 2 (KV cache, grouped-query attention) and Chapter 4 (capacity vs bandwidth). Model dimensions below were read from the public `config.json` files of DeepSeek-V3 and Mixtral-8x7B on Hugging Face; all parameter and cache counts are computed from them (arithmetic, not run on a machine). Statements marked "recalled" come from memory.

## 0. The big picture ★★★

Two problems appear as models get large, and each of these two ideas solves one:

| Problem | Idea | One-line summary |
|---|---|---|
| Every token has to read **all** the weights, so a bigger model is slower per token (Chapter 4). | **Mixture-of-Experts (MoE)** | Keep a huge pool of weights, but let each token use only a small part of it. |
| The KV cache (Chapter 2) grows with context and gets enormous for big models. | **Multi-head Latent Attention (MLA)** | Store a small compressed summary of each token's keys and values instead of the full ones. |

- **Dense model** = what we've used so far (Qwen2.5-7B): every weight is used for every token.
- DeepSeek-V3 uses both ideas: MoE for the weights, MLA for the cache. The Day 2 goal "explain why MoE is cheap per token but expensive to host" is section 3.

## 1. Mixture-of-Experts (MoE) ★★★

**Where the idea comes from.** In Chapter 4 we saw most of a layer's weights sit in the **feed-forward step**: 204M of Qwen2.5-7B's 233M weights per layer. MoE replaces that one big feed-forward block with many smaller ones called **experts**, and a **router** chooses which experts each token uses.

**How one MoE layer works:**
1. The token's vector goes to the **router**, a small matrix that outputs one score per expert.
2. The top few scores are picked (top-*k*), e.g. the best 2 of 8, or 8 of 256.
3. Only those experts run on the token. Their outputs are added together, weighted by the router's scores.
4. The other experts do nothing for this token: their weights are not read, and no math is spent on them.

- The choice is made **per token and per layer**, so different tokens in the same sentence use different experts, and a token uses different experts in different layers.
- Attention layers are normal (shared by every token). Only the feed-forward part is split into experts.
- "Experts" do not map to neat topics like "law" or "code" in any reliable way (recalled). They are just learned sub-networks the router has learned to send tokens to. Training also includes a push to spread tokens evenly across experts, so a few experts don't get overloaded and the rest sit idle.
- **Shared expert:** DeepSeek-V3 also has one expert that every token always uses, besides the routed ones.

**Real examples** (from `config.json`; parameter totals computed):

| | Experts per layer | Used per token | Total parameters | Active per token |
|---|---|---|---|---|
| Mixtral-8x7B | 8 | 2 | 46.7B (computed) | 12.7B (computed; published ~13B, recalled) |
| DeepSeek-V3 | 256 routed + 1 shared | 8 routed + 1 shared | 670.9B (computed; published 671B) | 36.5B (computed; published 37B) |

- DeepSeek-V3's checkpoint file holds 684.5B parameters; the extra ~14B are an auxiliary multi-token-prediction module (recalled), not part of the 671B count.
- **Parameter breakdown for DeepSeek-V3:** one expert = 3 matrices of 7,168 × 2,048 = 44.0M weights. 58 of its 61 layers are MoE (the first 3 are dense), each with 257 experts = 11.3B weights per layer. Experts total 656.5B of the 671B. Attention is only ~11B across all layers.
- Notation: "8x7B" does not mean 8 × 7B = 56B. The experts only replace the feed-forward part; attention and embeddings are shared. So Mixtral is 46.7B, not 56B.

## 2. Multi-head Latent Attention (MLA) ★★★

**The problem.** Chapter 2: the cache stores a key and value per token per layer per KV head. DeepSeek-V3 has 61 layers and 128 attention heads. If it cached full keys and values like plain multi-head attention, each token would need:
- 128 heads × (128 + 64 key numbers) + 128 heads × 128 value numbers = 40,960 numbers per layer
- × 61 layers × 2 bytes (BF16, a 16-bit format) = **4,997,120 bytes, about 5.0 MB per token**
- At 131,072 tokens of context: **655 GB** for one conversation. Impossible.

**Chapter 2's fix (GQA)** shares keys and values between heads. With 8 KV heads it would be 8 × (192 + 128) = 2,560 numbers per layer = 312,320 bytes per token (4.4x more than MLA below).

**MLA's fix: compress instead of share.**
- Instead of storing each head's key and value, store **one small vector per token per layer** (a "latent": 512 numbers) made by multiplying the token's vector by a learned matrix that squeezes it down.
- When attention runs, the full keys and values are **rebuilt from that latent** by a second learned matrix. Rebuilding is cheap math. (In practice, the rebuilding matrices are folded into the query and output matrices so the full keys and values are never materialized; recalled.)
- Why compression works: the 128 heads' keys and values are highly redundant, so the information fits in a much smaller space. In linear-algebra terms the 40,960 numbers are approximately **low-rank**: they can be rebuilt from far fewer numbers.
- **Position encoding complication:** the rotary position signal (RoPE, how the model knows token order) can't be folded into the compressed form, so a small separate 64-number key carrying position is cached too.

**Cache size with MLA** (from `config.json`: `kv_lora_rank` = 512, `qk_rope_head_dim` = 64):
- (512 + 64) numbers × 61 layers × 2 bytes = **70,272 bytes per token** (70 KB).
- That is **71x smaller** than plain multi-head, and 4.4x smaller than GQA with 8 KV heads.
- At 131,072 tokens: 9.2 GB instead of 655 GB.

**Comparison with our model:** Qwen2.5-7B's cache is 57,344 bytes per token. DeepSeek-V3, a model 88x larger (671B vs 7.6B parameters), needs only 70,272 bytes per token: 1.2x more. MLA makes the cache almost independent of model size.

| Scheme | Idea | Cache per token (model) |
|---|---|---|
| Plain multi-head | every head stores its own K and V | 5.0 MB (DeepSeek-V3 shape, hypothetical) |
| GQA | heads share K/V | 57 KB (Qwen2.5-7B); 312 KB (DeepSeek-V3 shape with 8 KV heads, hypothetical) |
| MLA | store a compressed latent, rebuild K/V | 70 KB (DeepSeek-V3, real) |

## 3. Why MoE is cheap per token but expensive to host ★★★

Two different budgets (Chapter 4: capacity and bandwidth) are governed by two different numbers:

| Budget | Set by | DeepSeek-V3 |
|---|---|---|
| **Capacity** (all weights must sit in memory) | **Total** parameters | 671B. At 8 bits per weight (FP8, recalled as the format DeepSeek released): ~671 GB. At Q4_K_M's 4.91 bits: ~412 GB. Either way, far beyond one GPU or this 48 GiB laptop. |
| **Speed per token** (weights read and math done) | **Active** parameters | 37B: about the cost of a 37B dense model, roughly 18x cheaper than reading all 671B. |

- **Cheap per token:** a token only touches ~37B weights, so decode speed behaves like a mid-sized dense model (bandwidth ÷ active bytes, Chapter 4).
- **Expensive to host:** you still have to keep all 671B in memory, because you don't know in advance which experts the next token will pick. So you need a multi-GPU server (e.g. 8 GPUs with 141 GB each = 1.1 TB, recalled) even though each token uses a small slice.
- **Batching erodes the advantage.** In Chapter 4, batching shared one read of the weights across many users. With MoE, different tokens pick different experts, so a batch spreads over the pool. Expected number of distinct routed experts touched per layer by a batch (computed assuming the router spreads tokens evenly, 8 picks per token, 256 experts):

| Tokens in the batch | Experts touched per layer (of 256) |
|---|---|
| 1 | 8 (3%) |
| 8 | 57 (22%) |
| 64 | 221 (87%) |
| 256 | 256 (100%) |

  So a busy server reads nearly the whole model every step, and MoE's per-token bandwidth saving mostly disappears; what remains is the saving in math. MoE shines most for single-user decoding, and in compute (arithmetic is proportional to active parameters). It matters that real routers are not perfectly even, so this is an estimate.
- **Other costs (recalled):** expert weights are often spread across several GPUs, which adds network traffic to send tokens to their experts; and if a few experts get most of the traffic, those GPUs become bottlenecks.

## 4. What it means for our project ★★

- **Local model choice:** a laptop is limited by capacity (48 GiB), not by active parameters. A 30B-class MoE with ~3B active parameters (recalled example: Qwen3-30B-A3B) would be fast to decode but still need ~18 GB at Q4 just to load. A dense 7-8B model needs ~5 GB. The fit comes from the total parameter count.
- **DeepSeek-R1 distilled** (planned for Day 1): the "distilled" variants are small dense models (Qwen or Llama based, recalled) trained to imitate the large MoE model, so they use none of these ideas. The full R1 is a 671B MoE like V3.
- **Serving many users with long contracts** (this project): the cache is what grows with context and users (Chapter 4, section 6). MLA is the design answer; for models without it, cache size is the capacity-planning number.
- **Reading a model card:** look for "total parameters" (capacity) and "active parameters" (speed), the number of KV heads or an MLA latent size (cache cost), and the context length.

## Next
1. This finishes Day 1-2's reading. Day 2's lab is written but not run (`labs/day2/quantize-bench.ts`).
2. Day 3: schema, auth and Row-Level Security (RLS) for the application, which is where the project's real building starts.

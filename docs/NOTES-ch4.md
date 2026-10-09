# Chapter 4 notes: Memory and bandwidth

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Builds on Chapter 2 (KV cache size) and Chapter 3 (prefill vs decode). "Measured" = from the local `llama-server` (Qwen2.5-7B Q4_K_M) on an Apple M4 Pro with 48 GiB of unified memory (`sysctl hw.memsize` = 51,539,607,552 bytes). Anything marked "estimate" is arithmetic from published specs.

**The chapter in one sentence:** generating text is mostly a job of *moving bytes*, so the cost of a model is set by how many bytes it has (weights + cache) and how fast they can be read.

## 1. Two budgets: capacity and bandwidth ★★★

| Budget | Question it answers | Unit | What breaks if you exceed it |
|---|---|---|---|
| **Capacity** (memory size) | Does it fit? | GB | The model can't load, or the server crashes / swaps. |
| **Bandwidth** (memory speed) | How fast does it run? | GB/s | Nothing breaks; tokens per second drop. |

On this machine memory is **unified**: the CPU and GPU share the same 48 GiB. On a discrete GPU server the same two budgets apply to the GPU's own memory (called VRAM), which is smaller and more expensive.

## 2. Capacity math: does it fit? ★★★

**Formula:** weights bytes = parameters × bits per weight ÷ 8. Then add the KV cache (Chapter 2: 57,344 bytes per token for this model) and some overhead for temporary buffers.

Qwen2.5-7B (7.6 billion parameters) at different precisions (estimates, except the measured Q4_K_M):

| Precision | Bits/weight | Weights size | Decode ceiling at 273 GB/s |
|---|---|---|---|
| FP16 | 16 | 15.2 GB | 18 tok/s |
| Q8_0 | 8.5 | 8.1 GB | 34 tok/s |
| **Q4_K_M** | **4.91 (computed from the file)** | **4.68 GB (measured)** | **58 tok/s** (measured: 50) |

Preview of Day 2's "70B on paper" exercise (estimates, 70B parameters):
- FP16: 140 GB. Does not fit in 48 GiB (51.5 GB) at all.
- Q4_K_M at ~4.91 bits: ~43 GB. Fits, barely, leaving ~8 GB for cache and the OS. Decode ceiling ≈ 273 / 43 ≈ **6 tok/s**.
- Rule: a bigger model is slower in proportion to its bytes, because every token reads all of them.

**Measured on this server:** the KV cache for the full 131,072-token context is allocated at startup (Chapter 2, section 8), so the footprint was ~7.3 GB idle: 4.4 GB weights (memory-mapped) + ~7.2 GB cache and buffers, regardless of use. Shrinking `-c` frees that memory immediately.

## 3. Bandwidth math: how fast does it run? ★★★

**Decode ceiling = memory bandwidth ÷ bytes read per token.**
- Each generated token reads all the weights (4.68 GB) plus the KV cache of that conversation.
- The M4 Pro's published bandwidth is 273 GB/s (recalled from the spec sheet, not measured here). Ceiling: 273 / 4.68 ≈ 58 tok/s.
- Measured: 50 tok/s with a short context = **233 GB/s of effective traffic, about 85% of the ceiling**.
- At 17k context the cache adds ~0.97 GB per token: predicted ≈ 41 tok/s, measured 37-39.

So decode speed can be predicted with a pencil before running anything. This is how you size hardware.

## 3b. What a weight is, and where the 4.91 bits comes from ★★

**A weight** is one learned number. Weights are stored as matrices (grids) plus a few 1-D vectors, read from the GGUF tensor directory. Layer 0 of Qwen2.5-7B:

| Tensor | Shape (inputs × outputs) | Purpose | Weights |
|---|---|---|---|
| `attn_q` | 3584 × 3584 | queries (28 heads × 128) | 12,845,056 |
| `attn_k`, `attn_v` | 3584 × 512 | keys, values (4 KV heads × 128) | 1,835,008 each |
| `attn_output` | 3584 × 3584 | mixes the heads | 12,845,056 |
| `ffn_gate`, `ffn_up`, `ffn_down` | 3584 × 18,944 (down: reverse) | feed-forward step | 67,895,296 each |
| `*_norm`, `attn_q/k/v.bias` | 3,584 / 512 (1-D) | rescaling and offsets | tiny, stored as F32 |

- One weight = one cell: how strongly input *i* feeds output *j*. Toy: x = (1, 2), W = [[0.5, -1], [2, 0.25]] gives key = (1×0.5 + 2×2, 1×-1 + 2×0.25) = (4.5, -0.5).
- Per layer: ~233M weights (~204M in the feed-forward step, ~29M in attention). 28 layers = 6.53B. Plus `token_embd` (152,064 × 3,584 = 545M) and `output.weight` (545M) and norms/biases = **7,615,616,512**, matching the reported parameter count exactly.

**Bits per weight (computed by summing all tensors across both shards):**

| Format | Block layout | Bits/weight | Weights (share) |
|---|---|---|---|
| Q4_K | 256 weights: 128 B of 4-bit values + 12 B sub-block scales/mins + 4 B FP16 scales = 144 B | 144×8/256 = **4.5** | 6.09B (80.0%) |
| Q6_K | 256 weights: 192 B of 6-bit values + 16 B scales + 2 B FP16 scale = 210 B | 210×8/256 = **6.5625** | 1.52B (20.0%) |
| F32 | one float | 32 | 333k (~0%) |

0.80 × 4.5 + 0.20 × 6.5625 ≈ 4.91. Exactly: 4,677,120,000 B × 8 / 7,615,616,512 = **4.913**, and the summed bytes equal the file size the server reports.
- "4-bit" costs 4.5 bits once scale factors are counted. In `Q4_K_M`, "K" = this block-and-scales design; "M" = medium mix, where sensitive tensors (layer 0: `attn_v`, `ffn_down`, and `output.weight`) get Q6_K.
- The commonly quoted ~4.85 for Q4_K_M is a generic figure (recalled, unverified). The real average depends on the model: Qwen's large vocabulary and separate Q6_K output matrix push it up.

## 4. The roofline model ★★

**What it is:** a way to tell whether a workload is limited by math or by memory.

**Arithmetic intensity** = operations performed per byte read from memory. Then:

```
achievable speed = min( chip's peak math speed , memory bandwidth × arithmetic intensity )
```

Two limits ("roofs"): a flat one (peak math) and a slanted one (bandwidth × intensity). The workload sits under whichever is lower.

**Applied to our two phases (estimates):**
- **Decode:** ~2 operations per weight, and a Q4 weight is ~0.61 bytes (4.91 bits). Intensity ≈ 2 / 0.61 ≈ **3.3 operations per byte**. At 273 GB/s that allows only ~0.9 trillion operations/s. The chip can do far more, so decode sits under the slanted roof: **memory-bound**.
- **Prefill:** each weight read serves every prompt token in the batch, so intensity is roughly 3.3 × (tokens per batch). With hundreds of tokens per batch it is in the hundreds of operations per byte, far past the point where math becomes the limit: **compute-bound**.
- **Evidence from the measurements:** prefill sustained about 5.5 trillion operations/s (360 tok/s × ~15 billion per token), so the chip's math peak is *at least* that. Divide by bandwidth: 5.5T / 273G ≈ 20. Any workload below ~20 operations per byte is memory-bound on this chip; decode at 3.3 is well below.

## 5. Batching: the fix for memory-bound decode ★★★

**Idea:** a decode step reads all the weights once. If several conversations decode in the *same step*, one read of the weights serves all of them, so each byte read does more useful work.

**Measured** (`llama-server` with 4 slots, 100-token answers, different prompts, streams run at the same time):

| Concurrent streams | Decode speed per stream | Total decode speed |
|---|---|---|
| 1 | 50.2 tok/s | 50 tok/s |
| 2 | 33.6 tok/s each | 67 tok/s |
| 4 | 30.3 tok/s each | **121 tok/s (2.4x)** |

- Each user's stream slows down (50 → 30 tok/s), but the server as a whole produces 2.4x more tokens per second. This is the **latency vs throughput trade-off**: batching trades each user's speed for total capacity.
- Why not 4x: the weights are shared across streams, but **each stream has its own KV cache**, and every step reads all four caches. Math per step also grows. Cache reads don't batch away.
- Not explained: the step time went 20 ms (1 stream) → 30 ms (2) → 33 ms (4). The jump from 1 to 2 is larger than from 2 to 4; I haven't investigated why.
- Production inference servers (vLLM and others, Chapter 11) are built around this: keep many requests in flight and batch their decode steps ("continuous batching").

## 6. What this means for the project ★★★

- **Model size sets speed.** Halving bytes (quantization) roughly doubles decode speed. Day 2 measures this.
- **Context length costs memory twice:** capacity (cache must fit) and bandwidth (cache is re-read every token).
- **For a law-firm deployment:** long contract prompts mean prefill-heavy, cache-heavy workloads. Capacity planning needs concurrent users × context length × 57 KB per token, on top of the weights.
- **Many users:** batching raises total throughput but each user waits longer per token; there is a limit set by cache memory.

## Next
1. Lab 1 step 4 (temperature sweep, with and without truncation).
2. Day 2: quantization script (`llama-quantize`, `llama-bench`, `llama-perplexity`), which tests the "bytes ÷ bandwidth" table above directly.

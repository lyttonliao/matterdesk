# Chapter 5 notes: Quantization

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Builds on Chapter 4 (decode speed = bandwidth ÷ bytes) and the Q4_K/Q6_K block layouts from section 3b there. Toy numbers below are computed, not model output. Claims marked "recalled" come from memory and are not verified here; the Day 2 lab will check several of them.

## 0. The big idea ★★★

**Quantization stores each weight with fewer bits, plus a small scale factor to map it back.** The file gets 3-4x smaller, which means (Chapter 4) it fits in less memory and decodes faster, at the price of a small error in every weight.

- Original weights: 16 bits each (FP16). Qwen2.5-7B: 15.2 GB.
- Our Q4_K_M file: 4.91 bits each on average. 4.68 GB.
- Nothing is retrained. Quantization is a conversion applied to the finished weights (Chapter 3: training happens once, upstream).

## 1. The basic mechanism ★★★

Pick a **grid** of a few allowed values and round every weight to the nearest grid point. Store the small integer, plus one **scale** that says how far apart grid points are.

**Toy example: 4-bit, symmetric ("absmax").** A 4-bit signed integer ranges from -7 to 7 (using 7 as the symmetric limit). Scale = largest absolute weight ÷ 7.

| | values |
|---|---|
| Original weights | 0.12, -0.50, 0.33, 0.05, -0.07, 0.41, -0.22, 0.01 |
| Scale = 0.50 / 7 | 0.0714 |
| Stored integers (round(w / scale)) | 2, -7, 5, 1, -1, 6, -3, 0 |
| Restored (integer × scale) | 0.143, -0.500, 0.357, 0.071, -0.071, 0.429, -0.214, 0.000 |
| Error | 0.023, 0.000, 0.027, 0.021, 0.001, 0.019, 0.006, 0.010 |

- Storage: eight 4-bit integers + one scale, instead of eight 16-bit numbers.
- Every weight is off by up to half a grid step (0.036 here). The model keeps working because errors are small and mostly cancel across millions of weights.
- **Where the speedup comes from:** at run time the server reads the small integers and multiplies by the scale on the fly. Fewer bytes read per token, more tokens per second.

## 2. Why blocks? Outliers ★★★

**Problem:** one large weight (an outlier) stretches the grid for everyone, so the ordinary weights all round to zero.

Same weights, but the last one is 5.0 instead of 0.01:

| | values |
|---|---|
| Scale = 5.0 / 7 | 0.714 |
| Stored integers | 0, -1, 0, 0, 0, 1, 0, 7 |
| Restored | 0.0, -0.714, 0.0, 0.0, 0.0, 0.714, 0.0, 5.0 |

Six of the eight weights collapsed to 0 or ±0.714 (the weight 0.33 became 0.0, and -0.50 became -0.714). Most of the information is gone.

**Fix: block-wise quantization.** Split the weights into small blocks and give each block its own scale, so an outlier only damages its own block.
- Split the eight weights into two blocks of four. The first block (`0.12, -0.50, 0.33, 0.05`) has no outlier and keeps its fine scale of 0.0714. Stored: 2, -7, 5, 1. Restored: 0.143, -0.500, 0.357, 0.071.
- The second block (`-0.07, 0.41, -0.22, 5.0`) is still crude (scale 0.714, stored 0, 1, 0, 7) but the damage is contained.

**The trade-off: block size.** Smaller blocks isolate outliers better but need more scales, and scales cost bits.
- Real block sizes are 32 or 256 weights, not 4.
- Overhead example (Q8_0, 32 weights, one 16-bit scale): 32 × 8 + 16 = 272 bits = 34 bytes = **8.5 bits per weight**. The "8-bit" format costs 8.5 once the scale is counted. Same effect as Q4_K at 4.5 (Chapter 4, section 3b).

## 3. The format names ★★

| Name | Meaning (recalled unless noted) | Bits/weight |
|---|---|---|
| **Q8_0** | 8-bit, blocks of 32, one scale per block (the `_0` = simple, no offset) | 8.5 |
| **Q6_K** | 6-bit "K-quant" | 6.5625 (computed from the file) |
| **Q5_K** | 5-bit K-quant | ~5.5 |
| **Q4_K** | 4-bit K-quant | 4.5 (computed from the file) |
| **Q2_K** | 2-bit K-quant | ~2.6 |

- **K-quants:** a more refined design. Blocks of 256 weights made of smaller sub-blocks of 32, each with its own small scale (and a minimum, so the grid can be offset instead of centered on zero), plus 16-bit scales for the whole 256-block (the layout we computed for Q4_K).
- **Suffix `_S`, `_M`, `_L`** (small/medium/large): a mix recipe. `Q4_K_M` does not mean every tensor is Q4_K. From the file: 80% of weights are Q4_K and 20% are Q6_K (the more sensitive tensors), averaging 4.913 bits.
- Why some tensors get more bits: errors in some matrices hurt output quality more than in others. Value projections, the feed-forward down projection and the output matrix are commonly kept at higher precision (observed in layer 0; the rest of that rule is recalled).
- **Importance matrix (imatrix, ★):** an optional step where the quantizer first runs sample text through the model to learn which weights matter most, then spends precision accordingly. Matters most at very low bits (Q2/Q3).

## 4. Measuring the damage: perplexity ★★★

**Perplexity (PPL)** answers "how surprised is the model by real text?"
- Run the model over a text; at each position take the probability it gave the *actual* next token; average the negative log of those: that is the **loss** from Chapter 3. Perplexity = e^loss.
- **Reading it:** perplexity of 5 means the model is, on average, as uncertain as if it were choosing between 5 equally likely tokens. Lower is better.
- **Worked example:** on our prompt the model gave ` month` 84.62%. Loss = −ln(0.8462) = 0.167. If every token were that predictable, perplexity = e^0.167 = **1.18**. A model giving 1% would have loss 4.6 and perplexity 100.
- **Use for quantization:** run the same text through FP16 and each quantized version. A rise in perplexity is the quality cost. Typical pattern (recalled; the lab measures it): Q8_0 is indistinguishable from FP16, Q4_K_M costs a small percentage, Q2_K degrades visibly.
- **Caveat:** perplexity measures predicting text, not your task. A model can keep its perplexity and still lose accuracy on a specific skill (legal clause extraction, say). For this project, Day 7's evaluation set is the real test; perplexity is a quick screening metric.
- The comparison is only fair on the **same text and same settings** (context length, text file).

## 5. Quantization and the roofline ★★★

Link to Chapter 4: the two phases respond differently.
- **Decode (memory-bound):** bytes per token drop, so speed rises roughly in proportion. Q4_K_M reads ~3x fewer bytes than FP16, so the ceiling rises ~3x (measured earlier: 50 tok/s against a 58 tok/s ceiling).
- **Prefill (compute-bound):** the math is unchanged, and the weights must be unpacked from the small integers before use, so prefill barely gains and may even lose a little.
- **Prediction for the lab:** token generation speed (`tg`) should rise as the file shrinks; prompt processing speed (`pp`) should stay roughly flat.
- The **KV cache can be quantized separately** (Chapter 2: 57,344 bytes/token in FP16). `llama-server` has options for this (flags `-ctk` / `-ctv`, recalled). That shrinks cache capacity and per-token cache reads, with its own quality cost.

## 6. Other quantization schemes ★ (all recalled, not verified)

| Scheme | What it is | Typical home |
|---|---|---|
| **GGUF K-quants** (this chapter) | Weight-only, block-wise, simple rounding with good block design. Runs on CPU, Apple Silicon and GPUs. | `llama.cpp`, Ollama, LM Studio (local) |
| **GPTQ** | Weight-only, 4-bit typically. Quantizes layer by layer, adjusting the remaining weights to compensate for rounding error, using sample text. | GPU serving stacks |
| **AWQ** (activation-aware weight quantization) | Weight-only. Notices that a small fraction of weights matter much more (judged by the activations flowing through them) and protects those by rescaling before rounding. | GPU serving stacks (e.g. vLLM) |
| **FP8** | An 8-bit *floating-point* format, usually applied to weights **and** activations, with hardware support on recent NVIDIA GPUs. Halves bytes vs FP16, and speeds up the math as well as the memory. | Datacenter GPUs |

- **Weight-only vs weight + activation:** weight-only (GGUF, GPTQ, AWQ) fixes the memory-bound decode phase. Quantizing activations too (FP8) can speed up compute-bound prefill as well.
- Choosing: local laptop/CPU → GGUF; GPU server with vLLM → AWQ/GPTQ/FP8. Day 2 compares them on paper; the lab measures only GGUF.

## 7. What the Day 2 lab will check ★★

| Prediction | From | How the lab tests it |
|---|---|---|
| Q8_0 ≈ 8.5 bits → ~8.1 GB | section 2 | file size of the quantized output |
| Q5_K_M, Q2_K sizes | section 3 (bits recalled) | file size |
| `tg` speed rises as size falls; roughly ceiling = 273 GB/s ÷ file size | Chapter 4 | `llama-bench` |
| `pp` speed roughly flat across formats | section 5 | `llama-bench` |
| Perplexity: Q8_0 ≈ FP16, then rising toward Q2_K | section 4 | `llama-perplexity` on one text file |

**Status: the lab was designed, not run** (skipped to save the 15 GB FP16 download). The script is `labs/day2/quantize-bench.ts` (typechecks; fails fast with a usage message when run without arguments). It quantizes an FP16 GGUF to Q8_0, Q5_K_M, Q4_K_M and Q2_K with `llama-quantize`, then runs `llama-bench` (pp512 and tg128) and `llama-perplexity` on each and prints the table. Tool flags were checked against `--help`; the `llama-bench` JSON field names and the perplexity output line ("Final estimate: PPL = ...") are recalled, so those are the first places to look if it is ever run and fails.

**Reference numbers, printed by `llama-quantize --help` on this machine** (size and perplexity increase over FP16, measured by the llama.cpp authors on Llama-3-8B, not on our model):

| Type | Size | Perplexity increase |
|---|---|---|
| F16 | 14.00 GB | +0.0020 (on Mistral-7B) |
| Q8_0 | 7.96 GB | +0.0026 |
| Q6_K | 6.14 GB | +0.0217 |
| Q5_K_M | 5.33 GB | +0.0569 |
| Q4_K_M | 4.58 GB | +0.1754 |
| Q2_K | 2.96 GB | +3.5199 |

This matches the prediction in section 4: Q8_0 is essentially lossless, Q4_K_M costs a small amount, Q2_K is a big jump. Qwen's published 7B files also confirm the sizes: Q8_0 = 8.10 GB (predicted 8.1), Q4_K_M = 4.68 GB (ours), Q2_K = 3.02 GB, Q5_K_M = 5.44 GB.

## Next
1. Chapter 6 (Mixture-of-Experts, Multi-head Latent Attention).

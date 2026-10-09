# Chapter 2 notes: Attention and the KV cache

Importance: **★★★ must know** · **★★ should know** · **★ reference**. Chapter 1 notes are in `NOTES.md`. The observed `cache_n`/`prompt_n` numbers are in `NOTES.md` ("KV cache"); this file explains *why* the cache exists and what it costs.

**Status:** complete, including the memory measurement (section 8).

## 0. Vocabulary: the numbers of Qwen2.5-7B ★★★

Every number below was read from the model file (see section 7 for how), not recalled.

Picture the model as an assembly line. A token enters as a list of numbers, passes through 28 stations in order, and each station refines the list a bit. At the end, the final list is turned into next-token probabilities (Chapter 1).

| Term | Qwen2.5-7B | In plain words |
|---|---|---|
| **Token vector** (hidden state) | 3,584 numbers | The list of numbers that represents one token while it moves through the network. |
| **Layer** | 28 | One station on the assembly line. Each layer does two things: **attention** (the token looks at earlier tokens) and a **feed-forward** step (the token is processed on its own). Every layer has its own learned weights. |
| **Head** | 28 | Attention inside a layer is split into 28 parallel "readers". Each reader can focus on something different. |
| **Head dim** | 128 | How many numbers each reader works with: its share of the vector, 3,584 / 28 = 128. |
| **KV heads** | 4 | How many sets of keys and values the layer actually builds and stores. Fewer than the 28 readers, because readers share (section 5). This number drives cache size. |
| **Context length** | 131,072 tokens | How much text the model can hold in view at once. |
| **Parameters** | 7.6 billion | All the learned numbers in the model (the weights). |

**GGUF** (GPT-Generated Unified Format) is a single-file binary format for storing a language model so it can be run locally on a laptop or PC. It is an **all-in-one container**: the weights (the learned numbers), the network's architecture (layer count, head counts), its settings (context length), and the tokenizer all live in one file, so a runtime like `llama-server` needs nothing else to start the model.

What it gives you:
- **One file to download and run.** `llama-server -hf Qwen/...:Q4_K_M` fetches it from Hugging Face and serves it. Ollama, LM Studio and GPT4All use the same format. (Ours is split into two shards, `...-00001-of-00002.gguf`; the metadata is in the first.)
- **Quantization support** (next item), which is what makes a 7B model fit on a laptop.
- **Memory mapping:** the OS can map the file straight into RAM and load only the parts being used, instead of reading all of it up front.
- **Extensible metadata:** it replaced the older GGML format, which broke whenever a new setting was added. GGUF stores settings as named key/value pairs, so old files keep working.

In this chapter we read two of those metadata entries (layer count, head counts) to size the KV cache (section 7). Internal layout, for reference: header (magic bytes `GGUF`, version, counts), then metadata key/value pairs, then a directory of tensors (weight matrices), then the tensor data.

**Quantization** (the `Q4_K_M` in the model name) means storing each weight with fewer bits, trading a little accuracy for a much smaller file. Ours uses about 4-5 bits per weight instead of 16: 4,677,120,000 bytes for 7.6B parameters = 4.91 bits each. As FP16 the same model would be 15.2 GB. This applies to the **weights only**; the KV cache is a separate thing and is sized in FP16 below.

**FP16** (16-bit floating point, "half precision") is a way to store a decimal number in 16 bits = **2 bytes**, half the usual FP32 (4 bytes). It keeps about 3 significant digits, which is enough for the cache. The KV cache uses FP16 by default in `llama.cpp` (recalled, not verified here).

## 1. What attention does ★★★

To predict the token after `"...first day of the"`, the model needs information from earlier tokens (`rent`, `first`). **Attention is how the current token's vector pulls in information from earlier tokens' vectors.**

Each token's vector `x` is multiplied by three learned weight matrices:

| Vector | Question it answers | Made from |
|---|---|---|
| **Query (Q)** | What am I looking for? | the current token |
| **Key (K)** | What can I be matched on? | every token |
| **Value (V)** | What do I hand over if matched? | every token |

(Library analogy: the query is your search phrase, each key is a book's index entry, each value is the book's content. You read a blend of the books whose entries matched best.)

Steps for the current token:
1. **Score:** dot product of its query with each earlier token's key. Dot product = multiply matching components and add: `(1,0)·(2,0) = 1×2 + 0×0 = 2`. Bigger = better match.
2. **Softmax** the scores into weights that sum to 1 (the same softmax as Chapter 1, section 3, applied to dot products instead of logits).
3. **Output** = the weighted sum of the values.

Real attention divides each score by √d (d = head dimension, here 128) so scores don't grow with vector size. Omitted below for readability.

## 2. Toy example (computed, not model output) ★★

Three earlier tokens (made-up 2-number vectors):

| token | key K | value V |
|---|---|---|
| `rent` | (2, 0) | (10, 0) |
| `first` | (1, 1) | (0, 10) |
| `day` | (0, 2) | (5, 5) |

| Query | Dot products (rent, first, day) | Softmax weights | Output |
|---|---|---|---|
| (1, 0) | 2, 1, 0 | 0.665, 0.245, 0.090 | (7.10, 2.90): mostly `rent` |
| (0, 1) | 0, 1, 2 | 0.090, 0.245, 0.665 | (4.23, 5.77): mostly `day` |

Check of the first row: softmax of (2, 1, 0) = e²/(e²+e¹+e⁰) = 7.389/11.107 = 0.665, and so on. Output = 0.665×(10,0) + 0.245×(0,10) + 0.090×(5,5) = (7.10, 2.90).

- Same keys and values, different query → different focus. **Each token asks its own question of the same context.**

## 3. Multi-head attention ★★★

One query per token gives one set of weights, so one "kind" of focus. Language needs several at once: which noun does this adjective modify, where did this number appear before, which clause am I in.

**Multi-head attention** runs many small attentions in parallel and combines them:

1. The token vector (3,584 numbers) is multiplied by the query matrix, giving 3,584 numbers, **cut into 28 slices of 128**. Slice *h* is the query of head *h*.
2. Each head scores its 128-number query against 128-number keys, runs its own softmax, and takes its own weighted sum of values. Each head can focus on different earlier tokens.
3. The 28 outputs (28 × 128 = 3,584 numbers) are placed side by side and multiplied by one more matrix (the output projection) to mix what the heads found.

Concrete picture with the toy example: head A might look like row 1 (focus on `rent`), head B like row 2 (focus on `day`); after combining, the token carries information about both. The model learns during training what each head looks for; nobody assigns the roles.

Cost note: more heads does **not** mean more total computation, because each head works on a 128-number slice, not the full vector. 28 heads × 128 = 3,584.

## 4. Why the KV cache works ★★★

- Attention is **causal**: a token attends only to tokens before it, never after. So **appending a new token never changes the K and V of earlier tokens.**
- Every new token's query needs **all** earlier keys and values, at every layer.
- Without a cache, generating token 1,001 would recompute K and V for all 1,000 earlier tokens in all 28 layers, and token 1,002 would redo it again. With a cache, you compute K and V only for the new token and append them.
- **Cache K and V, never Q.** A token's query is used once, in its own step, to build its own output; no later token ever asks for it. A token's key and value are needed by every later token.
- **The cache is per layer:** layer 5's keys come from layer 4's output vectors and differ from layer 20's keys, so each of the 28 layers keeps its own K and V.
- **Prefix rule:** K and V of later tokens depend on everything before them, so changing an early token invalidates the cache from that point on. That is why `llama-server` matches the longest common **token prefix** (what `cache_n` counts, with `prompt_n` the tokens that had to be computed fresh).

## 5. Grouped-query attention (GQA) ★★★

**What it is:** GQA lets several query heads share one set of keys and values, so the cache has to store far fewer of them. The cache stores K and V (never Q), so its size depends on the number of K/V heads, not query heads.

**What "one K vector" means:** one head's key for one token = 128 numbers. Likewise one V vector = 128 numbers. "28 K vectors per token per layer" means 28 heads each produced their own 128-number key for that token (28 × 128 = 3,584 numbers).

**Plain multi-head attention** (28 query heads, 28 K/V heads): every head has its own query, its own keys and its own values. Nothing is shared.
- Query head 0 ↔ K/V head 0, query head 1 ↔ K/V head 1, ... query head 27 ↔ K/V head 27.

**GQA** (28 query heads, 4 K/V heads): the query heads are split into 4 groups of 7, and each group shares one K/V head (query head *i* uses K/V head *i* ÷ 7, rounded down).
- Query heads 0-6 → K/V head 0; 7-13 → K/V head 1; 14-20 → K/V head 2; 21-27 → K/V head 3.
- A single head works exactly as before. The only change is how many K/V sets exist, so heads in a group share them.

**Why the heads in a group don't collapse into one:** they still have different queries. Section 2's toy example is exactly this: query (1, 0) and query (0, 1) search the same K/V table and get different results (mostly `rent` vs mostly `day`). A head loses its private index, not its own question.

**Why split this way:** queries are used once and never cached, so keeping 28 of them is free in cache memory. K and V are stored for every token, so reducing them from 28 to 4 shrinks the cache 7x.

**How the model gets this:** it is trained with this structure from the start, not converted afterward. The 4 K/V heads learn to store what is useful to all 7 query heads in their group.

**Shapes:** the query matrix outputs 28 × 128 = 3,584 numbers; the key and value matrices output only 4 × 128 = 512 numbers each.

| Per token, per layer | K numbers | V numbers | Total |
|---|---|---|---|
| Plain multi-head | 28 × 128 = 3,584 | 3,584 | 7,168 |
| GQA (Qwen2.5-7B) | 4 × 128 = 512 | 512 | 1,024 |

**Tradeoff:** 7x less cache memory (and 7x less data to read per generated token), at a small quality cost versus full multi-head attention. Nearly all current open models use GQA or something similar for this reason.

## 6. Cache size, with numbers ★★★

Bytes per token = 2 (one K and one V) × 28 layers × 4 KV heads × 128 head dim × 2 bytes (FP16) = **57,344 bytes** (56 KiB).

Without GQA (28 KV heads): 2 × 28 × 28 × 128 × 2 = 401,408 bytes, exactly 7x more.

| Context in the cache | GQA (actual) | Without GQA |
|---|---|---|
| 1,000 tokens | 57 MB | 401 MB |
| 8,192 tokens | 470 MB | 3.3 GB |
| 131,072 tokens (full) | 7.5 GB | 52.6 GB |

- At full context the cache (7.5 GB) is **bigger than the quantized weights** (4.68 GB). Long contexts, not the model, are what fill memory.
- Memory grows **linearly** with context length, and every generated token reads the entire cache, so long contexts also slow generation.
- Systems lesson: the cache is state that the server holds *per conversation*. Serving many users means many caches, which is why servers have slots (`total_slots` = 4 here) and why reusing a shared prefix (system prompt) saves both compute and memory.

## 7. How the numbers were verified ★

`llama-gguf` only printed the key names, not the values, so a short Python script (`struct` module) read the GGUF header directly: magic, version, tensor count, key/value count, then each typed key/value pair. The `qwen2.*` keys:

| Key | Value |
|---|---|
| `qwen2.block_count` | 28 |
| `qwen2.embedding_length` | 3,584 |
| `qwen2.feed_forward_length` | 18,944 |
| `qwen2.attention.head_count` | 28 |
| `qwen2.attention.head_count_kv` | 4 |
| `qwen2.context_length` | 131,072 |

Head dim is not stored; it is derived: 3,584 / 28 = 128. `n_embd` = 3,584 and the parameter count also appear in the server's `/v1/models` response (`meta`).

## 8. Measured: server memory idle vs after a long prompt ★★★

Tool: `footprint <pid>` (macOS) reports a process's memory by category. Plain RSS (`ps`) is less useful here because model weights are memory-mapped (section 0, GGUF).

| | Total footprint | `VM_ALLOCATE` (anonymous allocations) |
|---|---|---|
| Idle (just started) | 7,283 MB | 7,172 MB |
| After a 16,990-token prompt | 7,447 MB | 7,246 MB |

- The weights are a separate line (`mapped file`, 4,416 MB, clean, file-backed).
- **Predicted** cache for 16,990 tokens: 16,990 × 57,344 bytes = 974 MB. **Observed** growth: 164 MB. So the cache does not grow with the prompt.
- Why: `llama-server` allocates the KV cache for the **full** context (131,072 tokens) at startup. 131,072 × 57,344 = 7,516,192,768 bytes = 7,168 MiB, which matches the idle `VM_ALLOCATE` of ~7,172 MB. Memory is committed up front, and the prompt only fills it.
- **Total vs per slot:** `/slots` reports `n_ctx` = 131,072 for each of the 4 slots, but memory matches **one** 131,072-token pool, not four. The slots share the pool (the budget is total).
- Practical consequence: the context size you pass at startup (`-c`) decides memory use, whether or not anyone sends a long prompt. A smaller `-c` would free memory immediately.
- Prefill speed: 16,990 tokens in 46.6 s ≈ 365 tokens/s (`prompt_ms` from `/completion` timings). This is the cost the cache avoids on a repeated prefix.

## Next
1. Return to **Lab 1 step 4** (temperature sweep) when convenient, then start Lab 2.

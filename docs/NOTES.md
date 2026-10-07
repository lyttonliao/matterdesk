# Notes

Companion to `COURSE.md`. Chapter-by-chapter concepts, corrected answers, commands.
## RESUME HERE (for a fresh session)

**Where we are:** Chapter 1 read and exercises reviewed. Lab 1 step 1 (`labs/day1/tokenize.ts`) is done and typechecks. **Next: Lab 1 step 2** (see "Lab 1" at the bottom). Chapter 2 (attention and the KV cache) comes after the lab.

**Pending questions for the user to answer first (they haven't answered these yet):**
1. For `"The tenant shall pay rent on the first day of the"`, which token do you predict wins, and with roughly what probability?
2. What do the other four candidates look like (think leading space)?
Then they write the `/completion` call with `n_predict: 1`, `n_probs: 5`, print the top 5, and compare to the prediction.

**Environment:**
- `llama-server` must be running: `llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8080` (blocks the terminal; run it in a separate tab). Check with `curl localhost:8080/health`.
- Lab code lives in `labs/day1/` (Node 24 runs `.ts` directly: `node file.ts`; typecheck with `npm run typecheck`).
- Nothing in `docs/` or `labs/` is committed yet.

**How we work (the user's requests):**
- Teach like a book (*Designing Data-Intensive Applications* style): first principles, concrete numbers from this project, lessons for systems engineers.
- Before asking the user to run any command, explain the technology, why we use it, and what each flag does.
- The user writes the lab code and I review every line. Exception: they may ask me to apply fixes.
- Quiz before moving on: the user answers first, then I correct and fill gaps. Record corrections here.
- Gate: typecheck passes before commit. No `Co-Authored-By` trailer on commits (user's global rule).

Plan: `PLAN.md` (16 days). Course outline: `COURSE.md` (20 chapters).

---

# Chapter 1: Language models as probability machines

## 1. The core idea

A language model is a function from tokens to a probability distribution:

```
f(sequence of tokens) -> probability for every token in the vocabulary
```

- **Token:** a piece of text from a fixed vocabulary (~152k entries for Qwen2.5). Not characters, not words.
- **Tokenizer:** splits text into tokens using byte-pair encoding (BPE). It starts from single bytes and repeatedly merges the most frequent adjacent pairs found in training text. Common words become one token; rare strings (citations like `§ 12.3(b)(iv)`, party names) fragment into many.
- **Parameters** (the "B" in 7B = billions of parameters): the learned numbers inside `f`. Training nudges them by gradient descent to raise the probability of the token that actually came next. We only run models (inference) and lightly adapt them later (fine-tuning, Day 10).
- **Output of one decode step:** exactly one list of ~152k probabilities, one per vocabulary token. The 152k is the **vocabulary size**, not the weight count. It appears only at the final layer, which projects an internal vector (~3,584 numbers for Qwen2.5-7B) to one score per vocabulary token.

## 2. The generation loop (autoregressive)

1. Tokenize the prompt.
2. One forward pass gives the distribution over the next token. Sample **one** token from it.
3. Append that token to the sequence.
4. Repeat until the end-of-sequence token.

- Each output token becomes input to the next step, so **decode is sequential** for a single request.
- **You walk a single path, not a tree.** The number of possible sequences explodes (150,000^3 is about 3.4 x 10^15 after 3 tokens), but you visit one. Beam search is the exception: it keeps k paths alive.
- **Hallucination is built in:** the loop samples fluent continuations; nothing checks truth.

### What can be parallelized
| Thing | Why |
|---|---|
| Prompt tokens (prefill) | All known up front, processed in one forward pass |
| Different requests (batching) | Many users' sequences share one read of the weights (Ch. 17) |
| Math inside one step | Matrix multiplication across thousands of GPU cores |

Only the output tokens of one request are serial.

## 3. Sampling and temperature

The model produces raw scores (**logits**). Temperature `T` rescales them before they become probabilities:

```
p(token) = softmax(logit / T)
```

Toy example, two candidates, logits `" month" = 10`, `" year" = 6.5` (illustrative, not measured):

| T | p(" month") | p(" year") | shape |
|---|---|---|---|
| 2.0 | 0.852 | 0.148 | flatter, more varied output |
| 1.0 | 0.971 | 0.029 | the model's native distribution |
| 0.5 | 0.9991 | 0.0009 | spikier |
| 0 (greedy) | 1 | 0 | always the highest-scoring token |

- **T = 0 is greedy decoding (argmax):** the distribution collapses to a spike on one token. It is not a bell curve.
- **Why not a bell curve:** the normal distribution comes from the Central Limit Theorem, which applies to sums or averages of many independent samples. A next-token distribution is *categorical* over 152k discrete tokens, usually extremely peaked with a long tail.
- **Greedy is still not guaranteed bit-identical across runs.** Batching and floating-point order can change results slightly. For audit and tests, pin the seed and settings and log them.
- top-p and top-k cut off the tail before sampling (Day 1 lab experiments).

## 4. Two artifacts at runtime

| | Weights | Context |
|---|---|---|
| What | The parameters | Tokens you send in |
| Size | Fixed (e.g. 4.7 GB) | Grows per request |
| Changes at inference | Never | Every request |
| Holds | General learned knowledge | The contract, the question |

The model cannot know the firm's matters (never in the weights), so RAG retrieves text and puts it into the context.

**Weight memory = parameters x bytes per parameter**
- 7.6B x 2 bytes (FP16) = 15.2 x 10^9 bytes = about 15 GB
- 7.6B x ~4.85 bits / 8 (Q4_K_M) = about 4.6 GB

## 5. The key systems lesson: the model is a pure function

The model keeps no memory between calls. A "conversation" works because the **application** resends the whole history every turn (like HTTP statelessness).

- **State lives in your app.** History, retrieved documents and audit logs are yours to store and secure. The history log can contain privileged content: same access control, retention and audit as the documents. Prompts can also leak into model-server logs and tracing tools.
- **The model has no access control.** It uses anything in its context. Permissions must be enforced *before* text enters the context.
- **Context is finite** and every token costs memory and time.

## 6. Why prompt rules fail and Row-Level Security (RLS) works

**Prompt instruction ("don't reveal other matters"):**
- It is just more text in the context. The model has no concept of "this matter is secured".
- It cannot enforce anything. It is a probabilistic request, defeated by prompt injection, odd phrasing, or a retrieval step that already put Matter B text into the prompt. By then the leak has happened.

**RLS:**
- Postgres attaches a policy to a table, e.g. `USING (matter_id IN (SELECT matter_id FROM assignments WHERE user_id = current_setting('app.user_id')::uuid))`.
- It applies on **every** query from that connection, whatever the application code, the model or an injected prompt asks for. Rows the user can't see are never returned, so they can never reach the context.
- "Always checks" has conditions:
  - **Superusers bypass RLS.** Table owners also bypass unless `FORCE ROW LEVEL SECURITY` is set. A role with `BYPASSRLS` bypasses it too. The app must connect as a plain non-superuser role.
  - **The session variable must be set correctly on each connection.** With connection pooling, a leftover value from a previous request is a cross-user leak. Use `SET LOCAL` inside a transaction.
  - **Policies are only as correct as written.** Test them.
  - **RLS only protects rows in the database.** It does not protect copies in caches, logs, traces or fine-tuned weights.

### Where a Matter B answer could leak
1. **Retrieval:** vector search returns a Matter B chunk. The model can't prevent it.
2. **Context:** the model will use whatever is in the prompt.
3. **Shared state:** prefix cache shared across users, semantic answer cache, logs/traces with prompt text, an agent tool that fetches by document ID without a check.
4. **Weights:** fine-tuning on Matter B bakes it into a model everyone queries.

The model prevents none of these reliably. Enforce in the database and application layers.

## 7. Failure modes

1. **Sampling nondeterminism:** same prompt, different outputs. Matters for audit and tests.
2. **Tokenization surprises:** exact-match strings (party names, section numbers) fragment unpredictably.
3. **Confident fabrication:** a high-probability continuation is not a verified fact.

## 8. Exercise review (corrections)

**Q: Can decode for token 50 run in parallel with token 49?** No: it needs the token chosen at 49. Parallelizable: prompt tokens (prefill), different requests (batching), the math inside a step. See section 2.

**Q: Why does prompt-based "don't reveal other matters" fail while RLS works?** See section 6. The model has no concept of access control; a prompt rule is more text. RLS is enforced by Postgres on every query, so forbidden rows never reach the context.

**Q: What happens at temperature 0?** Greedy decoding (argmax): the distribution collapses to a spike on one token. It is not a bell curve (the Central Limit Theorem applies to sums of independent samples, not to a categorical distribution over discrete tokens). See section 3.

**Q: Why do exact strings like `12.3(b)` behave differently for a model than for text matching?**
- A text engine compares characters, so matches are deterministic.
- A model sees token IDs, and the same logical string becomes **different token sequences depending on its neighbors**:

```
(b)                          "(b"  ")"
(iv)                         "(iv" ")"
(b)(iv)                      "(b"  ")("  "iv"  ")"
Section 12.3(b) applies      "Section" " " "1" "2" "." "3" "(b" ")" " applies"
Section 12.3(b)(iv) applies  "Section" " " "1" "2" "." "3" "(b" ")(" "iv" ")" " applies"
```

- **Token boundaries don't match logical boundaries:** legally the citation has units `12.3`, `(b)`, `(iv)`, but no token equals `(b)` or `(iv)` inside the longer string. `)(` straddles the end of one unit and the start of the next. `(iv)` alone is `"(iv"` + `")"`; inside the citation it becomes `"iv"` + `")"`.
- The model must *learn* that different sequences mean the same thing. That is statistical, not guaranteed, so it can misquote or transpose.
- Embeddings inherit this and blur exact identifiers into general meaning. This is why **hybrid search** (character-exact full-text plus vector, Day 6) exists.
- Even plain words fragment: `twelve` is `"tw"` + `"elve"`.

**Q: Estimate token count from word count or character count?** Neither is reliable:

| Text | Chars | Tokens | Chars per token |
|---|---|---|---|
| `Change of Control` | 17 | 3 | 5.7 |
| `§ 12.3(b)(iv)` | 13 | 10 | 1.3 |

- A fourfold spread, and contracts are full of citations and numbers.
- **For a real budget, count with the real tokenizer** (`/tokenize` or the model's tokenizer library). Tokenizers are model-specific.
- Heuristics are for rough estimates only: tokenize a sample of your own documents and compute tokens per character per document type. Characters predict better than words.
- Ingestion (Day 4) counts tokens with the actual tokenizer when chunking.

---

# Technologies and concepts

| Term | Meaning |
|---|---|
| Large language model (LLM) | Neural network that predicts the next token from the previous ones |
| GGUF | One file format holding weights, tokenizer and metadata (e.g. chat template). Made for llama.cpp |
| Quantization | Storing each weight in fewer bits. In `Q4_K_M`: Q4 = about 4 bits per weight, K = block-wise K-quant scheme, M = medium accuracy/size mix |
| llama.cpp | C/C++ inference engine for CPU and GPU. Exposes the tokenizer, KV (key-value) cache and quantization tools |
| Metal | Apple's GPU programming interface. Apple Silicon has unified memory: CPU and GPU share the same RAM, so the GPU reads the model in place |
| Docker on macOS | Runs in a Linux VM with no Metal access, so a containerized model is CPU-only and much slower. Run the model natively, other services in Docker |
| OpenAI-compatible API | `llama-server` exposes `/v1/chat/completions`, so app code stays portable across llama.cpp, Ollama, vLLM |
| Instruct model | Tuned to follow chat instructions, vs. a base model that only continues text |
| KV cache | Stored key/value vectors for already-processed tokens so they aren't recomputed (Chapter 2) |
| Prefill vs. decode | Prefill processes the prompt in parallel (compute-bound). Decode makes one token per step (memory-bandwidth-bound) |

## Decode is memory-bandwidth-bound

Each token requires reading every weight once, using each for about 2 math operations. The chip can do far more math than it can fetch bytes.

- Speed ceiling = memory bandwidth / model size in bytes = 273 GB/s / 4.7 GB = about 58 tokens/second (M4 Pro). Real numbers land lower.
- Prefill reuses each loaded weight across all prompt tokens, so it is compute-bound.
- Quantization speeds up decode because fewer bytes are read per token.
- GPU sizing is built on this relationship (Chapters 4 and 18).

---

# Commands

**`brew install llama.cpp`**
- Installs prebuilt binaries into `/opt/homebrew/bin`: `llama-server`, `llama-cli`, `llama-quantize`, `llama-perplexity`.
- Only adds files. Undo with `brew uninstall llama.cpp`.

**`llama-server -hf Qwen/Qwen2.5-7B-Instruct-GGUF:Q4_K_M --port 8080`**
- `-hf` downloads from a Hugging Face repo; the `:Q4_K_M` suffix picks the quantization file.
- Caches under `~/Library/Caches/llama.cpp`, loads weights into unified memory, allocates the KV cache, starts an HTTP server.
- Binds to `127.0.0.1` by default (only this machine can reach it). Matters for a law firm; revisit on Day 12.
- Auto-offloads layers to the GPU via Metal.
- Caveat: Qwen's official repo ships split shards; if `-hf` errors, use a repo with a single-file GGUF.

**`curl localhost:8080/v1/chat/completions ...`**
- `messages` is a list of `{role, content}` turns (`system`, `user`, `assistant`), wrapped in the model's chat template (marker tokens like `<|im_start|>`).
- `max_tokens` caps the number of decode steps.
- Answer is in `choices[0].message.content`; token counts in `usage`; llama.cpp adds a `timings` block (prefill and decode speed).

---

# llama-server in practice (observed on this machine)

Hardware: Apple M4 Pro, 48 GB unified memory, 273 GB/s memory bandwidth.

## Reading the startup log

| Log line | Meaning |
|---|---|
| `Downloading ...00001-of / 00002-of` | Sharded GGUF (one model split across files). `-hf` handled it |
| `n_threads = 10` | CPU threads for work not on the GPU |
| `n_slots = 4` | Server holds 4 independent conversations at once; each slot has its own sequence state. A simple form of batching (Ch. 17) |
| `n_ctx_slot = 131072` | Each slot may use up to 131,072 tokens of context |
| `kv_unified = true` | All slots share one pool of KV cache memory |
| `control-looking token '</s>'` | Harmless metadata quirk in the model file, overridden by llama.cpp |
| `no API key ... CORS allows all origins` | Anyone who can reach the port can use it, and any web page in your browser can send it requests. Localhost binding keeps other machines out. Lock down on Day 12 (API key, origin rules) |
| `default port will change to :9931` | Pin `--port` explicitly so upgrades don't break clients |

## Endpoints used so far

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness: `{"status":"ok"}` once the model is loaded |
| `GET /props` | Server and default generation settings |
| `POST /tokenize` | llama.cpp-native (no `/v1` prefix). `/v1/tokenize` is a 404, because `/v1/*` is only the OpenAI-compatible surface |
| `POST /v1/chat/completions` | OpenAI-compatible chat |

**Default sampling settings** (from `/props`): temperature 0.8, top_k 40, top_p 0.95, min_p 0.05. So the server default is neither T=1 nor greedy. Set sampling explicitly in every request you want reproducible.

## `/tokenize` behaviour (verified with curl)

- Request: `{"content": "<one string>"}`. Response: `{"tokens": [4072, 315, 7779]}`: IDs only.
- Add `"with_pieces": true` to get `{"tokens": [{"id": 4072, "piece": "Change"}, ...]}`.
- `"Change of Control"` is 3 tokens: `Change`, ` of`, ` Control`. **The space is part of the token** (` of`, not `of`). The tokenizer treats a leading space as part of the word.
- `content` as an array is accepted but the results are **concatenated into one flat list**, so you can't tell which tokens belong to which string. Send one request per string.

**Measured with `tokenize.ts`:**

| Input | Tokens |
|---|---|
| `Change of Control` | `Change`, ` of`, ` Control` (3) |
| `§ 12.3(b)(iv)` | `§`, ` `, `1`, `2`, `.`, `3`, `(b`, `)(`, `iv`, `)` (10) |
| `Acme Holdings, LLC` | `Ac`, `me`, ` Holdings`, `,`, ` LLC` (5) |

- **Qwen splits digits one at a time:** `12` is `1`, `2`. Affects amounts, dates and section numbers.
- Punctuation fuses with letters (`(b`) and across groups (`)(`).
- The space after `§` is its own token (ID 220).
- Rare names fragment (`Acme` is `Ac` + `me`); common words (`Holdings`, `LLC`) stay whole.

## TypeScript notes from the lab

- `tsc` passing does not mean the code works: a scheme-less URL typechecks and fails at runtime. `fetch` errors hide the cause; read `error.cause` (it said `unknown scheme`).
- `response.json()` returns `any`; `as SomeType` is a compile-time claim, not validation. Validate at boundaries later.
- Don't swallow errors in a `catch` that returns `null`: callers can't tell "no data" from "server down".
- `no-await-in-loop` lint: independent requests should run concurrently with `Promise.all` (fails fast; use `Promise.allSettled` for partial results; unbounded, so cap concurrency for bulk work). **Awaiting in a loop is correct when each iteration depends on the previous one**, e.g. the generation loop in Lab step 3. Silence the rule there with a comment explaining why.

## KV cache, preview (Chapter 2 verifies this)

- Every token processed at every layer leaves a **key vector** and **value vector** that later tokens attend to. Storing them avoids recomputing the whole history each step. That store is the KV cache.
- Per-token cache size = 2 (K and V) x layers x KV heads x head dimension x bytes per value.
- Qwen2.5-7B (recalled from memory, verify): 28 layers, 4 KV heads, head dimension 128, FP16 (2 bytes):
  - 2 x 28 x 4 x 128 x 2 = **57,344 bytes**, about 57 KB per token.
  - A full 131,072-token context = 131,072 x 57,344 = about **7.5 GB**, on top of the 4.7 GB of weights.
- **Why the cache grows with context, not with the weights:** the weights are learned once and are the same for every request. The cache is a record of *this particular input*: one entry per token, so it grows linearly with context length.
- It does depend on model *shape* (layers, KV heads, head dimension), not directly on parameter count. Qwen has 28 query heads but only 4 KV heads (grouped-query attention), which shrinks the cache about 7x versus storing one KV pair per query head.
- Open: is the 7.5 GB total, or per slot? Measure memory with the server idle vs. after a long prompt.

---

# Lab 1 (in progress)

Status: step 1 done (`labs/day1/tokenize.ts`). **Step 2 is next; user has not yet written it or made the prediction (see RESUME HERE).**

1. DONE: `/tokenize` on `"Change of Control"`, `"§ 12.3(b)(iv)"`, a party name. Print tokens and IDs.
2. `/completion` with `n_predict: 1`, `n_probs: 5`. Print the top 5 next-token candidates and probabilities.
3. Write your own generation loop: call the server one token at a time, append the winner, repeat until a sentence ends.
4. After step 2, rerun it at temperatures 0, 0.5, 1, 2 and compare against the table in section 3.

# Open questions
- How much of the Q4_K_M 4.85 bits/weight average is the scale factors vs. the higher-precision tensors? (Day 2)
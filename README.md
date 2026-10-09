# matterdesk: 16-day learning plan

Target role: Software Engineer, Full Stack & AI Infrastructure (Firmly, Law Firm Operating System).
Goal: be genuinely fluent in every line of the JD, by writing code heavily on one spine project: a permission-aware legal AI app.

## Ground rules

1. **You write the code.** Claude explains and reviews. Claude only generates boilerplate (Compose files, config), and you read every line of it.
2. **Review ritual on every commit.** One concern per commit. Before committing, explain each changed line. If you can't, stop and dig in.
3. **Name the concepts.** Each commit: 2-3 non-trivial concepts, listed briefly. No quizzes.
4. **Gate:** typecheck, lint, tests pass before any commit.
5. **Every day ends with a failure test** that attacks what you built. Security and infra claims need a test that tries to break them.

## JD-to-skill map

| JD requirement | Starting point | Days |
|---|---|---|
| Next.js 15, React 19, TS, Postgres | Strong | 3 (light) |
| Permission-aware AI access | New | 3, 5, 6 |
| RAG, embeddings, semantic search, ingestion | New | 4-7 |
| Open-source LLM deployment, model serving | New | 1, 2, 11 |
| Sandboxing for agents and generated code | New | 9 |
| Agentic systems, tool calling | New | 8 |
| Linux, Docker, networking, production | Partial | 12-13 |
| Quantization, fine-tuning, GPU, vLLM | New | 2, 10, 11 |
| Reviewing AI-generated code | Partial | 14 |
| Debugging across layers | Strong | 13 |

## Days

### Day 1: Inference internals
- **Build:** run `llama-server` locally (Qwen + DeepSeek-R1 distilled). TypeScript client for the OpenAI-compatible API that streams tokens and measures time-to-first-token (TTFT) and tokens/second.
- **Learn:** tokenization, sampling (temperature, top-p, top-k), key-value (KV) cache, prefill vs. decode.
- **Done when:** you can explain what happens between sending a prompt and receiving the 50th token.

### Day 2: Quantization and model architecture
- **Build:** script that quantizes one model to Q8_0, Q5_K_M, Q4_K_M, Q2_K and measures size, speed, perplexity. Output a table.
- **Learn:** VRAM math, block-wise quantization, AWQ/GPTQ/FP8 vs. GGUF, Mixture-of-Experts (MoE), Multi-head Latent Attention (MLA).
- **Done when:** you can derive VRAM for a 70B model at several precisions on paper, and explain why MoE is cheap per token but expensive to host.

### Day 3: Schema, auth, Row-Level Security (RLS)
- **Build:** Next.js 15 + Better Auth, schema (users, roles, matters, assignments, ethical walls, documents), RLS policies on documents and chunks. App connects as a non-superuser and sets a session variable per request.
- **Done when:** a test proves cross-matter reads fail even through raw SQL.
- **Trap:** superusers and table owners bypass RLS unless `FORCE ROW LEVEL SECURITY`.

### Day 4: Ingestion
- **Build:** pg-boss job queue, PDF extraction, three chunkers (fixed+overlap, recursive, clause-aware), local embeddings.
- **Learn:** what embeddings are, cosine similarity, query vs. document prefixes, dimension cost.
- **Done when:** 100 Contract Understanding Atticus Dataset (CUAD) contracts ingested.

### Day 5: pgvector in depth
- **Build:** benchmark harness: exact search, HNSW (Hierarchical Navigable Small World), IVFFlat, recall measurement, `halfvec`. Reproduce the filtered-search bug, fix with `hnsw.iterative_scan`, partial indexes, partitioning.
- **Done when:** you can show the bug and the fix with numbers.

### Day 6: Hybrid search and RAG
- **Build:** Postgres full-text search + vector search fused with Reciprocal Rank Fusion (RRF), cross-encoder reranker, chat UI with clickable `[doc, page]` citations.
- **Done when:** answers carry citations and only retrieve from permitted matters.

### Day 7: Evaluation
- **Build:** ~50-question golden set, recall@5, recall@10, mean reciprocal rank (MRR), LLM-as-judge script. Ablation grid: chunker x retrieval mode x reranker.
- **Done when:** "X improved recall@5 from A to B" with real numbers.

### Day 8: Agents from scratch
- **Build:** own agent loop, grammar-constrained tool calls, step limit, loop detection, audit table, human approval on side effects. Expose `search_documents` as a Model Context Protocol (MCP) server.
- **Done when:** the agent completes a multi-step task and you can show its trace.

### Day 9: Sandboxing and prompt injection
- **Build:** hardened Docker `run_python` (no network, read-only root fs, non-root, caps dropped, seccomp, resource limits, timeout) + attack suite. Planted injection in a contract that must fail to cross matters because RLS holds.
- **Learn:** isolation ladder: containers, gVisor, Firecracker.

### Day 10: Fine-tuning
- **Build:** QLoRA (Quantized Low-Rank Adaptation) clause classifier for CUAD categories on a free Kaggle/Colab GPU. Merge, convert to GGUF, quantize, compare vs. few-shot prompting.
- **Done when:** you can explain why fine-tuning teaches format, not knowledge.

### Day 11: GPU serving design
- **Build:** concurrency load test against `llama-server`; 1-2 page design doc "Serving AI for a 50-lawyer firm".
- **Learn:** PagedAttention, continuous batching, tensor vs. pipeline parallelism, speculative decoding, prefix caching, vLLM vs. SGLang vs. llama.cpp vs. Ollama, `nvidia-smi`.
- **Done when:** you can defend every number in the doc.

### Day 12: Linux, networking, deployment
- **Build:** production-style Compose stack: Caddy/nginx TLS, internal-only model network, systemd on a Linux VM. Tools: `ss`, `tcpdump`, `strace`, `journalctl`, `iptables`/`nftables`.
- **Learn:** cgroups and namespaces as the foundation of containers.
- **Done when:** you can trace a request from browser to model and back, naming every hop.

### Day 13: Production hardening and debugging stories
- **Build:** structured logs and tracing (Langfuse), health checks, retries with backoff, timeouts. Break things on purpose: kill model server mid-request, corrupt/500-page PDF, revoke access mid-session, change permissions after embedding.
- **Done when:** 3-4 real debugging stories.

### Day 14: AI-code-review
- **Build:** `review-drills/` with 8-10 AI-style diffs with planted bugs: missing tenant filter, superuser connection bypassing RLS, SQL injection via `ORDER BY`, unvalidated tool-call args, job-queue race, swallowed error, prompt-injection path, secret in a log. Find cold, then write the catching tests.
- **Learn:** your review checklist; a concrete answer to "how do you review AI-generated code".

### Day 15: Assessment drills
- Three timed 90-minute tasks from scratch in a browser editor (permissions endpoint, retrieval fix, bug hunt). No AI on the first pass, then compare.
- Drill cold recall of RLS, pgvector, and RRF syntax.

### Day 16: Rehearsal
- Present the project out loud. Answer the cold question list: embedding sync on permission change, RLS vs. prompt permissions, GPU sizing, MoE tradeoffs, fine-tune vs. RAG, containers vs. gVisor vs. microVMs, evaluating a new model, reviewing AI code.
- Finalize README: architecture diagram, decisions and tradeoffs.

**If behind, protect Days 3, 5, 7, 9, 14.**

## Repo layout

```
apps/web/            Next.js 15 app
services/ingest/     chunk, embed, queue workers
services/agent/      loop, tools, MCP server
services/sandbox/    hardened runner + attack suite
infra/               compose, Caddy, systemd, seccomp profile
eval/                golden set, harness, ablation results
review-drills/       planted-bug diffs
docs/                design doc, decisions log, debugging stories
```

# Designing AI Systems: course outline

A first-principles course for building and operating AI systems that handle sensitive data (law-firm context). The `matterdesk` project is the lab; the chapters are the point.

Each chapter has: the problem, the mechanism, worked numbers, a lab (you write the code), failure modes, and exercises you answer before we discuss them.

## Part I: Foundations of a language model system
1. **Language models as probability machines**: tokens, next-token distributions, the generation loop, statelessness. (Day 1)
2. **Attention and the KV cache**: what context costs. (Day 1)
3. **Generation in practice**: sampling, prefill vs. decode, latency. (Day 1)
4. **Memory and bandwidth**: why inference is a memory problem; the roofline model. (Day 1-2)
5. **Quantization**: trading bits for bytes. (Day 2)
6. **Architectures at scale**: Mixture-of-Experts, Multi-head Latent Attention. (Day 2)

## Part II: Data, retrieval, and boundaries
7. **Representations**: embeddings and similarity. (Day 4)
8. **Indexes for vectors**: exact search, HNSW, IVFFlat, recall. (Day 5)
9. **Retrieval**: chunking, hybrid search, fusion, reranking. (Days 4, 6)
10. **Permissions as a data-system property**: Row-Level Security, filtered search. (Days 3, 5)
11. **Evaluation**: measuring retrieval and answers honestly. (Day 7)

## Part III: Agents and trust
12. **Tool use and constrained decoding**. (Day 8)
13. **Agent loops and protocols** (Model Context Protocol). (Day 8)
14. **Sandboxing**: the isolation ladder. (Day 9)
15. **Prompt injection and trust boundaries**. (Day 9)

## Part IV: Adaptation, serving, operations
16. **Fine-tuning**: LoRA and what it can and can't teach. (Day 10)
17. **Serving systems**: batching, PagedAttention, parallelism, engine choice. (Day 11)
18. **Capacity planning**: sizing GPUs from first principles. (Day 11)
19. **Operating it**: Linux, networking, observability, failure. (Days 12-13)
20. **Reviewing AI-generated code**. (Days 14-16)

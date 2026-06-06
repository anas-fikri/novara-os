# Knowledge System

The Knowledge System enables the agent to search and pull information from workspace documentation, source code, and external wikis without loading entire files into the system prompt.

## Ingestion Pipeline

```
[ Local Files / Git Repo / Wiki ]
               │
               ▼
   1. [ Change Detection ] ──► (Track file updates via hash checks)
               │
               ▼
   2. [ Text Parsing ] ─────► (Extract Markdown, Code blocks, PDFs)
               │
               ▼
   3. [ Indexing Engine ] ──► (Index keywords or compute vector embeddings)
               │
               ▼
   4. [ Workspace DB ] ─────► (Store metadata in .novara/knowledge/index.db)
```

## Retrieval Mechanisms

*   **Keyword/Grep Search**: Fast, cost-efficient lexical search over workspace files.
*   **Vector Search**: Semantic search over indexed documents when lexical search is insufficient.
*   **On-Demand Injected Context**: Only the most relevant matching chunks are appended to the agent's prompt, reducing token waste.

## Dynamic Knowledge Ingestion (Self-Documenting)

In addition to crawling existing repository documentation, Novara OS builds its knowledge base dynamically through user interaction:

*   **`record_knowledge` & `record_fact` Tools**: If you supply general workspace knowledge (such as server IP addresses, database schemas, or infrastructure guides) during chat, the agent will dynamically call these tools to commit markdown documentation into `.novara/knowledge/` or save metadata facts to `facts.json`.
*   **Result**: The recorded information is instantly indexed by the workspace crawler and made available for query context matching in future sessions.


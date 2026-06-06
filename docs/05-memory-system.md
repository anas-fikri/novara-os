# Memory System

Novara OS segments memory to avoid context pollution and optimize token consumption.

## Memory Tiers

| Tier | Type | Storage | Lifecycle | Purpose |
|---|---|---|---|---|
| **Short-Term** | Session Memory | `.novara/memory/chat_history.jsonl` | Single session | Retain immediate conversational context and task progression. |
| **Medium-Term** | Working State | RAM / Temp Cache | Current Task execution | Retain variables, intermediate execution results, and tool outputs. |
| **Long-Term** | Semantic Memory | `.novara/memory/semantic/` (JSON/SQLite) | Persistent across sessions | Recall past instructions, configurations, custom facts, or user preferences. |

## Optimization Strategies

*   **Context Truncation**: Older messages are compressed, summarized, or dynamically dropped when approaching the token limit.
*   **Semantic Search**: Query long-term memory via embeddings only when relevant to the user's prompt (on-demand memory injection).

# MCP Runtime

Novara OS heavily leverages the **Model Context Protocol (MCP)** to interact with tools, resources, and prompt templates.

## Integration Model

```
[ LLM Provider ] ◄──► [ Agent Runtime ] ◄──► [ MCP Client (Novara) ]
                                                    │
                             ┌──────────────────────┴──────────────────────┐
                             ▼ (Stdio Transport)                           ▼ (SSE Transport)
                      [ MCP Server A ]                              [ MCP Server B ]
                   (e.g., Local Filesystem)                       (e.g., Remote Database)
```

## Features

1.  **Transport Support**:
    *   `stdio`: Spawn local server processes (e.g. Node, Python executables) and communicate via stdin/stdout.
    *   `sse` (Server-Sent Events): Connect to persistent remote HTTP servers.
2.  **Tool Mapping**: Dynamically reads MCP tool schemas and converts them to the corresponding LLM provider's function definition format.
3.  **Resource Discovery**: Maps MCP resources (files, logs, metrics) to LLM-readable text contexts.

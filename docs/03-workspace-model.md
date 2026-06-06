# Workspace Model

A Workspace in Novara OS defines the isolated boundary of knowledge, memory, and access rights.

## Directory Structure

Workspaces are defined declaratively in a target folder:

```
.novara/
├── workspace.yaml       # Core config (metadata, providers, active nodes, mcp servers)
├── memory/
│   ├── chat_history.jsonl # Session-based conversation logs
│   └── semantic/        # Vector index or key-value memory storage
├── knowledge/
│   ├── index.db         # Cache of indexed markdown and text files
│   └── sources/         # Local copy of referenced workspace files/docs
└── secrets.env          # Isolated environment variables and credentials (ignored in git)
```

## Workspace Configuration (`workspace.yaml`)

```yaml
version: "1"
name: "personal-homelab"
description: "Managing personal Proxmox cluster and Docker containers"

provider:
  default: "gemini/gemini-2.5-flash"
  fallback: "ollama/llama3"

mcp_servers:
  - name: "docker-manager"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-docker"]
  - name: "filesystem"
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/homelab/code"]

nodes:
  - name: "proxmox-01"
    type: "proxmox"
    endpoint: "https://192.168.1.100:8006"

settings:
  localization:
    primary_language: "id"   # Bahasa Indonesia (default/prioritas utama)
    fallback_language: "en"  # Bahasa Inggris (fallback jika translation tidak lengkap)

```

# Roadmap

Novara OS development is divided into four main phases:

## Phase 1: Core OS & CLI (v0.1.x)
- [x] Initial design and project conceptualization.
- [x] Implement Workspace Config (`workspace.yaml`) and workspace initialization CLI flow (`novara init`).
- [x] Build basic Provider Runtime wrapper supporting Google Gemini API.
- [x] Establish basic ReAct agent loop for CLI run/chat operations.
- [x] Enable global CLI commands via system linkage (`npm link`).
- [x] Implement directory walk-up workspace detection.

## Phase 2: Knowledge, Memory & MCP (v0.2.x)
- [x] Build local workspace Knowledge system using keyword/grep indexer.
- [x] Implement Short-term (JSONL) and Semantic memory.
- [x] Integrate local Stdio MCP Client to hook custom MCP tools dynamically.
- [x] Support dynamic slash commands (`/mcp`, `/add-mcp`, `/skills`, `/add-skill`).
- [x] Auto-extraction and saving of facts, knowledge, and skills from conversation turns.

## Phase 3: Infrastructure & Node Management (v0.3.x)
- [x] Implement SSH Node connector (remote script run, logs fetch).
- [x] Build Docker Node runtime to manage remote containers.
- [x] Add basic Proxmox API integration for VM/container inventory tracking.

## Phase 4: Production Polish & Web Interface (v1.0.x)
- [x] Integrate Google OAuth login flow for Gemini authentication (`novara login`).
- [x] Secure credential storage mechanism.
- [x] Release REST API Server & Queue engine (`novara serve`) for headless deployments and workspace monitoring.
- [x] Introduce multi-agent collaborative workflows (delegation & steering) inside workspaces.


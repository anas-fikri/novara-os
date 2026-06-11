# Novara OS

**Workspace-Oriented Intelligence Operating System CLI**

Novara OS is designed to help developers and IT professionals manage multiple workspaces, system nodes, knowledge documents, and AI tools from a unified, context-isolated CLI.

---

## Why Novara Exists

Modern IT professionals concurrently manage a wide range of contexts:
*   Corporate infrastructure and internal apps
*   Freelance projects
*   Personal homelabs
*   AI research and experimentation

Each context utilizes separate:
*   Servers, VMs, and Docker containers
*   Databases and Git repositories
*   Knowledge documents and credentials

Most AI tooling today focuses on single-agent loops or single-project contexts, leading to mixed contexts and poor token efficiency. Novara OS introduces a **Workspace-First** approach, keeping your projects completely separated.

---

## Core Vision & Design Principles

*   **Workspace First**: Workspaces form the primary boundary for agent memory, custom skills, tools, and configurations.
*   **Provider Agnostic**: Seamlessly choose and switch between Gemini, OpenAI, OpenRouter, and local Ollama models.
*   **Infrastructure Native**: Designed to orchestrate resources across SSH remote hosts, Docker, Proxmox, and databases.
*   **Token Efficient**: Lazy-loads context on-demand, leverages local grep/regex capabilities, and applies built-in context compression (caveman-style) + auto rolling summaries to minimize LLM token consumption across sessions.

---

## Installation & Setup Guide (From Scratch)

### Prerequisites
- **Node.js** v20.0.0 or higher.
- **npm** (installed automatically with Node.js).

### Step 1: Clone and Build the Project
Clone the repository and install all dependencies:
```bash
# Clone the repository
git clone git@github.com:anas-fikri/novara-os.git
cd novara-os

# Install dependencies
npm install

# Compile the TypeScript source code
npm run build
```

### Step 2: Install Globally
Install the CLI binary globally on your machine so it can be called from any directory:
```bash
npm install -g .
```
Verify the installation by checking the version:
```bash
novara --version
# or using the shorthand alias
nos --version
```

### Step 3: Set Up Autocomplete (Optional)
To set up shell tab-completion for `novara` commands, run:
```bash
novara completion
```
Follow the prompts to add the autocomplete script to your shell configuration file (e.g., `~/.zshrc`). Reload your shell configuration afterwards:
```bash
source ~/.zshrc
```

---

## Quick Start & Usage

### 1. Initialize a Workspace
Navigate to any project directory and initialize it as a Novara OS workspace:
```bash
mkdir my-new-workspace
cd my-new-workspace

# Run interactive setup
novara init
```
*Tip: For automated script setups, you can initialize a workspace non-interactively using:*
```bash
novara init --name "my-workspace" --yes
```

### 2. Configure LLM API Keys
Configure your preferred LLM provider. For example, to set up Gemini:
```bash
novara set-key gemini "YOUR_API_KEY_HERE"
```
Or run the guided setup wizard to configure default models and keys:
```bash
novara setup
```

### 3. Check Workspace Info
Verify your active workspace settings and loaded configurations:
```bash
novara workspace
```

### 4. Run a Single Task
Ask the agent to execute a single task directly:
```bash
novara run "Verify the contents of the current directory and write a summary to summary.txt"
```

---

## Interactive CLI Chat Session (TUI Guide)

Launch the interactive chat interface to work with the AI agent dynamically:
```bash
novara chat
```

### Interface Features & Layout
*   **Persistent Status Box**: Displayed at the top of the prompt to show the currently active workspace name, default LLM model, and connected MCP servers.
*   **Interactive Shell**: Supports command history, standard keyboard shortcuts, and smart prompts.
*   **Tab Autocomplete**: Type `/` or `\` and press `[Tab]` to display or autocomplete slash commands. Pressing `[Tab]` after `/model` will list and search available models.
*   **Auto Update Detection**: On startup, `novara chat` automatically checks if a newer version of the CLI is published on GitHub, displaying an inline warning notification if your local installation is outdated.

### Steering & Human-in-the-Loop Approval
When the agent executes any **mutative tool** (such as editing code, writing documents, creating directories, running bash scripts, or calling infrastructure API endpoints), the terminal prompts the user with detailed information and an interactive option menu:
1.  **Yes (Approve)**: Run the tool and return the output to the agent.
2.  **No (Reject)**: Reject tool execution and tell the agent to find an alternative way.
3.  **Preview (🔍 Lihat Pratinjau)**: Displays proposed file content/code inline inside the terminal with line numbers (available when writing or modifying files) before approving.
4.  **Modify (✏️ Edit Isi)**: Opens the proposed content in the user's default text editor (using `process.env.EDITOR` or `nano`/`notepad`). The modified content is automatically read back and updated before tool execution.
5.  **Steer (Correct)**: Deny execution and type a custom message to redirect the agent's logic.
6.  **Exit (Cancel)**: Terminate the active task loop immediately.

### Sub-Agent Spawning

Novara OS supports **dynamic sub-agent spawning** directly from within a chat session or agent task loop. The main agent can delegate focused sub-tasks to specialized agents that run in an isolated context and return a final report — keeping the main conversation clean and token-efficient.

#### How It Works

The main agent has access to a native `delegate_task` tool. When it decides a sub-task would be better handled by a specialized agent, it calls this tool automatically:

```
User query
    │
    ▼
┌─────────────────────────────────────────┐
│         Novara OS Main Agent            │
│   (up to 10 ReAct iterations, full     │
│    tool access + delegate_task)         │
└────────────────┬────────────────────────┘
                 │ delegate_task(agentType, subTaskQuery)
        ┌────────┴──────────────────────────────┐
        │                                        │
        ▼                                        ▼
┌──────────────────┐                  ┌──────────────────┐
│  Local Sub-Agent │                  │  Hermes (Remote) │
│  infrastructure  │                  │  via HTTP ACP    │
│  research        │                  │  POST /v1/acp/run│
│  coder           │                  └──────────────────┘
│  general         │
│ (max 5 iters,    │
│  no recursion)   │
└──────────────────┘
        │
        ▼
  "Laporan hasil dari Sub-Agent [type]: ..."
  returned back to main agent context
```

#### Available Sub-Agent Types

| `agentType` | Role | Capabilities |
|---|---|---|
| `infrastructure` | Server & infra specialist | SSH node exec, Docker, Proxmox VM/container mgmt, log reading |
| `research` | Information gatherer | Read files, search knowledge base, summarize findings — **no destructive actions** |
| `coder` | Code writer & debugger | Write/edit code files, architecture design, bug fixing, API docs |
| `general` | General-purpose helper | Coordination, Q&A, broad workspace tasks |
| `hermes` | External remote agent | Delegates via HTTP to `HERMES_API_URL` (Agent Communication Protocol) |

#### Triggering Sub-Agents

Sub-agents are **triggered automatically by the main agent** — you don't call them directly. Simply describe your task and the agent will decide when delegation is appropriate:

```
You › Scan the production server for disk usage, then write a cleanup script based on what you find.
```
The main agent might:
1. Call `delegate_task(agentType: "infrastructure", subTaskQuery: "Check disk usage on prod-server node")` → get a report
2. Use the report to call `delegate_task(agentType: "coder", subTaskQuery: "Write bash cleanup script for /var/log based on: <report>")` → get the script
3. Present both results to you

You can also **explicitly ask** for sub-agent delegation in your prompt:
```
You › Use a research sub-agent to find all TODO comments in the codebase, then summarize them.
You › Delegate to the infrastructure agent: restart the nginx container on node app-server-1.
```

#### Sub-Agent Architecture & Constraints

| Property | Main Agent | Sub-Agent |
|---|---|---|
| Max ReAct iterations | 10 | 5 |
| Access to `delegate_task` | ✅ Yes | ❌ No (anti-recursion) |
| Chat history context | Full session history | Fresh context only (isolated) |
| Memory write (facts/knowledge) | ✅ Yes | ✅ Yes |
| Human-in-the-loop approval | ✅ All mutative tools | ✅ All mutative tools |
| Returns to parent | — | Single consolidated report string |

> **Anti-recursion guard**: Sub-agents do not have access to the `delegate_task` tool, preventing infinite spawning loops.

#### ACP & Hermes Integration (Bidirectional)

Novara OS supports bidirectional agent-to-agent communication via the **Agent Communication Protocol (ACP)**:

**Novara OS → Hermes (outbound):**
```bash
# Set Hermes endpoint in workspace secrets
nos set-key hermes_api_url "http://localhost:8316"
# Then from chat, the agent can delegate:
# delegate_task(agentType: "hermes", subTaskQuery: "...")
```

**Hermes → Novara OS (inbound):**  
External agents can invoke Novara OS as a sub-agent synchronously via REST:
```bash
POST http://localhost:8088/v1/acp/run
Content-Type: application/json

{ "query": "Check docker container status on all nodes", "sender": "hermes" }
```
Returns: `{ "result": "...", "success": true }`

**Integration with other agents (Claude CLI, Codex CLI, Agy, VSCode):**  
Any agent or tool that can make HTTP requests can use Novara OS as an execution backend:
```bash
# Start Novara OS as a background service
nos serve --daemon

# From any agent/tool: POST tasks and poll results
POST /v1/agent/run   → { "query": "..." }  # async, returns taskId
GET  /v1/tasks       → list all tasks + status + results
```

### Standardized Development Flow (Super-BMAD SOP)
Every feature development lifecycle follows a standardized documentation flow under the `super-bmad` skill:
*   Documents are placed in `.novara/docs/` to keep the main workspace directory clean.
*   The lifecycle enforces four stages with skeletal, token-efficient templates:
    1.  `01_meeting_minutes.md` (Alignment & multi-persona AI discussion)
    2.  `02_technical_specification.md` (Database models, API contracts, file blueprint)
    3.  `03_test_report.md` (Test cases, debugging history)
    4.  `04_release_changelog.md` (Feature changes, env config, deploy instructions)

### In-Session Slash Commands
Use the following slash commands within a chat session to inspect or configure the runtime:
*   `/help` — Display list of available slash commands.
*   `/session` — View active session name and list all sessions.
*   `/session new <name>` — Create and switch to a new chat session.
*   `/session load <name>` — Load and switch to an existing chat session.
*   `/session delete <name>` — Delete a session and its history file.
*   `/model [name]` — View or change the active LLM model (e.g., `/model openrouter/meta-llama/llama-3-8b-instruct`).
*   `/set-key <provider> <key>` — Save API Key for a provider.
*   `/tools` — List all active tools (MCP and Native).
*   `/mcp` — Inspect connected Model Context Protocol servers.
*   `/add-mcp <name> <cmd> [args...]` — Register a new MCP server. If run without arguments, launches an interactive wizard with built-in templates (Filesystem, Git, Puppeteer, SQLite, Postgres, MSSQL, Fetch, Brave Search, Custom) supporting fully interactive connection parameter inputs.
*   `/skills` — View custom skill directories in the workspace (includes option to install external skills).
*   `/add-skill <name> <description>` — Scaffold a new custom skill template.
*   `/add-skill install <git-url/folder-path> [custom_name]` — Dynamically install a skill from a Git repository or a local folder path.
*   `/facts` — View persistent long-term memory facts.
*   `/fact <key> <value>` — Instantly save a persistent preference to memory.
*   `/scan` — Scan local disk to auto-discover MCP servers & SSH nodes.
*   `/queue` — Show background task queue statuses.
*   `/queue add <query>` — Send a task to the background REST queue worker.
*   `/summary` — Display the rolling memory summary for the active session.
*   `/summary consolidate` — Force-generate or update the session summary immediately.
*   `/memory-config` — View the current Memory Consolidator configuration.
*   `/memory-config set <key> <value>` — Update a consolidator setting at runtime. Keys: `auto-summary`, `target-tokens`, `min-turns`, `domains`.
*   `/clear` — Clear current chat memory history.
*   `/cls` — Clear the console screen.
*   `/exit` / `/quit` — Close the chat session and auto-generate a final session summary report.

---

## Context Compressor

Novara OS includes a built-in **Context Compressor** (`src/core/compressor.ts`) inspired by the caveman-compress philosophy — *"why use many words when few words do trick?"* — with no external dependencies.

### How It Works

| Layer | Action |
|---|---|
| **Filler stripping** | Removes pleasantries, hedging phrases, and redundant connectors (both Indonesian & English) |
| **Pattern collapsing** | Collapses verbose expressions into dense equivalents (e.g. *"adalah"* → `=`, *"→"*) |
| **Code preservation** | All ` ``` ` code blocks are preserved byte-for-byte, never touched |
| **Structure preservation** | Markdown headings, bullet lists, file paths, URLs, numbers, and technical terms are kept intact |
| **History compression** | If chat history exceeds **4,000 tokens**, older messages are compressed automatically; the 6 most recent messages stay verbatim |

### Token Savings
- **~40–60%** reduction on conversational/explanatory text
- **0%** reduction on code blocks (preserved exactly)
- Compression triggers automatically — no configuration needed

---

## Memory Consolidator & Rolling Summary

Novara OS includes a **Memory Consolidator** (`src/core/consolidator.ts`) that solves the context window problem across long sessions and between separate sessions.

### Features

#### 1. Auto Rolling Summary
After every conversation turn (starting from turn 3), the consolidator automatically generates a compact rolling summary in the **background** (non-blocking) using the same default model already configured — no separate cheap model needed. Output length is controlled dynamically via `target-tokens`.

```
Session turn 1 ──► ...
Session turn 2 ──► ...
Session turn 3 ──► [background] → summary generated → stored in .novara/memory/
Session turn 4 ──► [background] → summary updated
...
```

#### 2. Context Continuity Across Sessions
The rolling summary is automatically **injected into the system prompt** at the start of every new turn. This means even if you start a new `nos chat` session, the agent already knows what was done in previous turns — without replaying the entire JSONL history.

#### 3. Meta Tagging & Domain Detection
Each summary is automatically tagged with a detected domain:

| Domain | Detected From |
|---|---|
| `coding` | code, bug, function, deploy, build, git, npm, typescript... |
| `infrastructure` | server, docker, ssh, proxmox, nginx, k8s, database... |
| `research` | research, analisis, laporan, dokumentasi, paper... |
| `devops` | ci/cd, pipeline, terraform, ansible, monitoring... |
| `planning` | rencana, roadmap, sprint, spesifikasi, arsitektur... |

#### 4. Domain Guardrail
Optionally restrict the agent to specific domains for a workspace. If a query falls outside the allowed domains, a warning is shown before processing:
```bash
# Restrict workspace to coding and devops topics only
/memory-config set domains coding,devops
```
> **Note**: Guardrail is informational-only (not a hard block) — queries still proceed with a visible warning. No expiration/TTL is applied to summaries; developers often revisit work from years ago.

#### 5. Exit Report
When you type `/exit`, Novara OS automatically generates a final session summary and displays it in a formatted box:
```
┌──────────────────────────────────────────────────────────────┐
│  🧠 Ringkasan Sesi: default                                  │
├──────────────────────────────────────────────────────────────┤
│  - Tambah Context Compressor & Memory Consolidator           │
│  - Fix daemon --stop menggunakan PID file                    │
│  - Update readme dengan fitur baru                           │
├──────────────────────────────────────────────────────────────┤
│  🏷️  coding | devops                                         │
└──────────────────────────────────────────────────────────────┘
  💾 Summary disimpan di .novara/memory/
```

### Storage
All summary data is stored locally in the workspace memory directory:
```
.novara/
└── memory/
    ├── chat_history_default.jsonl          # Raw conversation log (existing)
    ├── session_summary_default.json        # Rolling summary + tags (new)
    └── session_summary_<name>.json         # Per-named-session summaries
```

### Memory Consolidator Configuration

| Setting | Default | Description |
|---|---|---|
| `auto-summary` | `true` | Enable/disable background auto summarization |
| `target-tokens` | `300` | Max token budget for the rolling summary (~225 words) |
| `min-turns` | `3` | Minimum conversation turns before first summary |
| `domains` | *(unrestricted)* | Comma-separated list of allowed domains for guardrail |

Configure at runtime:
```bash
/memory-config set target-tokens 500
/memory-config set min-turns 5
/memory-config set domains coding,infrastructure
/memory-config set auto-summary false
```

Or add to `workspace.yaml` for persistent config:
```yaml
memory_consolidator:
  enableAutoSummary: true
  targetSummaryTokens: 300
  minTurnsBeforeSummary: 3
  guardrailDomains: []
```

---

## API Server (Daemon Mode)

The `nos serve` command launches a REST API server for background task queue processing. It can be run as a persistent OS-level background service.

### Daemon Commands

| Command | Description |
|---|---|
| `nos serve` | Start the server in **foreground** (blocks terminal). Press `Ctrl+C` to stop. |
| `nos serve --daemon` | Start the server as a **background daemon** (releases terminal immediately). PID saved to `server.pid`. |
| `nos serve --stop` | Gracefully stop the running daemon (`SIGTERM`, then `SIGKILL` if needed). |
| `nos serve --status` | Check whether the daemon is currently running, and display its PID and log path. |
| `nos serve -p <port>` | Start the server on a custom port (default: `8088`). |

### Usage Example
```bash
# Start in background
nos serve --daemon
# ✔ Novara OS API Server berjalan sebagai background service di port 8088
#    PID     : 43488
#    Log     : /path/to/workspace/server.log
#    Untuk menghentikan  → nos serve --stop
#    Untuk cek status   → nos serve --status

# Check status from any terminal
nos serve --status
# ✔ Daemon aktif — PID: 43488, Port: 8088

# Stop gracefully
nos serve --stop
# ✔ Daemon (PID: 43488) berhasil dihentikan.
```

### REST API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Server status, version, and available endpoints |
| `GET` | `/v1/tasks` | List all tasks in the queue with their status |
| `POST` | `/v1/agent/run` | Add a new async task to the queue (`{ "query": "..." }`) |
| `POST` | `/v1/workspace/select` | Switch active workspace context |
| `POST` | `/v1/acp/run` | Run a synchronous ACP task (for agent-to-agent communication) |

### Log Files
All server output (stdout + stderr) is appended to `server.log` in the workspace root:
```bash
tail -f /path/to/workspace/server.log
```

---

## Global CLI Command List

Here is the complete list of commands available globally via `novara <command>`:

| Command | Description |
|---|---|
| `init` | Initialize a new Novara OS workspace in the current folder. |
| `login` | Authenticate using Google OAuth flow. |
| `set-key <provider> <key>` | Interactively save API key credentials. |
| `setup` | Launch interactive configuration wizard for providers and keys. |
| `model [model]` | View or change default workspace model. |
| `mcp` | Manage registered MCP servers. |
| `nodes` | Manage remote SSH and Docker infrastructure nodes. |
| `skills` | Manage custom workspace skills. |
| `facts` | Manage persistent memory facts and user preferences. |
| `scan` | Scan local directories to auto-import MCPs and SSH nodes. |
| `workspace` | Output config details of the current workspace. |
| `run <query>` | Run a single agent instruction. |
| `chat` | Start an interactive CLI chat session. |
| `logs` | View recent conversation logs or clear them with `--clear`. |
| `serve` | Launch the REST API server. Use `--daemon` to run in background, `--stop` to stop it, `--status` to check. |
| `completion` | Setup shell autocomplete integration (zsh/bash). |
| `update` | Update Novara OS to the latest version from GitHub automatically. |
| `uninstall` | Completely purge Novara OS config, macOS Keychain credentials, and global CLI package. |

---

## E2E Testing & Packaging

For automated verification of your installation and REST endpoints, run:
```bash
npm run test
```

To package the project into a self-contained production tarball:
```bash
npm run package
```
*Refer to [docs/15-production-deployment.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/15-production-deployment.md) for headless setup and production process manager configurations.*

---

## Documentation Structure

For deep architectural details, consult the markdown documents in the [docs/](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/) folder:
*   **Vision & Design**: [00-vision.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/00-vision.md) & [01-principles.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/01-principles.md)
*   **Architecture & Workspaces**: [02-architecture.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/02-architecture.md) & [03-workspace-model.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/03-workspace-model.md)
*   **Runtimes & Storage**: 
    - Agent Loop & Tools: [04-agent-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/04-agent-runtime.md) & [08-tool-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/08-tool-runtime.md)
    - Memory & Knowledge base: [05-memory-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/05-memory-system.md) & [06-knowledge-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/06-knowledge-system.md)
    - Custom Skills & MCPs: [07-skill-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/07-skill-system.md) & [09-mcp-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/09-mcp-runtime.md)
    - LLM Providers & Security keyring: [10-provider-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/10-provider-runtime.md) & [11-security-model.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/11-security-model.md)
*   **Interface & Nodes**: [12-node-management.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/12-node-management.md) & [13-interface-layer.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/13-interface-layer.md)
*   **Production & Roadmap**: [14-roadmap.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/14-roadmap.md) & [15-production-deployment.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/15-production-deployment.md)
*   **OAuth Setup**: [google_oauth_guide.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/google_oauth_guide.md)

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
*   **Token Efficient**: Lazy-loads context on-demand and leverages local grep/regex capabilities to minimize LLM token consumption.

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

### Steering & Human-in-the-Loop Approval
When the agent executes any **mutative tool** (such as editing code, creating directories, running bash scripts, or calling infrastructure API endpoints), the terminal prompts the user for confirmation:
1.  **Yes (Approve)**: Run the tool and return the output to the agent.
2.  **No (Reject)**: Reject tool execution and tell the agent to find an alternative way.
3.  **Steer (Correct)**: Deny execution and type a custom message to redirect the agent's logic.
4.  **Exit (Cancel)**: Terminate the active task loop immediately.

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
*   `/add-mcp <name> <cmd> [args...]` — Register and launch a new MCP server.
*   `/skills` — View custom skill directories in the workspace (includes option to install external skills).
*   `/add-skill <name> <description>` — Scaffold a new custom skill template.
*   `/add-skill install <git-url/folder-path> [custom_name]` — Dynamically install a skill from a Git repository or a local folder path.
*   `/facts` — View persistent long-term memory facts.
*   `/fact <key> <value>` — Instantly save a persistent preference to memory.
*   `/scan` — Scan local disk to auto-discover MCP servers & SSH nodes.
*   `/queue` — Show background task queue statuses.
*   `/queue add <query>` — Send a task to the background REST queue worker.
*   `/clear` — Clear current chat memory history.
*   `/cls` — Clear the console screen.
*   `/exit` / `/quit` — Close the chat session.

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
| `serve` | Launch the REST API server for background queue execution. |
| `completion` | Setup shell autocomplete integration (zsh/bash). |

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

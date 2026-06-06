# Interface Layer

The Interface Layer is the boundary through which the user interacts with Novara OS.

## CLI (Command Line Interface)

The primary interface for developers and IT admins.

### Global Installation & Usage

Novara OS can be installed globally on your machine to be invoked from any directory:

```bash
# Link the CLI binary globally
cd ai/novara-os
npm link

# Now you can run it from anywhere
novara --version
```

### Directory Walk-up Workspace Detection

When running the `novara` CLI, the system automatically checks if the current folder is a workspace. If not, it walks up the directory tree to search for the nearest `.novara/` folder (similar to how `git` searches for `.git`). This allows you to run commands inside any subdirectory of your project seamlessly.

### Basic Commands

```bash
# Initialize a new workspace in the current directory
novara init

# Login to Google Account via OAuth
novara login

# Save API Key/credentials interactively
novara set-key gemini "YOUR_API_KEY"

# View current active workspace configuration
novara workspace

# Execute a single prompt inside the active workspace context
novara run "Check disk space on proxmox-01"

# Enter an interactive agent chat session
novara chat

# View logs of tasks and tool executions
novara logs

# Scan local disk to auto-discover and import MCPs/Nodes
novara scan

# Start REST API server to process task queue
novara serve [--port 8088]
```

### Interactive Sessions & Slash Commands

When in an interactive session (`novara chat`), users can directly control the Novara OS runtime parameters using **slash commands**:

*   **`/help`** — Display a list of all available help commands.
*   **`/session`** — Display active session name and list all sessions.
*   **`/session new <name>`** — Create and switch to a new chat session.
*   **`/session load <name>`** — Load and switch to an existing chat session.
*   **`/session delete <name>`** — Delete an existing session and its history file.
*   **`/model [model_name]`** — View the active LLM model, or change it instantly (example: `/model gemini-1.5-pro`).
*   **`/set-key <provider> <key>`** — Save the provider's API Key interactively (example: `/set-key gemini AIzaSy...`).
*   **`/tools`** — Display a list of all active MCP and Native tools in the workspace.
*   **`/mcp`** — Display the list of registered MCP servers and their configurations.
*   **`/add-mcp <name> <cmd> [args...]`** — Add a new MCP server to the configuration and connect to it immediately. If run without arguments, it launches a guided wizard with built-in templates (Filesystem, Git, Puppeteer, SQLite, Postgres, Fetch, Brave Search, Custom).
*   **`/skills`** — Display a list of all custom skill modules installed in the workspace (includes option to install external skills).
*   **`/add-skill <name> <desc>`** — Create a new custom skill folder template instantly.
*   **`/add-skill install <git-url/folder-path> [custom_name]`** — Dynamically clone or copy an external skill into the workspace.
*   **`/facts`** — Display all persistently stored facts and user preferences.
*   **`/fact <key> <value>`** — Instantly save a new fact or preference to the long-term memory system.
*   **`/scan`** — Scan the local disk to interactively detect MCP servers & SSH/Docker Nodes and import them into the workspace.
*   **`/queue`** — Display the task queue status from the API server.
*   **`/queue add <query>`** — Add a new task to the API server queue.
*   **`/clear`** — Clear the conversation history for the current active chat session.
*   **`/cls`** or **`/clear-screen`** — Clear the TUI screen display (maintaining conversation context).
*   **`/exit`** or **`/quit`** — Exit the interactive session.

### Steering & Approval Confirmation (Interactive Approval)

When the agent triggers a mutative tool that can change the system state (such as editing a file or stopping a Docker container), the CLI/TUI will display an interactive approval prompt with the following choices:
1. **Yes (Approve)**: Run the tool and return the output to the agent.
2. **No (Reject)**: Reject tool execution and return a rejection message so the agent seeks alternative paths.
3. **Steer (Correct)**: Reject tool execution and allow the user to provide textual feedback directly. This feedback is fed back into the agent's ReAct history as input instructions for its next steps.
4. **Exit (Cancel Task)**: Cancel the task entirely and exit the agent iteration.




## REST API

Enables headless server deployments and remote Web UI client connections:

*   `GET /v1/tasks` -> List task queue and status.
*   `POST /v1/workspace/select` -> Select active workspace.
*   `POST /v1/agent/run` -> Add task/message to queue.

## Localization & Human Interaction

To ensure comfortable interactive sessions, the agent's communication language is controlled dynamically via workspace settings:

*   **Primary Language**: **Bahasa Indonesia** is preferred and enforced as the default language for all chat responses, feedback prompts, and explanations.
*   **Fallback Language**: **English** is used as a fallback if specific operational terms, error logs, or resources are better explained in English or if direct translation is unavailable.
*   The Interface Layer passes these preferences to the Core Orchestrator during context assembly, prompting the LLM to format its conversational output accordingly.


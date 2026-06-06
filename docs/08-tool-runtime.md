# Tool Runtime

The Tool Runtime handles execution of local scripts, commands, and native utilities requested by the agent.

## Execution Model

*   **Sandboxing**: Scripts and commands run inside a constrained environment where environment variables are strictly limited to those defined in `secrets.env` or workspace configuration.
*   **Execution Limits**:
    *   **Timeout**: Commands have a default timeout (e.g., 30s) to prevent hanging processes.
    *   **Output Cap**: Standard output and error streams are truncated (e.g., max 10KB) to prevent token overflow.
*   **Interactive Handling**: Interactive commands (like nano, vim, top) are forbidden. The agent must use non-interactive commands.
*   **Approval Levels**: Command execution is gated based on safety profiles:
    *   *Safe* (e.g., `cat`, `ls`, `grep`) -> Auto-run.
    *   *Mutative* (e.g., `rm`, `mv`, `git commit`) -> User Approval.
    *   *Dangerous* (e.g., `dd`, raw command strings to shell) -> Restrained or Strict Confirmation.

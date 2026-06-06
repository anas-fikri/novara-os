# Security Model

Novara OS operates under a **Strict-Isolation Security Model** to protect systems, source code, and credentials across multiple client and personal environments.

## Isolation Mechanisms

1.  **Workspace Boundary**:
    *   Secrets (keys, API tokens) are securely encrypted on disk in `.novara/secrets.enc` using AES-256-GCM.
    *   **Master Key Integration**: The encryption key is derived using PBKDF2 from a master password securely stored in the native OS Keychain (macOS Keychain Services, Windows Data Protection API (DPAPI) via PowerShell, or Linux Secret Service via secret-tool). If no keychain is available, it falls back to a restricted user-only file (`0600` permissions) or RAM-only session key.
    *   Path traversal is blocked. Filesystem tools are bound only to the workspace folder or directories explicitly declared in `workspace.yaml`.
2.  **Credential Sandboxing**:
    *   Passwords and access keys for remote nodes (SSH/API) are loaded into RAM only on-demand during command execution and cleared immediately after.
3.  **Human Verification Checkpoints**:
    *   All write/destructive operations (e.g. `rm`, `iptables`, modifying DNS records, docker container destruction) require explicit human signature via console or API approval.
    *   Command validation: Agent-generated commands are parsed for shell injection or malicious flags prior to runtime execution.

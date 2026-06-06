# Guiding Principles

Novara OS development adheres to these core architectural guidelines to maintain high efficiency and strict security:

1.  **Zero Leakage (Isolasi Konteks)**: Data, secrets, memory, and code from Workspace A must never bleed into Workspace B.
2.  **Token Budgeting (Efisiensi Token)**: Prefer local code execution, regex/grep, and semantic cache over raw LLM calls. Keep prompts minimal; load context on-demand.
3.  **Local-First / Infra-Native**: Maximize utilization of local computation and standard system protocols (SSH, Docker API, MCP) before falling back to complex cloud agent frameworks.
4.  **Deterministic Controls**: AI agents suggest and draft, but critical actions (destructive operations, infrastructure changes) require explicit user approval (Human-in-the-Loop).
5.  **Declarative Configurations**: Define workspaces, nodes, and automation flows as version-controlled text files (YAML/JSON).
6.  **Simplicity in Operation (Kemudahan Pengoperasian)**: Memprioritaskan alur kerja pengguna yang sederhana dan intuitif. Inisialisasi, perpindahan workspace, dan eksekusi tugas harus dapat dilakukan dengan perintah minimal. Sistem harus menyembunyikan kompleksitas teknis (seperti manajemen transport MCP atau optimasi token) dari pengalaman harian pengguna.


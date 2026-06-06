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

# Simpan API Key/kredensial secara interaktif
novara set-key gemini "API_KEY_ANDA"

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

# Mulai REST API server untuk memproses antrean tugas (task queue)
novara serve [--port 8088]
```

### Sesi Interaktif & Slash Commands

Saat berada dalam sesi interaktif (`novara chat`), pengguna dapat mengontrol parameter runtime Novara OS secara langsung menggunakan **perintah slash (slash commands)**:

*   **`/help`** — Menampilkan daftar semua perintah bantuan yang tersedia.
*   **`/model [nama_model]`** — Melihat model LLM aktif, atau mengubahnya secara instan (contoh: `/model gemini-1.5-pro`).
*   **`/set-key <provider> <key>`** — Menyimpan API Key penyedia secara interaktif (contoh: `/set-key gemini AIzaSy...`).
*   **`/tools`** — Menampilkan semua daftar peralatan (tools) MCP dan Native yang saat ini sedang aktif dalam workspace.
*   **`/mcp`** — Menampilkan daftar server MCP terdaftar beserta konfigurasinya.
*   **`/add-mcp <name> <cmd> [args...]`** — Menambahkan server MCP baru ke konfigurasi dan langsung menghubungkannya (contoh: `/add-mcp sqlite npx -y @modelcontextprotocol/server-sqlite`).
*   **`/skills`** — Menampilkan daftar semua modul skill kustom yang terpasang di workspace.
*   **`/add-skill <name> <desc>`** — Membuat kerangka folder skill kustom baru secara instan.
*   **`/facts`** — Menampilkan seluruh memori fakta/preferensi pengguna yang tersimpan secara persisten.
*   **`/fact <key> <value>`** — Menyimpan fakta atau preferensi baru ke sistem memori jangka panjang secara instan.
*   **`/scan`** — Pindai disk lokal untuk mendeteksi MCP server & SSH/Docker Node secara interaktif dan mengimpornya ke workspace (baik workspace aktif maupun tenant baru).
*   **`/queue`** — Tampilkan status antrean tugas dari API server.
*   **`/queue add <query>`** — Tambahkan tugas baru ke antrean API server.
*   **`/clear`** — Membersihkan riwayat percakapan untuk sesi obrolan yang sedang berjalan.
*   **`/cls`** atau **`/clear-screen`** — Bersihkan tampilan layar TUI (konteks percakapan tetap dipertahankan).
*   **`/exit`** atau **`/quit`** — Keluar dari sesi interaktif.

### Steering & Konfirmasi Persetujuan (Interactive Approval)

Ketika agen memicu alat (tool) mutatif yang dapat mengubah state sistem (seperti mengedit berkas atau mematikan kontainer Docker), TUI akan menampilkan prompt persetujuan interaktif dengan pilihan sebagai berikut:
1. **Ya (Setujui)**: Menjalankan alat dan mengembalikan hasilnya ke agen.
2. **Tidak (Tolak)**: Menolak eksekusi alat dan mengembalikan pesan penolakan agar agen mencari alternatif.
3. **Steer (Beri Koreksi)**: Menolak eksekusi alat dan memungkinkan pengguna memberikan masukan/feedback tekstual secara langsung. Feedback ini dimasukkan ke dalam riwayat ReAct agen sebagai input petunjuk/koreksi arah kerja berikutnya.
4. **Keluar (Batalkan Tugas)**: Membatalkan tugas secara keseluruhan dan keluar dari iterasi agen.




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


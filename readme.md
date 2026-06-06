# Novara OS

## Why Novara Exists

Novara lahir dari kebutuhan nyata seorang IT professional yang bekerja di banyak konteks sekaligus.

Dalam satu waktu terdapat:

* Infrastruktur perusahaan
* Aplikasi internal perusahaan
* Project freelance
* Homelab pribadi
* Eksperimen AI
* Ide dan produk yang sedang dibangun

Masing-masing memiliki:

* Server
* Virtual machine
* Container
* Database
* Repository
* Dokumentasi
* Workflow
* Pengetahuan

Sebagian besar tools AI saat ini berfokus pada satu percakapan, satu agent, atau satu project.

Sementara kebutuhan nyata jauh lebih kompleks.

Yang dibutuhkan bukan sekadar AI Agent.

Yang dibutuhkan adalah sistem yang mampu memahami konteks kerja yang berbeda, memisahkan knowledge dan memory, serta mengelola resource lintas workspace dengan aman.

---

## The Problem

Saat ini informasi tersebar di banyak tempat:

* ChatGPT
* Dokumentasi
* Git Repository
* Server
* Monitoring
* Wiki
* Catatan pribadi

Selain itu terdapat banyak workspace yang tidak boleh tercampur:

* Perusahaan A
* Perusahaan B
* Freelance
* Personal Project

Sebagian besar AI Agent tidak memiliki konsep workspace yang kuat sehingga konteks sering tercampur dan penggunaan token menjadi tidak efisien.

---

## Vision

Novara adalah Workspace-Oriented Intelligence Operating System.

Tujuannya bukan menggantikan manusia.

Tujuannya adalah membantu manusia mengelola:

* Workspace
* Knowledge
* Memory
* Infrastructure
* Automation
* Intelligence

dalam satu sistem yang konsisten.

---

## Core Ideas

### Workspace First

Semua aktivitas terjadi dalam workspace.

Workspace menjadi boundary utama untuk:

* Memory
* Knowledge
* Resource
* Agent
* Automation

---

### Intelligence, Not Just AI

Novara tidak bergantung pada satu model AI.

Sumber intelligence dapat berasal dari:

* LLM
* Workflow
* MCP
* Script
* Automation
* Human Approval

---

### Provider Agnostic

Novara harus dapat bekerja dengan:

* OpenAI
* Gemini
* Claude
* Ollama
* OpenRouter
* Provider lain di masa depan

tanpa mengubah arsitektur inti.

---

### Infrastructure Native

Novara dirancang untuk lingkungan yang memiliki:

* Server Linux
* Server Windows
* Docker
* Proxmox
* Database
* Monitoring
* Cloud Infrastructure

Infrastructure bukan fitur tambahan, melainkan bagian inti dari sistem.

---

### Token Efficient

Novara harus meminimalkan penggunaan token.

Prinsip yang digunakan:

* Lazy loading
* Context isolation
* Workspace separation
* On-demand knowledge retrieval

---

## What Novara Is Not

Novara bukan:

* Chatbot
* Prompt Collection
* Single AI Agent
* Framework yang bergantung pada satu vendor AI

Novara adalah operating system untuk mengelola intelligence dan workspace.

---

## Initial Target

Versi pertama hanya perlu mampu:

1. Mengelola workspace
2. Mengelola knowledge
3. Mengelola memory
4. Mengakses resource melalui MCP
5. Berinteraksi melalui CLI

Semua fitur lain bersifat sekunder.

---

## Quick Start

### 1. Inisialisasi & Setup Workspace
```bash
# Clone & install dependensi
npm install
npm run build

# Link secara global ke mesin Anda (opsional)
npm link

# Buat folder workspace baru lalu inisialisasi
mkdir workspace-baru
cd workspace-baru
novara init
```

### 2. Jalankan Sesi Chat & Steering
```bash
# Jalankan sesi interaktif
novara chat

# Di dalam sesi chat, Anda dapat memantau atau mengkoreksi (steering) 
# tindakan mutatif agen dengan memilih aksi 'Steer' pada prompt persetujuan.
```

### 3. Jalankan API Server & Task Queue
```bash
# Mulai API Server di port 8088
novara serve

# Di terminal lain (dalam sesi novara chat), Anda dapat mengirim 
# tugas ke antrean latar belakang:
/queue add "Pindai data workspace ini"

# Lihat status antrean tugas:
/queue
```

---

## Documentation Structure

Detail arsitektur, subsistem, dan rencana pengembangan Novara OS dapat dipelajari di folder [docs](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/):

* **Visi & Prinsip**: [docs/00-vision.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/00-vision.md) & [docs/01-principles.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/01-principles.md)
* **Arsitektur Utama**: [docs/02-architecture.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/02-architecture.md) & [docs/03-workspace-model.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/03-workspace-model.md)
* **Runtimes & Systems**: 
  * Agent & Tool: [docs/04-agent-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/04-agent-runtime.md) & [docs/08-tool-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/08-tool-runtime.md)
  * Memory & Knowledge: [docs/05-memory-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/05-memory-system.md) & [docs/06-knowledge-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/06-knowledge-system.md)
  * Skills & MCP: [docs/07-skill-system.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/07-skill-system.md) & [docs/09-mcp-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/09-mcp-runtime.md)
  * Providers & Security: [docs/10-provider-runtime.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/10-provider-runtime.md) & [docs/11-security-model.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/11-security-model.md)
* **Node Management & Interface**: [docs/12-node-management.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/12-node-management.md) & [docs/13-interface-layer.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/13-interface-layer.md)
* **Roadmap**: [docs/14-roadmap.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/14-roadmap.md)
* **Produksi & Uji Coba**: [docs/15-production-deployment.md](file:///Users/anasfikri/Documents/Projects/myworkspace/ai/novara-os/docs/15-production-deployment.md)

---

## E2E Testing & Production

Untuk menjalankan uji coba end-to-end secara mandiri:
```bash
npm run test
```

Untuk memaketkan aplikasi ke dalam tarball distribusi (`.tgz`):
```bash
npm run package
```

---

## Long Term Goal

Membangun satu platform yang mampu menjadi pusat kerja untuk:

* Infrastructure Management
* Knowledge Management
* Automation
* AI Collaboration
* Personal Productivity

dengan tetap menjaga pemisahan konteks antar workspace dan efisiensi penggunaan resource.


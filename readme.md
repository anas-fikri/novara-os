# Novara Orchestrator System (NOS)

Novara OS adalah CLI orchestrator pintar yang didesain dengan pendekatan **Workspace-Oriented**. Tools ini ditujukan untuk *developer*, devops, dan *power-user* yang sering berpindah-pindah konteks antara berbagai repositori, server, dan database.

Dibandingkan mengelola AI agent yang berdiri sendiri, Novara menyatukan manajemen *memory*, integrasi *Model Context Protocol* (MCP), dan eksekusi infrastruktur dalam satu lingkungan kerja yang tertata.

---

## Fitur Utama

- **Workspace Isolation:** Setiap project/folder memiliki file history, config, dan skills-nya masing-masing. Konteks project A tidak akan bocor ke project B.
- **Provider Agnostic:** Bebas pilih dan ganti model secara langsung (Gemini, OpenAI, OpenRouter, Llama) tanpa restart.
- **Native Infrastructure Control:** Dukungan *native* untuk eksekusi SSH node, Docker, dan VM Proxmox.
- **Token Efficiency (Built-in):** 
  - *Context Compressor*: Mengurangi penggunaan token dengan membuang kata hubung tanpa merusak *code block*.
  - *Memory Consolidator*: Merangkum sesi secara dinamis (*rolling summary*) di-background untuk kontinuitas jangka panjang.
- **Sub-Agent Delegation:** Mendelegasikan sub-task kompleks ke agen khusus (*infrastructure*, *research*, *coder*) secara paralel.

---

## Instalasi & Mulai Cepat

### Persyaratan
- Node.js v20.0.0 atau lebih baru.

### Cara Install

```bash
# 1. Clone repository
git clone https://github.com:anas-fikri/novara-os.git
cd novara-os

# 2. Install dependensi & Build
npm install
npm run build

# 3. Install binary CLI ke sistem global
npm install -g .
```

*Opsional:* Jalankan `nos completion` untuk mengaktifkan *tab-autocomplete* di terminal Zsh/Bash Anda.

### Cara Penggunaan (Workflow)

```bash
# Masuk ke folder proyek/server Anda
mkdir proyek-baru && cd proyek-baru

# 1. Inisialisasi workspace
nos init

# 2. Set API Key (contoh menggunakan gemini)
nos set-key gemini "API_KEY_ANDA"

# 3. Mulai bekerja
nos chat
```

Di dalam mode `chat`, Anda bisa meminta tugas apa saja (contoh: *"Lihat log docker nginx, cari error, lalu perbaiki konfigurasi conf-nya"*).

---

## Konsep & Arsitektur

### 1. Intervensi Keamanan (Human-in-the-Loop)
Novara OS aman digunakan pada *production local*. Setiap kali alat mengeksekusi instruksi yang bersifat *mutatif* (menjalankan bash script, mengedit file, me-restart docker), TUI akan menahan eksekusi dan memunculkan opsi:
- **Setujui / Tolak** eksekusi.
- **Preview** file sebelum ditulis.
- **Edit manual** perintah bash menggunakan editor bawaan.

### 2. Sub-Agent Paralel
Agen utama (`nos chat`) dibatasi max 10 iterasi loop per perintah. Namun ia memiliki kemampuan untuk me-*spawn* agen anak dengan konteks yang terisolasi untuk tugas tertentu. Agen utama menyuntikkan *session summary* ke *prompt* anak, lalu anak mengeksekusi tugasnya secara mandiri dan mengembalikan laporannya ke *parent*.

### 3. Server Background Daemon
Novara menyediakan API REST yang berjalan sebagai proses background. Ini memungkinkan integrasi *Agent Communication Protocol (ACP)* secara dua arah, atau digunakan oleh *front-end/extension* lain.

```bash
# Jalankan di background
nos serve --daemon

# Hentikan proses daemon
nos serve --stop
```

### 4. Custom Skills
Anda dapat membuat `Skill` khusus di dalam folder `.novara/skills/`. Fitur ini memaksa agen untuk selalu mengikuti Standard Operating Procedure (SOP) spesifik (misal: SOP *deployment*, SOP *code review*) tanpa membuang token pada *system prompt* utama.

---

## Daftar Slash Command

Di dalam sesi `nos chat`, gunakan awalan `/` untuk mengakses pengaturan seketika:

| Command | Fungsi |
|---|---|
| `/model [nama]` | Mengganti model LLM secara *realtime*. |
| `/session [aksi]` | Kelola sesi chat (new, load, delete). |
| `/mcp` | Kelola server Model Context Protocol. |
| `/skills` | Lihat dan install custom skills lokal/Git. |
| `/summary` | Lihat ringkasan obrolan aktif (*rolling summary*). |
| `/memory-config` | Ubah aturan *Memory Consolidator* (target token, dsb). |
| `/queue add [teks]`| Kirim *task* panjang ke *background daemon*. |
| `/exit` | Tutup sesi dan *generate report* otomatis. |

---

## Berkontribusi

Ingin berkontribusi pada pengembangan Novara OS? Kami sangat menyambut PR dan diskusi fitur! Silakan baca [Panduan Kontribusi](CONTRIBUTING.md) kami sebelum mengirimkan *Pull Request*.

Gunakan **Issues** tab untuk melaporkan *bug* atau sekedar memberikan *feedback* ide.

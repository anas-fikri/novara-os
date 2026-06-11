# Panduan Kontribusi Novara OS

Terima kasih sudah tertarik untuk berkontribusi! Novara OS adalah project *open-source*, jadi pull request, bug report, dan ide fitur sangat kami hargai.

Berikut panduan singkat agar proses kontribusi berjalan lancar.

## Struktur Direktori Utama
- `src/core/` - Logika utama (Orkestrator, Memory, Server Daemon)
- `src/memory/` - Manajemen penyimpanan context & tools
- `src/workspace/` - Pembacaan/penulisan YAML dan file proyek
- `docs/` - Dokumentasi arsitektur internal
- `templates/` - Template skill default (seperti `super-bmad`)

## Cara Setup untuk Development

1. Fork repository ini, lalu clone ke komputer lokal.
2. Install dependency:
   ```bash
   npm install
   ```
3. Lakukan perubahan pada source code (semua code ada di folder `src/` menggunakan TypeScript).
4. Untuk testing lokal tanpa harus build & install global setiap saat, gunakan `ts-node` atau `tsx`:
   ```bash
   npm run dev -- chat
   # atau
   npx tsx src/index.ts chat
   ```
5. Jika sudah selesai, pastikan bisa di-build dengan lancar:
   ```bash
   npm run build
   ```

## Aturan Penulisan Kode
1. **Gunakan TypeScript:** Jangan menulis JavaScript mentah. Manfaatkan *typing* untuk fungsi dan config.
2. **Hindari Dependency Gemuk:** Novara OS didesain ringan. Jika butuh library tambahan, pertimbangkan apakah bisa ditulis secara *native* terlebih dahulu (seperti `compressor.ts`).
3. **Pesan Commit yang Jelas:** Gunakan format Conventional Commits (contoh: `feat: add docker logs tool` atau `fix: resolve memory leak on background tasks`).

## Alur Pull Request
1. Buat branch baru dari `main` (misal: `git checkout -b feat/tambah-mcp-baru`).
2. Lakukan perubahan dan commit.
3. Push ke fork Anda.
4. Buka Pull Request ke repository utama. Pastikan mengisi deskripsi PR sesuai *template* yang disediakan.

## Melaporkan Bug atau Request Fitur
Gunakan tab **Issues** di GitHub. Kami sudah menyediakan template untuk Bug Report dan Feature Request agar informasi yang diberikan mudah dipahami.

Sekali lagi, terima kasih atas kontribusinya!

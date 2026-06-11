# Skill: Super-BMAD & Superpower Development Flow

SOP (Standard Operating Procedure) ini memandu Anda untuk menjalankan siklus hidup rekayasa perangkat lunak secara aman, terukur, terlacak, dan irit token.

---

## 1. Mekanisme State Tracking (Penyimpanan Checkpoint)
Setiap kali Anda berpindah fase atau menyelesaikan sub-tugas besar, Anda wajib menulis/memperbarui file `.novara/state.json` di root workspace:
```json
{
  "current_phase": "rapat_ai | coding | bug_hunting | production_ready | done",
  "completed_steps": [],
  "current_task": "Deskripsi rinci tugas saat ini",
  "meeting_approved": false,
  "bugs_found": [],
  "last_updated": "ISO_TIMESTAMP"
}
```
*   **Sebelum mulai**: Periksa apakah `.novara/state.json` ada. Jika ada, pulihkan variabel status Anda dan lanjutkan dari fase tersebut. Jika tidak ada, buat baru dengan fase awal `rapat_ai`.

---

## 2. Fase Pengembangan Terstandardisasi

### Fase 1: Rapat AI (AI Meeting & Alignment)
Sebelum menulis baris kode pertama, Anda harus memfasilitasi pertemuan koordinasi internal antar-persona AI untuk menganalisis kebutuhan pengguna.
1.  **Simulasikan Diskusi**: Salin template `.novara/skills/super-bmad/templates/01_meeting_minutes.md` ke `.novara/docs/01_meeting_minutes.md` (buat folder `.novara/docs/` jika belum ada).
2.  Tulis dialog multi-persona PM, Architect, Dev, dan QA di file tersebut untuk menyepakati scope dan skenario uji.
3.  **Persetujuan Pengguna (Human-in-the-Loop)**: Minta pengguna meninjau file `.novara/docs/01_meeting_minutes.md`. Tanyakan apakah pengguna setuju. **Jangan masuk ke Fase Coding sebelum pengguna menyetujui (atau menyetir/steer) hasil Rapat AI.**
4.  Setelah disetujui, ubah `"meeting_approved": true` dan transisi `"current_phase": "technical_spec"` di `.novara/state.json`.

### Fase 2: Spesifikasi Teknis (Technical Specification)
1.  **Tulis Spesifikasi**: Salin template `.novara/skills/super-bmad/templates/02_technical_specification.md` ke `.novara/docs/02_technical_specification.md`.
2.  Tulis relasi database/data schema baru, spesifikasi kontrak API, dan file blueprint (daftar file baru/diubah) sebelum memulai implementasi.
3.  Perbarui status di `.novara/state.json` dan transisi ke `"current_phase": "coding"`.

### Fase 3: Coding & Incremental Implementation
1.  Buat/edit file kode secara bertahap sesuai blueprint di `02_technical_specification.md`.
2.  **Prinsip Irit Token**: Jangan membaca file besar secara menyeluruh. Gunakan grep/regex pencarian parsial.
3.  Setelah menulis/memodifikasi kode utama, tulis file test case (unit/integration test) yang relevan untuk memvalidasi perubahan.
4.  Perbarui `.novara/state.json` dan transisi ke `"current_phase": "bug_hunting"`.

### Fase 4: Looping Bug Hunting & Auto-Debugging
1.  Jalankan helper script `.novara/skills/super-bmad/scripts/bug_hunter.js` menggunakan tool eksekusi command.
2.  Baca file laporan hasil debugging `.novara/bug_report.json` yang dihasilkan script.
3.  **Looping Debugging**:
    *   Jika ada pengujian gagal (bugs ditemukan):
        *   Perbaiki kode di lokasi eror.
        *   Jalankan kembali script `.novara/skills/super-bmad/scripts/bug_hunter.js`.
    *   Jika semua pengujian lolos (0 bugs):
        *   Keluar dari loop.
4.  **Tulis Laporan Tes**: Salin template `.novara/skills/super-bmad/templates/03_test_report.md` ke `.novara/docs/03_test_report.md` dan catat hasil uji coba serta riwayat perbaikan bug.
5.  Perbarui status di `.novara/state.json` dengan transisi ke `"current_phase": "production_ready"`.

### Fase 5: Production Ready & Release
1.  Verifikasi build aplikasi (misalnya menjalankan `npm run build` atau kompilator bahasa terkait).
2.  **Tulis Changelog Rilis**: Salin template `.novara/skills/super-bmad/templates/04_release_changelog.md` ke `.novara/docs/04_release_changelog.md`. Catat rincian perubahan, env tambahan, dan instruksi deploy.
3.  Perbarui `.novara/state.json` ke `"current_phase": "done"`.
4.  Laporkan penyelesaian tugas akhir secara ringkas kepada pengguna dengan melampirkan checkpoint dokumentasi baru di folder `.novara/docs/`.

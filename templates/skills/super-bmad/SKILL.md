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
1.  **Simulasikan Diskusi**: Tulis dialog multi-persona di dalam file `.novara/meeting_minutes.md` yang mencakup:
    *   **Product Manager (PM)**: Menjelaskan scope kebutuhan, prioritas fitur, dan user experience.
    *   **Technical Architect**: Mengusulkan arsitektur file, relasi data, pilihan pustaka/library, dan pola integrasi.
    *   **Senior Developer**: Mengkritik rancangan arsitektur, memberikan opsi alternatif yang lebih sederhana dan efisien, serta menyoroti tingkat kesulitan kode.
    *   **QA Lead**: Mendaftar rencana uji (test cases), potensi kegagalan sistem, dan batas keandalan (edge cases).
2.  **Output Rapat**: Simpan diskusi lengkap beserta kesepakatan rancangan teknis ke `.novara/meeting_minutes.md`.
3.  **Persetujuan Pengguna (Human-in-the-Loop)**: Minta pengguna meninjau file `.novara/meeting_minutes.md`. Tanyakan apakah pengguna setuju dengan rencana tersebut. **Jangan masuk ke Fase Coding sebelum pengguna menyetujui (atau menyetir/steer) hasil Rapat AI.**
4.  Setelah disetujui, ubah `"meeting_approved": true` dan transisi `"current_phase": "coding"` di `.novara/state.json`.

### Fase 2: Coding & Incremental Implementation
1.  Buat/edit file kode secara bertahap sesuai arsitektur yang disetujui.
2.  **Prinsip Irit Token**: Jangan membaca file besar secara menyeluruh. Gunakan grep/regex pencarian parsial.
3.  Setelah menulis/memodifikasi kode utama, tulis file test case (unit/integration test) yang relevan untuk memvalidasi perubahan.
4.  Perbarui `.novara/state.json` dan transisi ke `"current_phase": "bug_hunting"`.

### Fase 3: Looping Bug Hunting & Auto-Debugging
1.  Jalankan helper script `.novara/skills/super-bmad/scripts/bug_hunter.js` menggunakan tool eksekusi command.
2.  Baca file laporan hasil debugging `.novara/bug_report.json` yang dihasilkan script.
3.  **Looping Debugging**:
    *   Jika ada pengujian gagal (bugs ditemukan):
        *   Baca detail kegagalan di `.novara/bug_report.json`.
        *   Gunakan grep/pencarian baris untuk langsung menuju lokasi error pada kode.
        *   Perbaiki kode tersebut.
        *   Jalankan kembali script `.novara/skills/super-bmad/scripts/bug_hunter.js`.
    *   Jika semua pengujian lolos (0 bugs):
        *   Keluar dari loop.
4.  Perbarui status di `.novara/state.json` dengan transisi ke `"current_phase": "production_ready"`.

### Fase 4: Production Ready
1.  Verifikasi build aplikasi (misalnya menjalankan `npm run build` atau kompilator bahasa terkait).
2.  Verifikasi kebersihan kode (linting).
3.  Pastikan semua file konfigurasi (.env, config.json) terisi dengan benar.
4.  Perbarui `.novara/state.json` ke `"current_phase": "done"`.
5.  Laporkan penyelesaian tugas akhir secara ringkas kepada pengguna dengan melampirkan checkpoint pengerjaan.

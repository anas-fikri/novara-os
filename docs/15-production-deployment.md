# Panduan Uji Coba E2E & Produksi (Production Deployment)

Dokumen ini menjelaskan cara menjalankan uji coba end-to-end (E2E), memaketkan aplikasi untuk produksi, mendistribusikannya ke mesin lain, dan menjalankannya secara headless menggunakan process manager di lingkungan produksi.

---

## 1. Uji Coba End-to-End (E2E)

Novara OS dilengkapi dengan skrip uji coba otomatis yang melakukan validasi penuh terhadap alur kerja utama tanpa memerlukan interaksi pengguna atau API Key eksternal yang aktif.

Skrip E2E memvalidasi:
- Inisialisasi workspace tanpa interaksi (`novara init --yes`).
- Enkripsi dan penyimpanan secrets (`novara set-key`).
- Kompatibilitas pembacaan informasi konfigurasi (`novara workspace`).
- Booting dan port binding API Server (`novara serve`).
- Pengiriman tugas (task queueing) dan transisi status siklus hidup tugas (`GET /v1/tasks` & `POST /v1/agent/run`).
- Otomatisasi pembersihan (clean up) direktori pengujian dan proses latar belakang.

### Cara Menjalankan Uji Coba:
1. Pastikan Anda berada di direktori root project.
2. Jalankan perintah:
   ```bash
   npm run test
   ```
3. Skrip akan menampilkan status kelulusan untuk setiap tahapan pengujian.

---

## 2. Pembuatan Paket Distribusi Produksi (.tgz)

Untuk mendistribusikan Novara OS ke mesin lain tanpa harus menyalin seluruh kode sumber (source code) dan `devDependencies` pengembang, kita dapat mengemasnya menjadi tarball npm resmi.

Jalankan perintah berikut pada mesin pengembangan:
```bash
npm run package
```

Perintah ini akan secara otomatis melakukan:
1. Mengompilasi TypeScript menjadi JavaScript ESM yang bersih di folder `dist/`.
2. Menyisipkan shebang `#!/usr/bin/env node` pada file executable utama.
3. Membuat file tarball npm terkompresi dengan format nama: `novara-os-X.Y.Z.tgz` (misal: `novara-os-0.1.0.tgz`).

---

## 3. Pemasangan di Mesin Lain (Installation on Other Machines)

Setelah file tarball `novara-os-0.1.0.tgz` terbuat, Anda dapat menyalin file ini ke mesin server / komputer lain menggunakan `scp`, drive eksternal, atau media transfer lainnya.

### Cara Install Global dari Tarball:
Jalankan perintah berikut di mesin tujuan (pastikan Node.js v20+ sudah terinstal):
```bash
npm install -g ./novara-os-0.1.0.tgz
```

Setelah terpasang, perintah `novara` dan `nos` akan tersedia secara global di system path mesin tersebut.

Untuk menguji apakah instalasi global bekerja:
```bash
novara --version
# atau
nos --version
```

---

## 4. Konfigurasi Headless & Server Tanpa Prompt (CI/CD / Docker)

Di lingkungan produksi yang headless (seperti Docker, Kubernetes, VM Server, atau runner CI/CD), sistem keychain OS seringkali tidak tersedia atau membutuhkan interaksi manual yang mengganggu.

Novara OS mendukung bypass keyring menggunakan variable environment **`NOVARA_MASTER_KEY`**.

### Cara Mengaktifkan:
1. Tetapkan master key enkripsi Anda secara manual:
   ```bash
   export NOVARA_MASTER_KEY="kunci_rahasia_master_anda_min_32_karakter"
   ```
2. Jalankan inisialisasi workspace secara non-interaktif:
   ```bash
   mkdir workspace-produksi
   cd workspace-produksi
   novara init --name "WorkspaceProduksi" --yes
   ```
3. Setel API key yang dibutuhkan tanpa prompt interaktif:
   ```bash
   novara set-key gemini "API_KEY_GEMINI_ANDA"
   ```

---

## 5. Menjalankan REST API Server & Task Queue di Latar Belakang (PM2)

Di mesin produksi, REST API Server Novara OS harus berjalan terus-menerus di latar belakang untuk menerima tugas dari antrean. Sangat direkomendasikan menggunakan process manager seperti **PM2**.

### Cara Konfigurasi PM2:
1. Instal PM2 secara global jika belum ada:
   ```bash
   npm install -g pm2
   ```
2. Jalankan server Novara OS di dalam workspace Anda:
   ```bash
   pm2 start novara --name "novara-api" -- serve -p 8088
   ```
3. Simpan konfigurasi proses agar menyala kembali saat mesin reboot:
   ```bash
   pm2 save
   pm2 startup
   ```
4. Untuk memantau log API server:
   ```bash
   pm2 logs novara-api
   ```
5. Mengirim tugas dari mesin lokal/aplikasi internal lain ke API Server:
   ```bash
   curl -X POST http://localhost:8088/v1/agent/run \
     -H "Content-Type: application/json" \
     -d '{"query": "Lakukan pemindaian resource di server ini"}'
   ```

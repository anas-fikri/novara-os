# Panduan Membuat Google OAuth Client ID

Dokumen ini menjelaskan langkah-langkah untuk membuat dan mengonfigurasi **Client ID** dan **Client Secret** milik Anda sendiri di Google Cloud Console untuk digunakan dengan fitur `novara login`.

---

## Langkah 1: Buat Project di Google Cloud Console
1. Buka [Google Cloud Console](https://console.cloud.google.com/).
2. Login menggunakan akun Google Anda.
3. Di pojok kiri atas (sebelah logo Google Cloud), klik menu drop-down project lalu klik **New Project** (Project Baru).
4. Masukkan nama project (misalnya: `Novara OS`) lalu klik **Create**.

---

## Langkah 2: Konfigurasi OAuth Consent Screen (Layar Persetujuan)
Sebelum membuat kunci, Anda harus mengonfigurasi layar persetujuan OAuth:
1. Ketik **"OAuth consent screen"** pada kolom pencarian di bagian atas, lalu klik menu tersebut.
2. Pilih User Type: **External** lalu klik **Create**.
3. Isi informasi aplikasi yang wajib:
   * **App name**: `Novara OS`
   * **User support email**: Pilih email Anda.
   * **Developer contact information**: Masukkan alamat email Anda.
4. Klik **Save and Continue** (Simpan dan Lanjutkan).
5. Pada tab **Scopes**, klik *Save and Continue* (tidak perlu konfigurasi khusus).
6. Pada tab **Test Users**, tambahkan email Google Anda sendiri sebagai pengguna uji coba agar Anda bisa login sebelum aplikasi dipublikasikan secara global. Klik *Save and Continue*.

---

## Langkah 3: Buat OAuth Client ID
1. Klik menu **Credentials** (Kredensial) pada sidebar sebelah kiri.
2. Di bagian atas, klik **+ Create Credentials** lalu pilih **OAuth client ID**.
3. Pilih **Application type**: `Web application` (Aplikasi Web).
4. Masukkan nama (misalnya: `Novara OS CLI`).
5. Pada bagian **Authorized redirect URIs** (URI Pengalihan Sah), klik **+ Add URI** lalu masukkan alamat callback lokal berikut:
   ```
   http://localhost:8085/callback
   ```
   > [!IMPORTANT]
   > URI pengalihan harus persis sama dengan alamat di atas agar proses local callback di terminal dapat membaca token autentikasi.
6. Klik **Create**.

---

## Langkah 4: Simpan Credentials ke Novara OS
Setelah berhasil dibuat, Google akan menampilkan pop-up berisi **Your Client ID** dan **Your Client Secret**.

Gunakan perintah interaktif baru Novara OS untuk menyimpannya secara instan:

```bash
# Simpan Client ID
novara set-key google_client_id "MASUKKAN_CLIENT_ID_ANDA"

# Simpan Client Secret
novara set-key google_client_secret "MASUKKAN_CLIENT_SECRET_ANDA"
```

Setelah disimpan, Anda dapat langsung menjalankan perintah login secara global:
```bash
novara login
```
Browser akan otomatis terbuka dan mengarahkan Anda ke persetujuan login Google tanpa ada error!

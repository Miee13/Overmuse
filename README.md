# Overmuse

Overlay musik interaktif yang berjalan secara lokal menggunakan Pear-Desktop untuk **TikTok Live Studio** & **OBS**. Menampilkan lagu yang sedang diputar (Browser / Windows Media), lirik sinkron otomatis, dan fitur request lagu langsung dari chat komentar TikTok LIVE. Juga dapat mengontrol saat lagu request sedang berjalan lalu akan membuat lagu pada Pear-Desktop menjadi pause, dan berjalan kembali setelah lagu request telah habis

---

### Pear-Desktop Download link
https://github.com/pear-devs/pear-desktop.git

---

## ⚡ Quick Start

### 1. Install Dependensi
```bash
npm install
```

### 2. Buat File `.env`
Buat file `.env` di root project (sejajar dengan `package.json`):
```env
TIKTOK_USERNAME=username_tiktok_anda
PORT=3000
```
> *Ganti `username_tiktok_anda` dengan username TikTok Anda (tanpa tanda `@`).*
> *Bot TikTok hanya bisa terhubung saat akun Anda **sedang LIVE**.*

### 3. Jalankan Aplikasi

**Untuk TikTok Live Studio (Rekomendasi):**
```bash
npm run tunnel
```
Salin link HTTPS yang muncul (contoh: `https://xxxx.trycloudflare.com`) lalu masukkan sebagai **Browser Source** di TikTok Live Studio.

**Untuk berjalan di Lokal:**
```bash
npm start
```
Tambahkan **Browser Source** dengan URL: `http://localhost:3000` (atau sesuai `PORT` di `.env`).

---

## 💬 Command Chat Penonton

| Command | Keterangan |
| :--- | :--- |
| `!request <judul lagu>` / `!play <judul lagu>` | Menambahkan lagu ke antrean request |
| `!skip` | Melewati lagu yang sedang diputar |

---

## 🛑 Stop Server
Untuk menghentikan background process:
```bash
npm run stop
```
atau tekan `Ctrl + C` pada terminal.

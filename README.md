# Overmuse

Overlay musik interaktif yang berjalan secara lokal untuk **TikTok Live Studio** & **OBS**. Menampilkan lagu yang sedang diputar (Spotify / Browser / Windows Media), lirik sinkron otomatis, dan fitur request lagu langsung dari chat komentar TikTok LIVE.

---

## ⚡ Quick Start

### 1. Install Dependensi
```bash
npm install
```

### 2. Atur Username TikTok
Buka `bot.js` dan ganti username TikTok Anda (tanpa tanda `@`):
```javascript
const TIKTOK_USERNAME = 'username_tiktok_anda';
```
> *Catatan: Bot TikTok hanya bisa terhubung saat akun Anda **sedang LIVE**.*

### 3. Jalankan Aplikasi

**Untuk TikTok Live Studio (Rekomendasi):**
```bash
npm run tunnel
```
Salin link HTTPS yang muncul (contoh: `https://xxxx.trycloudflare.com`) lalu masukkan sebagai **Browser Source** di TikTok Live Studio.

**Untuk OBS Studio (PC Lokal):**
```bash
npm start
```
Tambahkan **Browser Source** dengan URL: `http://localhost:3000`.

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

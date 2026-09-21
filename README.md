# Overmuse 🎵

Overlay musik interaktif premium untuk **TikTok Live Studio** & **OBS**. Terintegrasi langsung secara lokal dengan YouTube Music Desktop (**Pear Desktop**) untuk menampilkan lagu yang sedang diputar, lirik tersinkronisasi (*synced lyrics*), serta sistem antrean request lagu otomatis dari penonton TikTok Live.

---

## ✨ Fitur Unggulan

- **Native Pear Desktop API Integration**: Mengendalikan pemutar langsung melalui API lokal bawaan Pear Desktop tanpa pop-up browser atau gangguan audio.
- **Smart Queue Interleaving**: Lagu request penonton otomatis ke antrean berikutnya (`Up Next`).
- **Live Synced Lyrics**: Mendukung lirik tersinkronisasi (LRC) real-time dari LRCLIB dengan auto-scroll.
- **TikTok Live Auto-Connect**: Bot otomatis mendeteksi ketika akun Anda mulai Live dan menyambungkan interaksi chat penonton.

---

## 📋 Persyaratan Sistem

1. **Node.js** v18+ atau v20+ terinstall.
2. **Pear Desktop** (YouTube Music Desktop Client)
   - Download: [Pear Desktop Repository](https://github.com/pear-devs/pear-desktop)
3. **Konfigurasi Plugin di Pear Desktop (Penting!)**:
   - Buka menu atas di Pear Desktop: **Plugins** > **API Server [Beta]**
   - Centang **Enabled**
   - Atur **Authorization strategy** ke **`None`**
   - Pastikan Port default adalah `26538` (atau sesuaikan di `.env`)

---

## ⚡ Quick Start

### 1. Install Dependensi
```bash
npm install
```

### 2. Konfigurasi File `.env`
Sesuaikan file `.env` di root project:
```env
# Username TikTok akun Anda (tanpa tanda @)
TIKTOK_USERNAME=username_tiktok_anda

# Port server web overlay
PORT=3000

# Konfigurasi API Pear Desktop
PEAR_HOST=127.0.0.1
PEAR_PORT=26538
```
> *Catatan: Bot TikTok akan otomatis melakukan polling koneksi dan langsung terhubung begitu akun Anda **LIVE** di TikTok.*

### 3. Jalankan Aplikasi

**Rekomendasi untuk Titok Studio:**
```bash
npm run tunnel
```
Salin link HTTPS yang muncul (contoh: `https://xxxx.trycloudflare.com`) lalu masukkan sebagai **Browser Source** di TikTok Live Studio.


**Untuk berjalan di Lokal:**
```
http://localhost:3000
```

---

## 💬 Command Chat Penonton di TikTok Live

| Command | Contoh | Deskripsi |
| :--- | :--- | :--- |
| `!request <judul / link>` | `!request Bohemian Rhapsody` | Menyelipkan lagu ke antrean Pear Desktop |
| `!sr <judul>` | `!sr Coldplay Yellow` | Shortcut untuk request lagu |
| `!play <judul>` | `!play YOASOBI Idol` | Shortcut untuk request lagu |
| `!skip` | `!skip` | Melewati (skip) lagu ke antrean berikutnya |

---

## 🛠️ Testing Manual Tanpa Live Chat

Anda bisa menguji sistem langsung lewat browser atau terminal:
- **Request Lagu:** `http://localhost:3000/request?song=NamaLagu&user=NamaPenonton`
- **Skip Lagu:** `http://localhost:3000/skip`
- **Pause Player:** `http://localhost:3000/pause`
- **Resume Player:** `http://localhost:3000/play`

---

## 📁 Struktur File Proyek

```
Overmuse/
├── .env                  # Variabel environment (Username, Port, API Pear)
├── bot.js                # Bot konektor TikTok Live chat command parser
├── pearClient.js         # REST Client penghubung ke API Server Pear Desktop
├── lyrics.js             # Engine pencari lirik (LRCLIB) & konverter Romaji
├── yt-search.js          # Pencari metadata & Video ID YouTube Music
├── server.js             # Express & Socket.IO server (Hybrid Player Engine)
├── get-media.ps1         # Windows Media timeline tracker untuk detik presisi
├── public/
│   └── index.html        # UI Overlay animasi, progress bar, & lirik
└── package.json          # Dependensi & skrip npm
```

---

## 🛑 Menghentikan Server
Tekan `Ctrl + C` pada terminal tempat server berjalan, atau jalankan:
```bash
npm run stop
```

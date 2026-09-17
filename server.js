const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const axios = require('axios');
const { initBot } = require('./bot');
const { fetchLyrics, cleanString, processLyricsWithRomaji } = require('./lyrics');
const { searchYouTubeSong } = require('./yt-search');

const execPromise = util.promisify(exec);

// Dynamic import untuk fast-average-color-node (ESM-only package)
let getAverageColor;
(async () => {
    try {
        const mod = await import('fast-average-color-node');
        getAverageColor = mod.getAverageColor;
        console.log('[Color] fast-average-color-node berhasil dimuat');
    } catch (e) {
        console.warn('[Color] Gagal memuat fast-average-color-node:', e.message);
    }
})();

// Ekstraksi warna tema dari URL gambar album art
async function extractThemeColor(imageUrl) {
    if (!getAverageColor || !imageUrl) return null;
    try {
        const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 5000 });
        const color = await getAverageColor(Buffer.from(imgRes.data));
        return { r: color.value[0], g: color.value[1], b: color.value[2] };
    } catch (e) {
        return null;
    }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Sajikan file statis
app.use(express.static(path.join(__dirname, 'public')));

// State Lagu Saat Ini & Queue Request
let currentSong = {
    videoId: '',
    title: '',
    artist: '',
    lyrics: null,
    isSynced: false,
    isJapanese: false,
    romajiMap: null,
    coverArt: null,
    themeColor: null,
    requestedBy: '',
    isRequest: false
};
let currentProgress = { progress: 0, duration: 0, status: 'Stopped' };
let songQueue = [];
let isPlayingRequest = false;
let lastSkipTime = 0;           // Timestamp skip terakhir, untuk debounce song-ended
let requestEndCooldown = 0;     // Timestamp cooldown setelah antrian request habis
let wasPearPlayingBeforeRequest = false; // Mengingat status play Pear Desktop sebelum request diputar

// Path ke script kontrol media
const psControlScript = path.join(__dirname, 'control-media.ps1');

// Helper untuk Pause Pear Desktop
async function pausePearDesktop() {
    try {
        console.log('[Media Control] Mengirim perintah PAUSE ke Pear Desktop / Windows Media...');
        await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psControlScript}" -Action pause`, { windowsHide: true });
    } catch (err) {
        console.error('[Media Control Error] Gagal pause Pear Desktop:', err.message);
    }
}

// Helper untuk Resume/Play Pear Desktop
async function resumePearDesktop() {
    try {
        console.log('[Media Control] Mengirim perintah PLAY ke Pear Desktop / Windows Media...');
        await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psControlScript}" -Action play`, { windowsHide: true });
    } catch (err) {
        console.error('[Media Control Error] Gagal play Pear Desktop:', err.message);
    }
}

// Helper fungsi mengambil cover art lagu dari iTunes API (untuk Pear Desktop)
async function fetchAlbumArt(title, artist) {
    try {
        const query = encodeURIComponent(`${cleanString(artist)} ${cleanString(title)}`);
        const res = await axios.get(`https://itunes.apple.com/search?term=${query}&entity=song&limit=1`, { timeout: 4000 });
        if (res.data && res.data.results && res.data.results.length > 0) {
            return res.data.results[0].artworkUrl100.replace('100x100bb', '300x300bb');
        }
    } catch (e) { }
    return null;
}

// Polling data media Windows (Pear Desktop, Spotify, DLL)
const psScriptPath = path.join(__dirname, 'get-media.ps1');

async function pollMedia() {
    // Jika sedang ada lagu request penonton yang diputar di web player, lewati polling Pear Desktop
    if (isPlayingRequest) {
        return;
    }

    // Cooldown 3 detik setelah antrian request habis, agar tidak langsung menimpa
    if (Date.now() < requestEndCooldown) {
        return;
    }

    try {
        const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { windowsHide: true, encoding: 'utf8' });

        // *** RE-CHECK setelah async: mungkin request masuk saat PowerShell berjalan ***
        if (isPlayingRequest) {
            return;
        }

        const trimmed = stdout.trim();
        if (!trimmed || trimmed === '[]' || trimmed === 'null') {
            return;
        }

        const data = JSON.parse(trimmed);
        const sessions = Array.isArray(data) ? data : [data];

        // Memilih sesi yang sedang bermain dan memiliki judul lagu (seperti Pear Desktop)
        const session = sessions.find(s => s.status === 'Playing' && s.title)
            || sessions.find(s => s.title)
            || sessions[0];

        if (session && session.title) {
            // Hanya update jika lagu Pear Desktop berubah (tanpa || currentSong.isRequest yang menyebabkan overwrite)
            if (session.title !== currentSong.title || session.artist !== currentSong.artist) {
                // *** RE-CHECK lagi sebelum overwrite: request bisa masuk saat fetch lyrics ***
                if (isPlayingRequest) {
                    return;
                }

                console.log(`\n[Pear Desktop / Windows Media] Terdeteksi: "${session.title}" oleh "${session.artist}"`);

                const [lyricsResult, coverUrl] = await Promise.all([
                    fetchLyrics(session.title, session.artist, 'auto'),
                    fetchAlbumArt(session.title, session.artist)
                ]);

                let processedLyrics = null;
                if (lyricsResult && lyricsResult.lyrics) {
                    processedLyrics = processLyricsWithRomaji(lyricsResult.lyrics, lyricsResult.isSynced);
                }

                const themeColor = await extractThemeColor(coverUrl);

                // *** RE-CHECK final sebelum emit: pastikan request belum masuk ***
                if (isPlayingRequest) {
                    console.log('[Pear Desktop] Dibatalkan: request penonton masuk saat fetch data');
                    return;
                }

                currentSong = {
                    videoId: '',
                    title: session.title,
                    artist: session.artist,
                    lyrics: lyricsResult ? lyricsResult.lyrics : null,
                    isSynced: lyricsResult ? lyricsResult.isSynced : false,
                    isJapanese: processedLyrics ? processedLyrics.isJapanese : false,
                    romajiMap: processedLyrics ? processedLyrics.romajiMap : null,
                    coverArt: coverUrl,
                    themeColor: themeColor,
                    requestedBy: '',
                    isRequest: false
                };

                io.emit('song-update', currentSong);
            }

            // Jangan emit progress jika request sedang berjalan
            if (!isPlayingRequest) {
                currentProgress = {
                    progress: session.position || 0,
                    duration: session.duration || 0,
                    status: session.status || 'Stopped'
                };
                io.emit('progress-update', currentProgress);

                // CEK: Jika ada antrean request penonton yang menunggu, dan lagu Pear Desktop selesai diputar:
                // Lagu selesai jika: status bukan Playing (Stopped/Paused), ATAU progress sudah mencapai durasi lagu
                const isNearEnd = session.duration > 0 && session.position >= (session.duration - 1);
                const isNotPlaying = session.status !== 'Playing';

                if (songQueue.length > 0 && (isNearEnd || isNotPlaying)) {
                    console.log(`[Queue Trigger] Lagu Pear Desktop telah selesai (${session.title}). Menjalankan antrean request...`);
                    wasPearPlayingBeforeRequest = true;
                    pausePearDesktop();
                    playNextSong();
                }
            }
        } else {
            // Sesi media kosong atau tidak ada judul lagu
            currentProgress.status = 'Stopped';
            if (songQueue.length > 0 && !isPlayingRequest) {
                console.log('[Queue Trigger] Pear Desktop tidak sedang memutar lagu. Menjalankan antrean request...');
                playNextSong();
            }
        }
    } catch (err) {
        // Error polling sementara diabaikan agar tidak spamming console
    }
}

// Polling media Windows (Pear Desktop) setiap 1 detik saat tidak ada lagu request yang berjalan
setInterval(pollMedia, 1000);

// Helper untuk memutar lagu berikutnya di antrian request
function playNextSong() {
    if (songQueue.length > 0) {
        const nextSong = songQueue.shift();
        currentSong = { ...nextSong, requestedBy: nextSong.user, isRequest: true };
        isPlayingRequest = true;
        lastSkipTime = Date.now();  // Set debounce agar song-ended palsu diabaikan
        console.log(`\n[Player Request] Memutar request: "${currentSong.title}" oleh "${currentSong.artist}" (Req by: ${currentSong.requestedBy})`);
        io.emit('song-update', currentSong);
        io.emit('queue-update', songQueue);
    } else {
        // Antrian request habis, kembalikan kontrol ke Pear Desktop / Windows Media
        isPlayingRequest = false;
        requestEndCooldown = Date.now() + 3000;  // Beri jeda 3 detik sebelum pollMedia aktif
        currentSong = {
            videoId: '',
            title: '',
            artist: '',
            lyrics: null,
            isSynced: false,
            isJapanese: false,
            romajiMap: null,
            coverArt: null,
            themeColor: null,
            requestedBy: '',
            isRequest: false
        };
        console.log('\n[Player Request] Antrian request habis, kembali mendeteksi Pear Desktop...');
        io.emit('song-update', currentSong);
        io.emit('queue-update', songQueue);

        // Resume/Play Pear Desktop setelah jeda singkat (agar player YouTube client benar-benar berhenti)
        if (wasPearPlayingBeforeRequest) {
            console.log('[Player Request] Melanjutkan (resume) pemutaran Pear Desktop...');
            setTimeout(() => {
                resumePearDesktop();
            }, 800);
            wasPearPlayingBeforeRequest = false;
        }
    }
}

// Helper untuk menambah request baru dari penonton (Auto-Search & Queue)
async function addRequest(query, user = 'Penonton') {
    if (!query) return;
    console.log(`[Request Queue] Mencari lagu untuk ${user}: "${query}"`);

    try {
        const ytData = await searchYouTubeSong(query);
        if (!ytData) {
            console.warn(`[Request Queue] Lagu tidak ditemukan untuk query: "${query}"`);
            return;
        }

        // Ambil lirik & warna tema secara paralel (dengan catch agar tidak menggagalkan request jika error)
        const [lyricsResult, themeColor] = await Promise.all([
            fetchLyrics(ytData.title, ytData.artist, 'auto').catch(e => {
                console.warn('[Request Queue Warning] Gagal mengambil lirik:', e.message);
                return null;
            }),
            extractThemeColor(ytData.coverArt).catch(() => null)
        ]);

        let processedLyrics = null;
        if (lyricsResult && lyricsResult.lyrics) {
            processedLyrics = processLyricsWithRomaji(lyricsResult.lyrics, lyricsResult.isSynced);
        }

        const songItem = {
            id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            videoId: ytData.videoId,
            title: ytData.title,
            artist: ytData.artist,
            coverArt: ytData.coverArt,
            lyrics: lyricsResult ? lyricsResult.lyrics : null,
            isSynced: lyricsResult ? lyricsResult.isSynced : false,
            isJapanese: processedLyrics ? processedLyrics.isJapanese : false,
            romajiMap: processedLyrics ? processedLyrics.romajiMap : null,
            themeColor: themeColor,
            user: user,
            song: `${ytData.artist} - ${ytData.title}`,
            isRequest: true
        };

        // Apakah Pear Desktop saat ini sedang memutar musik?
        const isPearPlaying = (currentProgress.status === 'Playing');

        // Jika ada request lain yang sedang jalan ATAU Pear Desktop sedang memutar musik:
        // Masukkan ke dalam antrean (jangan memotong lagu yang sedang berjalan)
        if (isPlayingRequest || isPearPlaying) {
            songQueue.push(songItem);
            console.log(`[Request Queue] Dimasukkan ke antrian (#${songQueue.length}): "${songItem.title}" (Pear Playing: ${isPearPlaying})`);
            io.emit('new-request', { song: songItem.song, user });
            io.emit('queue-update', songQueue);
        } else {
            // Pear Desktop sedang tidak memutar lagu dan tidak ada request: langsung putar
            currentSong = { ...songItem, requestedBy: user, isRequest: true };
            isPlayingRequest = true;
            console.log(`[Player Request] Langsung memutar request: "${currentSong.title}" oleh "${currentSong.artist}"`);
            io.emit('song-update', currentSong);
            io.emit('queue-update', songQueue);
        }
    } catch (err) {
        console.error(`[Request Queue Error] Gagal memproses request "${query}":`, err.message);
    }
}

// Helper untuk skip lagu
async function skipSong(user) {
    console.log(`[Skip Queue] Skip lagu dipicu oleh ${user || 'Penonton'}`);
    if (isPlayingRequest) {
        // Sedang memutar request: lewati ke request berikutnya
        playNextSong();
    } else if (songQueue.length > 0) {
        // Sedang di Pear Desktop dan ada request yang menunggu di antrian:
        // Langsung potong lagu Pear Desktop dan putar request penonton!
        console.log('[Skip Media] Ada request menunggu. Menghentikan Pear Desktop dan memutar request...');
        wasPearPlayingBeforeRequest = (currentProgress.status === 'Playing');
        await pausePearDesktop();
        playNextSong();
    } else {
        // Tidak ada request yang menunggu: skip lagu di Pear Desktop
        try {
            const psSkipScript = path.join(__dirname, 'skip-media.ps1');
            await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psSkipScript}"`, { windowsHide: true });
            console.log('[Skip Media] Perintah skip berhasil dikirim ke Pear Desktop');
        } catch (err) {
            console.error('[Skip Media] Error saat skip Pear Desktop:', err.message);
        }
    }
}

// Inisialisasi Bot TikTok Live dengan Callback Handlers
initBot({ addRequest, skipSong });

// Handler koneksi Socket.IO
io.on('connection', (socket) => {
    console.log('Client overlay terhubung ke server');

    // Kirim state lagu saat ini & antrian ke client baru
    socket.emit('song-update', currentSong);
    socket.emit('progress-update', currentProgress);
    socket.emit('queue-update', songQueue);

    // Listen for new requests from client or bot
    socket.on('new-request', (data) => {
        if (data && data.song) {
            addRequest(data.song, data.user || 'Penonton');
        }
    });

    // Listen for skip events from client
    socket.on('skip-song', (data) => {
        skipSong(data ? data.user : 'Overlay Client');
    });

    // Event ketika lagu request selesai diputar di YouTube player client
    socket.on('song-ended', () => {
        if (isPlayingRequest) {
            // Debounce: abaikan song-ended yang datang dalam 2 detik setelah skip
            if (Date.now() - lastSkipTime < 2000) {
                console.log('[Player] song-ended diabaikan (debounce setelah skip)');
                return;
            }
            console.log('[Player] Lagu request telah selesai diputar');
            playNextSong();
        }
    });
});

// Endpoint REST untuk testing request & skip dari browser / curl
app.get('/request', (req, res) => {
    const song = req.query.song;
    const user = req.query.user || 'Penonton';
    if (!song) {
        return res.status(400).send('Query parameter "song" diperlukan.');
    }
    addRequest(song, user);
    res.send(`Request diterima: "${song}" oleh ${user}`);
});

app.get('/skip', (req, res) => {
    const user = req.query.user || 'Penonton';
    skipSong(user);
    res.send(`Lagu di-skip oleh ${user}`);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server Overlay Overmuse berjalan di http://localhost:${PORT}`);
});




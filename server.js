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
const pear = require('./pearClient');

const execPromise = util.promisify(exec);
const psScriptPath = path.join(__dirname, 'get-media.ps1');

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

// Ekstraksi warna tema dari URL cover art
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

app.use(express.static(path.join(__dirname, 'public')));

// State Lagu & Overlay
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

// Antrean request bot (untuk mencatat siapa peminta & urutannya)
let songQueue = [];

// Mapping videoId request -> { user, requestedAt }
const requestMap = new Map();

/**
 * 1. POLLING METADATA LAGU DARI PEAR DESKTOP API
 * Mengambil judul, artis, videoId, cover art, dan status play/pause langsung dari Pear Desktop
 */
let isMetadataPolling = false;
async function pollPearMetadata() {
    if (isMetadataPolling) return;
    isMetadataPolling = true;

    try {
        const song = await pear.getCurrentSong();

        if (song && song.title) {
            const isPlaying = !song.isPaused;
            currentProgress.status = isPlaying ? 'Playing' : 'Paused';
            if (song.songDuration) {
                currentProgress.duration = song.songDuration;
            }

            // Deteksi lagu baru
            const isNewSong = (song.videoId && song.videoId !== currentSong.videoId) ||
                             (!song.videoId && song.title !== currentSong.title);

            if (isNewSong) {
                console.log(`\n[Pear Player] Lagu Aktif: "${song.title}" oleh "${song.artist}" (${song.videoId || 'No ID'})`);

                // Cek apakah lagu ini request dari penonton
                let requester = '';
                let isReq = false;

                if (song.videoId && requestMap.has(song.videoId)) {
                    const reqInfo = requestMap.get(song.videoId);
                    requester = reqInfo.user;
                    isReq = true;
                    requestMap.delete(song.videoId);

                    const qIdx = songQueue.findIndex(q => q.videoId === song.videoId);
                    if (qIdx !== -1) {
                        songQueue.splice(qIdx, 1);
                        io.emit('queue-update', songQueue);
                    }
                }

                // Ambil lirik & tema warna
                const coverArt = song.imageSrc || null;
                const [lyricsResult, themeColor] = await Promise.all([
                    fetchLyrics(song.title, song.artist, 'auto').catch(() => null),
                    extractThemeColor(coverArt).catch(() => null)
                ]);

                let processedLyrics = null;
                if (lyricsResult && lyricsResult.lyrics) {
                    processedLyrics = processLyricsWithRomaji(lyricsResult.lyrics, lyricsResult.isSynced);
                }

                currentSong = {
                    videoId: song.videoId || '',
                    title: song.title,
                    artist: song.artist || '',
                    lyrics: lyricsResult ? lyricsResult.lyrics : null,
                    isSynced: lyricsResult ? lyricsResult.isSynced : false,
                    isJapanese: processedLyrics ? processedLyrics.isJapanese : false,
                    romajiMap: processedLyrics ? processedLyrics.romajiMap : null,
                    coverArt: coverArt,
                    themeColor: themeColor,
                    requestedBy: requester,
                    isRequest: isReq
                };

                io.emit('song-update', currentSong);
            }
        } else {
            currentProgress.status = 'Stopped';
        }
    } catch (err) {
        // Pear offline
    } finally {
        isMetadataPolling = false;
    }
}

/**
 * 2. POLLING PROGRESS / TIMELINE AKTIF
 * Menggunakan Windows Media Session untuk mengambil timeline detik yang akurat saat lagu berjalan
 */
let isTimelinePolling = false;
async function pollTimeline() {
    if (isTimelinePolling) return;
    isTimelinePolling = true;

    try {
        const { stdout } = await execPromise(`powershell -NoProfile -ExecutionPolicy Bypass -File "${psScriptPath}"`, { windowsHide: true, encoding: 'utf8' });
        const trimmed = stdout.trim();
        if (trimmed && trimmed !== '[]' && trimmed !== 'null') {
            const sessions = JSON.parse(trimmed);
            const list = Array.isArray(sessions) ? sessions : [sessions];

            // Cari sesi Pear Desktop / YouTube Music
            const ytSession = list.find(s => 
                (s.appId && (s.appId.toLowerCase().includes('youtube') || s.appId.toLowerCase().includes('pear'))) ||
                (s.title && s.title === currentSong.title)
            ) || list.find(s => s.status === 'Playing');

            if (ytSession) {
                currentProgress.progress = ytSession.position || 0;
                if (ytSession.duration > 0) {
                    currentProgress.duration = ytSession.duration;
                }
                currentProgress.status = ytSession.status || currentProgress.status;
                io.emit('progress-update', currentProgress);
            }
        }
    } catch (err) {
        // Abaikan error background PowerShell
    } finally {
        isTimelinePolling = false;
    }
}

// Interval polling: Metadata tiap 1 detik, Timeline pergerakan detik tiap 1 detik
setInterval(pollPearMetadata, 1000);
setInterval(pollTimeline, 1000);

/**
 * Menambahkan request baru ke Antrean Pear Desktop
 */
async function addRequest(query, user = 'Penonton') {
    if (!query) return;
    console.log(`[Request Queue] Request dari ${user}: "${query}"`);

    try {
        const ytData = await searchYouTubeSong(query);
        if (!ytData || !ytData.videoId) {
            console.warn(`[Request Queue] Lagu tidak ditemukan untuk query: "${query}"`);
            return;
        }

        const position = songQueue.length === 0 ? 'INSERT_AFTER_CURRENT_VIDEO' : 'INSERT_AT_END';

        await pear.addToQueue(ytData.videoId, position);
        console.log(`[Request Queue] Sukses diselipkan ke Pear Desktop: "${ytData.title}" (${position})`);

        requestMap.set(ytData.videoId, { user, requestedAt: Date.now() });

        const queueItem = {
            videoId: ytData.videoId,
            title: ytData.title,
            artist: ytData.artist,
            coverArt: ytData.coverArt,
            user: user,
            song: `${ytData.artist} - ${ytData.title}`
        };

        songQueue.push(queueItem);
        io.emit('new-request', { song: queueItem.song, user });
        io.emit('queue-update', songQueue);

    } catch (err) {
        console.error(`[Request Queue Error] Gagal memproses request "${query}":`, err.message);
    }
}

/**
 * Skip lagu langsung via API Pear Desktop
 */
async function skipSong(user) {
    console.log(`[Playback Control] Skip lagu dipicu oleh ${user || 'Penonton'}`);
    try {
        await pear.next();
        console.log('[Playback Control] Perintah NEXT berhasil dikirim ke Pear Desktop');
    } catch (err) {
        console.error('[Playback Control Error] Gagal skip:', err.message);
    }
}

// Inisialisasi Bot TikTok Live
initBot({ addRequest, skipSong });

// Socket.IO Handlers untuk Overlay
io.on('connection', (socket) => {
    socket.emit('song-update', currentSong);
    socket.emit('progress-update', currentProgress);
    socket.emit('queue-update', songQueue);

    socket.on('new-request', (data) => {
        if (data && data.song) {
            addRequest(data.song, data.user || 'Penonton');
        }
    });

    socket.on('skip-song', (data) => {
        skipSong(data ? data.user : 'Overlay Client');
    });
});

// Endpoint REST
app.get('/request', (req, res) => {
    const song = req.query.song;
    const user = req.query.user || 'Penonton';
    if (!song) {
        return res.status(400).send('Parameter "song" diperlukan.');
    }
    addRequest(song, user);
    res.send(`Request diterima: "${song}" oleh ${user}`);
});

app.get('/skip', (req, res) => {
    const user = req.query.user || 'Penonton';
    skipSong(user);
    res.send(`Lagu diskip oleh ${user}`);
});

app.get('/pause', async (req, res) => {
    await pear.pause();
    res.send('Player paused');
});

app.get('/play', async (req, res) => {
    await pear.play();
    res.send('Player resumed');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(` Overmuse Server aktif di http://localhost:${PORT}`);
    console.log(` Integrasi Hybrid: Metadata & Queue via Pear API + Timeline Presisi`);
    console.log(`=======================================================`);
});

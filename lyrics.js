const axios = require('axios');
const path = require('path');
const kuromoji = require('kuromoji');
const wanakana = require('wanakana');

// Inisialisasi Kuromoji Tokenizer untuk transliterasi Kanji/Kana -> Romaji
let kuromojiTokenizer = null;
let isTokenizerReady = false;

const dictPath = path.join(path.dirname(require.resolve('kuromoji')), '../dict');
kuromoji.builder({ dicPath: dictPath }).build((err, tokenizer) => {
    if (err) {
        console.warn('[Romaji] Gagal menginisialisasi Kuromoji tokenizer:', err.message);
    } else {
        kuromojiTokenizer = tokenizer;
        isTokenizerReady = true;
        console.log('[Romaji] Kuromoji tokenizer berhasil dimuat untuk lirik Jepang');
    }
});

/**
 * Cek apakah string mengandung karakter Jepang (Hiragana, Katakana, atau Kanji)
 */
function containsJapanese(str) {
    if (!str) return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(str);
}

/**
 * Konversi teks bahasa Jepang (Kanji, Hiragana, Katakana) menjadi Romaji
 */
function convertJapaneseToRomaji(text) {
    if (!text || !containsJapanese(text)) return text;

    if (isTokenizerReady && kuromojiTokenizer) {
        try {
            const tokens = kuromojiTokenizer.tokenize(text);
            const words = tokens.map(token => {
                // Jika memiliki reading (katakana), ubah reading ke romaji
                // Jika tidak ada reading (misal kata serapan/tanda baca), gunakan surface_form
                const kana = token.reading || token.surface_form;
                if (/[\u3040-\u309F\u30A0-\u30FF]/.test(kana)) {
                    return wanakana.toRomaji(kana);
                }
                return token.surface_form;
            });
            return words.join(' ').replace(/\s+/g, ' ').trim();
        } catch (e) {
            console.warn('[Romaji] Error tokenizing:', e.message);
        }
    }

    // Fallback: jika tokenizer belum siap atau gagal, gunakan wanakana langsung (untuk Kana)
    try {
        return wanakana.toRomaji(text);
    } catch (e) {
        return text;
    }
}

/**
 * Memproses teks lirik (LRC atau Plain).
 * Jika mengandung lirik Jepang, setiap baris ditambahkan romaji sebagai sub-teks atau metadata.
 */
function processLyricsWithRomaji(lyricsText, isSynced) {
    if (!lyricsText || !containsJapanese(lyricsText)) {
        return {
            lyrics: lyricsText,
            isJapanese: false,
            romajiMap: null
        };
    }

    const romajiMap = {};

    if (isSynced) {
        const lines = lyricsText.split(/\r?\n/);
        const timeRegex = /\[(\d{1,2}):(\d{2})(?:[\.\:](\d{2,3}))?\]/;

        for (const line of lines) {
            const match = line.match(timeRegex);
            if (match) {
                const text = line.replace(/\[\d{1,2}:\d{2}(?:[\.\:]\d{2,3})?\]/g, '').trim();
                if (text && containsJapanese(text)) {
                    const romaji = convertJapaneseToRomaji(text);
                    if (romaji && romaji.toLowerCase() !== text.toLowerCase()) {
                        romajiMap[text] = romaji;
                    }
                }
            }
        }
    } else {
        const lines = lyricsText.split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && containsJapanese(trimmed)) {
                const romaji = convertJapaneseToRomaji(trimmed);
                if (romaji && romaji.toLowerCase() !== trimmed.toLowerCase()) {
                    romajiMap[trimmed] = romaji;
                }
            }
        }
    }

    return {
        lyrics: lyricsText,
        isJapanese: true,
        romajiMap: romajiMap
    };
}

/**
 * Membersihkan judul dan artis dari tag ekstra (Official Video, Remastered, feat, dll.)
 */
function cleanString(str) {
    if (!str) return '';
    return str
        .replace(/[\(\[\{](official|lyric|video|audio|hd|4k|remastered|remaster|live|mono|stereo|full|version|visualizer|topic).*?[\)\]\}]/gi, '')
        .replace(/\b(feat\.|ft\.|with)\b.*$/gi, '')
        .replace(/ - Topic$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Fetch dari LRCLIB
 */
async function fetchFromLRCLIB(title, artist) {
    const cleanedTitle = cleanString(title);
    const cleanedArtist = cleanString(artist);

    // 1. Direct get dengan data bersih
    try {
        const res = await axios.get('https://lrclib.net/api/get', {
            params: { artist_name: cleanedArtist || artist, track_name: cleanedTitle || title },
            timeout: 5000
        });
        if (res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
            return {
                lyrics: res.data.syncedLyrics || res.data.plainLyrics,
                isSynced: !!res.data.syncedLyrics,
                provider: 'LRCLIB'
            };
        }
    } catch (e) {}

    // 2. Direct get dengan data asli jika berbeda
    if (cleanedTitle !== title || cleanedArtist !== artist) {
        try {
            const res = await axios.get('https://lrclib.net/api/get', {
                params: { artist_name: artist, track_name: title },
                timeout: 5000
            });
            if (res.data && (res.data.syncedLyrics || res.data.plainLyrics)) {
                return {
                    lyrics: res.data.syncedLyrics || res.data.plainLyrics,
                    isSynced: !!res.data.syncedLyrics,
                    provider: 'LRCLIB'
                };
            }
        } catch (e) {}
    }

    // 3. Search query fallback
    try {
        const query = `${cleanedArtist || artist} ${cleanedTitle || title}`.trim();
        const res = await axios.get('https://lrclib.net/api/search', {
            params: { q: query },
            timeout: 5000
        });
        if (res.data && Array.isArray(res.data) && res.data.length > 0) {
            const bestSynced = res.data.find(item => item.syncedLyrics);
            const choice = bestSynced || res.data[0];
            if (choice && (choice.syncedLyrics || choice.plainLyrics)) {
                return {
                    lyrics: choice.syncedLyrics || choice.plainLyrics,
                    isSynced: !!choice.syncedLyrics,
                    provider: 'LRCLIB'
                };
            }
        }
    } catch (e) {}

    return null;
}

/**
 * Mendeteksi apakah teks lirik terlihat corrupt/garbled (bukan bahasa yang valid).
 * Menghitung rasio karakter non-standar (bukan Latin, spasi, tanda baca umum, angka).
 */
function isLyricsCorrupt(lyricsText) {
    if (!lyricsText) return true;

    // Hapus timestamp LRC [mm:ss.xx] agar tidak ikut dihitung
    const cleaned = lyricsText.replace(/\[\d{2}:\d{2}[.:]\d{2,3}\]/g, '');

    // Hapus whitespace untuk pengecekan
    const textOnly = cleaned.replace(/\s+/g, '');
    if (textOnly.length < 10) return true; // Terlalu pendek = suspect

    // Karakter yang valid: Latin (termasuk extended/aksen), CJK, Hangul, Hiragana, Katakana,
    // Cyrillic, Arabic, Thai, Devanagari, angka, tanda baca umum
    const validPattern = /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0900-\u097F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF0-9.,!?'"\-()]/g;
    const validChars = textOnly.match(validPattern);
    const validRatio = validChars ? validChars.length / textOnly.length : 0;

    // Jika kurang dari 50% karakter valid, anggap corrupt
    if (validRatio < 0.5) {
        return true;
    }

    // Cek apakah terlalu banyak baris yang sangat pendek (1-2 karakter) = biasanya garbled
    const lines = cleaned.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length > 5) {
        const tooShortLines = lines.filter(l => l.length <= 2).length;
        if (tooShortLines / lines.length > 0.6) {
            return true;
        }
    }

    return false;
}

/**
 * Mencocokkan judul/artis yang dikembalikan Musixmatch dengan yang dicari.
 * Menggunakan perbandingan fuzzy sederhana (lowercase + substring check).
 */
function isTrackMatch(searchTitle, searchArtist, resultTitle, resultArtist) {
    if (!resultTitle) return false;

    const normalize = (s) => (s || '').toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const sTitle = normalize(searchTitle);
    const rTitle = normalize(resultTitle);
    const sArtist = normalize(searchArtist);
    const rArtist = normalize(resultArtist);

    // Cek apakah judul saling mengandung (substring match)
    const titleMatch = sTitle.includes(rTitle) || rTitle.includes(sTitle) ||
        sTitle.split(' ').filter(w => w.length > 2).some(w => rTitle.includes(w));

    // Cek apakah artis saling mengandung
    const artistMatch = !sArtist || !rArtist ||
        sArtist.includes(rArtist) || rArtist.includes(sArtist) ||
        sArtist.split(' ').filter(w => w.length > 2).some(w => rArtist.includes(w));

    return titleMatch && artistMatch;
}

/**
 * Fetch dari Musixmatch — dengan validasi judul/artis dan deteksi lirik corrupt.
 * Mengambil synced subtitle DAN plain lyrics, memilih yang paling akurat.
 */
async function fetchFromMusixmatch(title, artist) {
    const cleanedTitle = cleanString(title);
    const cleanedArtist = cleanString(artist);

    try {
        const res = await axios.get('https://apic-desktop.musixmatch.com/ws/1.1/macro.subtitles.get', {
            params: {
                format: 'json',
                user_token: '2005214b74424e666b69d7647242277d',
                q_track: cleanedTitle || title,
                q_artist: cleanedArtist || artist
            },
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 5000
        });

        const macro = res.data?.message?.body?.macro_calls;
        if (!macro) return null;

        // Cek info track yang dikembalikan Musixmatch untuk validasi
        const trackInfo = macro['matcher.track.get']?.message?.body?.track;
        if (trackInfo) {
            const mxTitle = trackInfo.track_name;
            const mxArtist = trackInfo.artist_name;

            if (!isTrackMatch(cleanedTitle || title, cleanedArtist || artist, mxTitle, mxArtist)) {
                console.log(`[Musixmatch] Track mismatch — dicari: "${cleanedTitle}" oleh "${cleanedArtist}", dapat: "${mxTitle}" oleh "${mxArtist}". Dilewati.`);
                return null;
            }
        }

        // Coba ambil synced subtitle
        let syncedLyrics = null;
        const subObj = macro['track.subtitles.get'];
        const subList = subObj?.message?.body?.subtitle_list;
        if (subList && subList.length > 0) {
            const lrc = subList[0].subtitle?.subtitle_body;
            if (lrc && !isLyricsCorrupt(lrc)) {
                syncedLyrics = lrc;
            } else if (lrc) {
                console.log('[Musixmatch] Synced subtitle terdeteksi corrupt/garbled, mencoba plain lyrics...');
            }
        }

        // Jika synced valid, langsung pakai
        if (syncedLyrics) {
            return {
                lyrics: syncedLyrics,
                isSynced: true,
                provider: 'MusixMatch'
            };
        }

        // Fallback: ambil plain lyrics dari track.lyrics.get
        const lyricsObj = macro['track.lyrics.get'];
        const lyricsBody = lyricsObj?.message?.body?.lyrics?.lyrics_body;
        if (lyricsBody && !isLyricsCorrupt(lyricsBody)) {
            // Hapus watermark Musixmatch di akhir lirik
            const cleanedLyrics = lyricsBody
                .replace(/\*{7}.*$/s, '')
                .replace(/This Lyrics is NOT for Commercial use.*/s, '')
                .trim();

            if (cleanedLyrics.length > 20) {
                return {
                    lyrics: cleanedLyrics,
                    isSynced: false,
                    provider: 'MusixMatch'
                };
            }
        }

        console.log('[Musixmatch] Tidak ada lirik valid yang ditemukan (corrupt atau kosong)');
    } catch (e) {
        console.warn('[Musixmatch] Error:', e.message);
    }

    return null;
}

/**
 * Fetch dari YTMusic (YouTube Captions / Transcript)
 */
async function fetchFromYTMusic(title, artist) {
    const cleanedTitle = cleanString(title);
    const cleanedArtist = cleanString(artist);
    const query = `${cleanedTitle || title} ${cleanedArtist || artist} lyrics`.trim();

    try {
        const searchRes = await axios.post('https://www.youtube.com/youtubei/v1/search', {
            context: { client: { clientName: 'WEB', clientVersion: '2.20231201.00.00' } },
            query: query
        }, { timeout: 5000 });

        const section = searchRes.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents[0]?.itemSectionRenderer?.contents;
        let videoId = null;
        if (section) {
            for (const item of section) {
                if (item.videoRenderer) {
                    videoId = item.videoRenderer.videoId;
                    break;
                }
            }
        }

        if (videoId) {
            const watchPage = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
                timeout: 5000
            });
            const matches = watchPage.data.match(/"captionTracks":\s*(\[.*?\])/);
            if (matches && matches[1]) {
                const tracks = JSON.parse(matches[1]);
                if (tracks.length > 0) {
                    const subRes = await axios.get(tracks[0].baseUrl + '&fmt=json3', { timeout: 5000 });
                    if (subRes.data.events) {
                        const lines = [];
                        for (const ev of subRes.data.events) {
                            if (ev.segs && ev.segs.length > 0) {
                                const text = ev.segs.map(s => s.utf8).join('').trim();
                                if (text && text !== '\n') {
                                    const sec = (ev.tStartMs || 0) / 1000;
                                    const mins = Math.floor(sec / 60).toString().padStart(2, '0');
                                    const secs = (sec % 60).toFixed(2).padStart(5, '0');
                                    lines.push(`[${mins}:${secs}] ${text}`);
                                }
                            }
                        }
                        if (lines.length > 0) {
                            return {
                                lyrics: lines.join('\n'),
                                isSynced: true,
                                provider: 'YTMusic'
                            };
                        }
                    }
                }
            }
        }
    } catch (e) {}

    return null;
}

/**
 * Utama: Fetch lirik berdasarkan provider pilihan atau auto fallback
 */
async function fetchLyrics(title, artist, preferredProvider = 'auto') {
    if (!title) return null;

    console.log(`[Lyrics] Mencari lirik untuk: "${title}" - "${artist}" (Provider: ${preferredProvider})`);

    const providers = {
        'lrclib': fetchFromLRCLIB,
        'musixmatch': fetchFromMusixmatch,
        'ytmusic': fetchFromYTMusic
    };

    // Jika provider tertentu dipilih
    if (preferredProvider !== 'auto' && providers[preferredProvider]) {
        const res = await providers[preferredProvider](title, artist);
        if (res) {
            console.log(`[Lyrics] Ditemukan dari provider pilihan: ${res.provider}`);
            return res;
        }
        console.log(`[Lyrics] Provider ${preferredProvider} tidak menemukan lirik, mencoba fallback...`);
    }

    // Auto fallback order: LRCLIB -> YTMusic -> Musixmatch (Musixmatch terakhir karena sering tidak akurat)
    const order = [fetchFromLRCLIB, fetchFromYTMusic, fetchFromMusixmatch];
    for (const fn of order) {
        const result = await fn(title, artist);
        if (result && result.lyrics) {
            console.log(`[Lyrics] Ditemukan dari: ${result.provider} (Synced: ${result.isSynced})`);
            return result;
        }
    }

    console.log(`[Lyrics] Tidak ada provider yang menemukan lirik untuk: ${title} - ${artist}`);
    return null;
}

module.exports = {
    fetchLyrics,
    cleanString,
    containsJapanese,
    convertJapaneseToRomaji,
    processLyricsWithRomaji
};


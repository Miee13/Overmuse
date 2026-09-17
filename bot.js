const tiktokConnector = require('tiktok-live-connector');
const TikTokLiveConnection = tiktokConnector.TikTokLiveConnection || tiktokConnector.WebcastPushConnection;

// ========================================================
// CONFIGURATION USERNAME TIKTOK
// ========================================================
const TIKTOK_USERNAME = 'orgamii';         // Ganti dengan Username TikTok Anda (saat sedang LIVE)

/**
 * Parser command case-insensitive untuk !request, !play, !sr, dan !skip
 */
function parseCommand(message) {
    if (!message || typeof message !== 'string') return null;
    const trimmed = message.trim();
    const lower = trimmed.toLowerCase();

    // Command Skip Lagu
    if (lower === '!skip' || lower.startsWith('!skip ') || lower === '!next') {
        return { type: 'skip' };
    }

    // Command Request Lagu (!request, !play, !sr, !req, !p)
    const match = trimmed.match(/^!(request|play|sr|req|p)[:\s]+(.+)$/i);
    if (match && match[2] && match[2].trim()) {
        return { type: 'request', song: match[2].trim() };
    }

    return null;
}

function initBot(handlers = {}) {
    const addRequest = handlers.addRequest || (() => {});
    const skipSong = handlers.skipSong || (() => {});

    // ----------------------------------------------------
    // Inisialisasi Bot TikTok Live Chat (Dengan Auto-Reconnect)
    // ----------------------------------------------------
    const cleanTikTokUser = TIKTOK_USERNAME ? TIKTOK_USERNAME.replace(/^@/, '').trim() : '';

    if (cleanTikTokUser && cleanTikTokUser !== 'USERNAME_TIKTOK') {
        let tiktokConnection = null;
        let isConnecting = false;
        let reconnectTimer = null;

        function connectTikTok() {
            if (isConnecting) return;
            isConnecting = true;

            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }

            try {
                tiktokConnection = new TikTokLiveConnection(cleanTikTokUser, {
                    processInitialData: false,
                    enableExtendedGiftInfo: false
                });

                tiktokConnection.connect().then(state => {
                    isConnecting = false;
                    console.log(`[Bot TikTok] Berhasil terhubung ke TikTok Live @${cleanTikTokUser} (Room ID: ${state.roomId})`);
                }).catch(err => {
                    isConnecting = false;
                    console.log(`[Bot TikTok] Akun @${cleanTikTokUser} belum LIVE atau koneksi gagal (${err.message}). Mencoba lagi dalam 15 detik...`);
                    scheduleReconnect(15000);
                });

                // Debug: Log struktur data chat pertama kali untuk mengetahui property yang tersedia
                let hasLoggedChatStructure = false;

                // Chat handler - menerima semua pesan dari SEMUA penonton (tanpa syarat follow)
                tiktokConnection.on('chat', data => {
                    if (!hasLoggedChatStructure) {
                        hasLoggedChatStructure = true;
                        console.log('[TikTok Debug] Struktur data chat pertama:', JSON.stringify(data, null, 2));
                    }

                    const message = data.comment || data.text || data.message || data.content || '';

                    // Ambil nama asli pengguna dari berbagai kemungkinan property
                    const user = data.nickname
                        || data.uniqueId
                        || (data.user && data.user.nickname)
                        || (data.user && data.user.uniqueId)
                        || data.userId
                        || data.username
                        || data.displayName
                        || 'Penonton TikTok';

                    console.log(`[TikTok Chat] ${user}: "${message}"`);

                    const cmd = parseCommand(message);
                    if (!cmd) return;

                    if (cmd.type === 'request') {
                        console.log(`[Request TikTok Diterima] ${user}: ${cmd.song}`);
                        addRequest(cmd.song, user);
                    } else if (cmd.type === 'skip') {
                        console.log(`[Skip TikTok Diterima] ${user} meminta skip lagu`);
                        skipSong(user);
                    }
                });

                tiktokConnection.on('disconnected', () => {
                    console.log(`[Bot TikTok] Terputus dari TikTok Live @${cleanTikTokUser}. Mencoba menghubungkan kembali dalam 10 detik...`);
                    scheduleReconnect(10000);
                });

                tiktokConnection.on('streamEnd', () => {
                    console.log(`[Bot TikTok] Live stream TikTok @${cleanTikTokUser} telah berakhir. Mengecek kembali dalam 30 detik...`);
                    scheduleReconnect(30000);
                });

                tiktokConnection.on('error', err => {
                    // Log error secara aman tanpa membuat aplikasi crash
                    console.warn(`[Bot TikTok Warning] ${err.message || err}`);
                });

            } catch (e) {
                isConnecting = false;
                console.error('[Bot TikTok] Error inisialisasi:', e.message);
                scheduleReconnect(15000);
            }
        }

        function scheduleReconnect(delayMs) {
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => {
                connectTikTok();
            }, delayMs);
        }

        connectTikTok();
    }
}

module.exports = { initBot };


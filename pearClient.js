const http = require('http');

const PEAR_HOST = process.env.PEAR_HOST || '127.0.0.1';
const PEAR_PORT = process.env.PEAR_PORT || 26538;

/**
 * Mengirim HTTP Request ke API Pear Desktop
 */
function request(method, path, body = null) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: PEAR_HOST,
            port: PEAR_PORT,
            path: path,
            method: method,
            headers: payload ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            } : {}
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(data ? JSON.parse(data) : null);
                    } catch (e) {
                        resolve(data);
                    }
                } else {
                    reject(new Error(`Pear API error: ${res.statusCode} ${data}`));
                }
            });
        });

        req.on('error', err => reject(err));
        req.setTimeout(3000, () => {
            req.destroy(new Error('Pear API request timeout'));
        });

        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

/**
 * Mengambil informasi lagu yang sedang aktif diputar
 */
async function getCurrentSong() {
    try {
        return await request('GET', '/api/v1/song');
    } catch (err) {
        return null;
    }
}

/**
 * Mengambil status antrean (queue) saat ini di Pear Desktop
 */
async function getQueue() {
    try {
        return await request('GET', '/api/v1/queue');
    } catch (err) {
        return null;
    }
}

/**
 * Menambahkan lagu ke antrean Pear Desktop
 * @param {string} videoId ID video YouTube
 * @param {string} position 'INSERT_AFTER_CURRENT_VIDEO' (diselipkan setelah lagu aktif) atau 'INSERT_AT_END'
 */
async function addToQueue(videoId, position = 'INSERT_AFTER_CURRENT_VIDEO') {
    return await request('POST', '/api/v1/queue', {
        videoId: videoId,
        insertPosition: position
    });
}

/**
 * Lompat / Play indeks lagu tertentu di antrean
 */
async function playQueueIndex(index) {
    return await request('PATCH', '/api/v1/queue', { index });
}

/**
 * Kontrol Playback
 */
async function play() {
    return await request('POST', '/api/v1/play');
}

async function pause() {
    return await request('POST', '/api/v1/pause');
}

async function next() {
    return await request('POST', '/api/v1/next');
}

async function previous() {
    return await request('POST', '/api/v1/previous');
}

module.exports = {
    getCurrentSong,
    getQueue,
    addToQueue,
    playQueueIndex,
    play,
    pause,
    next,
    previous
};

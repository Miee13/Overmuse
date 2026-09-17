const { startTunnel } = require('untun');

// Otomatis menjalankan server.js
console.log('Memulai Server Overmuse...');
require('./server.js');

async function main() {
    console.log('Membuat Cloudflare Tunnel untuk TikTok Studio...');
    let url = null;
    while (!url) {
        try {
            const tunnel = await startTunnel({ port: 3000, hostname: '127.0.0.1' });
            if (tunnel) {
                url = await tunnel.getURL();
                console.log('\n======================================================');
                console.log(`🎉 [SUKSES] Link Anda:`);
                console.log(`👉 ${url}`);
                console.log('======================================================\n');
                console.log('Salin (copy) link di atas dan tempel di TikTok Studio!');
                break;
            }
        } catch (e) {
            console.error('Koneksi Cloudflare Tunnel gagal/timeout:', e.message);
            console.log('Mencoba menghubungkan ulang ke Cloudflare Tunnel dalam 5 detik...');
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

main();

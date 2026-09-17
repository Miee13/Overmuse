const axios = require('axios');
const { cleanString } = require('./lyrics');

/**
 * Cari lagu di YouTube dan mengembalikan metadata: videoId, title, artist, coverArt
 */
async function searchYouTubeSong(query) {
    if (!query || typeof query !== 'string') return null;

    try {
        const searchRes = await axios.post('https://www.youtube.com/youtubei/v1/search', {
            context: { client: { clientName: 'WEB', clientVersion: '2.20231201.00.00' } },
            query: `${query} audio`
        }, { timeout: 6000 });

        const contents = searchRes.data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
        
        if (contents && Array.isArray(contents)) {
            for (const item of contents) {
                if (item.videoRenderer && item.videoRenderer.videoId) {
                    const videoId = item.videoRenderer.videoId;
                    const rawTitle = item.videoRenderer.title?.runs?.[0]?.text || query;
                    const rawArtist = item.videoRenderer.ownerText?.runs?.[0]?.text || '';
                    
                    // Format thumbnail HD
                    const coverArt = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

                    // Bersihkan judul dan artis
                    let title = cleanString(rawTitle);
                    let artist = cleanString(rawArtist);

                    // Jika judul mengandung " - ", pisahkan artist & title
                    if (rawTitle.includes(' - ')) {
                        const parts = rawTitle.split(' - ');
                        if (!artist || artist.toLowerCase().includes('topic')) {
                            artist = cleanString(parts[0]);
                        }
                        title = cleanString(parts.slice(1).join(' - '));
                    }

                    return {
                        videoId,
                        title: title || rawTitle,
                        artist: artist || rawArtist || 'Unknown Artist',
                        rawTitle,
                        coverArt
                    };
                }
            }
        }
    } catch (e) {
        console.error('[YT Search] Error saat mencari video:', e.message);
    }

    return null;
}

module.exports = { searchYouTubeSong };

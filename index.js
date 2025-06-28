const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');

// Addon manifest
const manifest = {
    id: 'animeowl.stremio.addon',
    version: '1.0.0',
    name: 'AnimeOwl',
    description: 'Watch anime and movies from AnimeOwl',
    logo: 'https://animeowl.me/assets/owl-logo-white-long.webp',
    resources: ['catalog', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'series',
            id: 'animeowl-trending',
            name: 'Trending Anime',
            extra: [{ name: 'skip' }]
        },
        {
            type: 'series',
            id: 'animeowl-recent-sub',
            name: 'Recent Episodes (SUB)',
            extra: [{ name: 'skip' }]
        },
        {
            type: 'movie',
            id: 'animeowl-movies',
            name: 'Anime Movies',
            extra: [{ name: 'skip' }]
        }
    ],
    idPrefixes: ['animeowl:']
};

const builder = new addonBuilder(manifest);
const BASE_URL = 'https://animeowl.me';

// Create axios instance with headers
const createApi = () => axios.create({
    timeout: 20000,
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5'
    }
});

// Parse search results using regex (no HTML parser needed)
function parseSearchResults(html) {
    const results = [];
    
    // Regex to match anime cards
    const cardRegex = /<div[^>]*class="[^"]*recent-anime[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>/gs;
    const matches = [...html.matchAll(cardRegex)];
    
    for (const match of matches) {
        const cardHtml = match[1];
        
        // Extract title from img alt
        const titleMatch = cardHtml.match(/alt="([^"]+)"/);
        const title = titleMatch ? titleMatch[1] : '';
        
        // Extract href
        const hrefMatch = cardHtml.match(/href="([^"]+)"/);
        const href = hrefMatch ? hrefMatch[1] : '';
        
        // Extract poster
        const posterMatch = cardHtml.match(/data-src="([^"]+)"|src="([^"]+)"/);
        const poster = posterMatch ? (posterMatch[1] || posterMatch[2]) : '';
        
        if (title && href) {
            const id = href.replace(BASE_URL, '').replace('/anime/', '');
            results.push({
                id: `animeowl:${id}`,
                type: 'series',
                name: title,
                poster: poster.startsWith('http') ? poster : BASE_URL + poster,
                description: title
            });
        }
    }
    
    return results;
}

// Catalog handler
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`Catalog: ${type}/${id}`);
    
    try {
        const api = createApi();
        const page = Math.floor(parseInt(extra.skip || 0) / 24) + 1;
        
        let endpoint = 'trending';
        switch (id) {
            case 'animeowl-recent-sub':
                endpoint = 'recent-episode/sub';
                break;
            case 'animeowl-movies':
                endpoint = 'type/movie';
                break;
        }
        
        const response = await api.get(`${BASE_URL}/${endpoint}?page=${page}`);
        const metas = parseSearchResults(response.data);
        
        return { metas };
    } catch (error) {
        console.error('Catalog error:', error.message);
        return { metas: [] };
    }
});

// Extract JWT from JS using regex
function extractJwt(jsContent) {
    const jwtRegex = /['"]([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)['"]/;
    const match = jsContent.match(jwtRegex);
    return match ? match[1] : null;
}

// Extract data-source using regex
function extractDataSource(html) {
    const match = html.match(/id="hot-anime-tab"[^>]*data-source="([^"]+)"/);
    return match ? match[1] : null;
}

// Extract episode links using regex
function extractEpisodeLinks(html) {
    const links = [];
    const linkRegex = /href="([^"]*\/episode\/[^"]+)"/g;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
        links.push(match[1]);
    }
    
    return links;
}

// Extract movie links using regex
function extractMovieLinks(html) {
    const links = [];
    const linkRegex = /class="episode-node"[^>]*href="([^"]+)"/g;
    let match;
    
    while ((match = linkRegex.exec(html)) !== null) {
        links.push(match[1]);
    }
    
    return links;
}

// Get streaming links
async function getStreamingLinks(url) {
    const api = createApi();
    const streams = [];
    
    try {
        console.log('Getting streams from:', url);
        
        const response = await api.get(url);
        const html = response.data;
        
        // Extract data-source
        const dataSrc = extractDataSource(html);
        if (!dataSrc) {
            console.log('No data-source found');
            return streams;
        }
        
        // Get player ID and fetch JS
        const id = dataSrc.split('/').pop();
        const jsUrl = `${BASE_URL}/players/${id}.v2.js`;
        
        const jsResponse = await api.get(jsUrl);
        const jwt = extractJwt(jsResponse.data);
        
        if (!jwt) {
            console.log('No JWT found');
            return streams;
        }
        
        // Get server data
        const jsonUrl = `${BASE_URL}${dataSrc}`;
        const serverResponse = await api.get(jsonUrl);
        const servers = serverResponse.data;
        
        // Process servers
        if (servers.kaido && servers.kaido[0]) {
            streams.push({
                name: 'AnimeOwl Kaido',
                title: 'Kaido Server',
                url: servers.kaido[0].url + jwt,
                behaviorHints: { bingeGroup: 'animeowl' }
            });
        }
        
        if (servers.luffy && servers.luffy.length > 0) {
            for (const video of servers.luffy.slice(0, 2)) { // Limit to 2 to avoid timeout
                streams.push({
                    name: `AnimeOwl Luffy ${video.resolution}`,
                    title: `Luffy ${video.resolution}`,
                    url: video.url + jwt,
                    behaviorHints: { bingeGroup: 'animeowl' }
                });
            }
        }
        
        if (servers.zoro && servers.zoro[0]) {
            try {
                const zoroResponse = await api.get(servers.zoro[0].url + jwt);
                if (zoroResponse.data.url) {
                    streams.push({
                        name: 'AnimeOwl Zoro',
                        title: 'Zoro Server',
                        url: zoroResponse.data.url,
                        subtitles: zoroResponse.data.subtitle ? [{
                            url: zoroResponse.data.subtitle,
                            lang: 'eng'
                        }] : undefined,
                        behaviorHints: { bingeGroup: 'animeowl' }
                    });
                }
            } catch (err) {
                console.log('Zoro error:', err.message);
            }
        }
        
    } catch (error) {
        console.error('Stream error:', error.message);
    }
    
    return streams;
}

// Stream handler
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`Stream: ${type}/${id}`);
    
    if (!id.startsWith('animeowl:')) {
        return { streams: [] };
    }
    
    try {
        const slug = id.replace('animeowl:', '');
        const api = createApi();
        
        const animeUrl = `${BASE_URL}/anime/${slug}`;
        const response = await api.get(animeUrl);
        const html = response.data;
        
        // Check if movie or series
        const isMovie = !html.includes('div.type.d-flex a">TV<');
        
        let targetLinks = [];
        
        if (isMovie) {
            targetLinks = extractMovieLinks(html);
        } else {
            targetLinks = extractEpisodeLinks(html);
        }
        
        // Try to get streams from first available link
        for (const link of targetLinks.slice(0, 2)) {
            const streams = await getStreamingLinks(link);
            if (streams.length > 0) {
                return { streams };
            }
        }
        
        return { streams: [] };
        
    } catch (error) {
        console.error('Handler error:', error.message);
        return { streams: [] };
    }
});

// Export for Vercel serverless
const addonInterface = builder.getInterface();

// Export the Express app directly for Vercel
module.exports = addonInterface;

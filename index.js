const { addonBuilder } = require('stremio-addon-sdk');
const axios = require('axios');
const { JSDOM } = require('jsdom');

// Addon manifest - defines what the addon provides
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
            type: 'series',
            id: 'animeowl-recent-dub',
            name: 'Recent Episodes (DUB)',
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

// Helper function to create axios instance with proper headers
const createAxiosInstance = () => {
    return axios.create({
        timeout: 15000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
        }
    });
};

// Parse HTML using JSDOM instead of Cheerio
function parseSearchResult(html, element) {
    try {
        const img = element.querySelector('a.post-thumb img');
        const link = element.querySelector('a.post-thumb');
        
        if (!img || !link) return null;
        
        const title = img.getAttribute('alt') || '';
        const href = link.getAttribute('href') || '';
        const posterUrl = img.getAttribute('data-src') || img.getAttribute('src') || '';
        
        // Extract ID from href for Stremio format
        const id = href.replace(BASE_URL, '').replace('/anime/', '');
        
        if (!id || !title) return null;
        
        return {
            id: `animeowl:${id}`,
            type: 'series',
            name: title,
            poster: posterUrl.startsWith('http') ? posterUrl : BASE_URL + posterUrl,
            description: title
        };
    } catch (err) {
        console.log('Error parsing search result:', err.message);
        return null;
    }
}

// Catalog handler - provides content discovery
builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log(`Catalog request: ${type}/${id}`);
    
    try {
        const api = createAxiosInstance();
        const skip = parseInt(extra.skip || 0);
        const page = Math.floor(skip / 24) + 1;
        
        let endpoint = '';
        switch (id) {
            case 'animeowl-trending':
                endpoint = 'trending';
                break;
            case 'animeowl-recent-sub':
                endpoint = 'recent-episode/sub';
                break;
            case 'animeowl-recent-dub':
                endpoint = 'recent-episode/dub';
                break;
            case 'animeowl-movies':
                endpoint = 'type/movie';
                break;
            default:
                endpoint = 'trending';
        }
        
        const response = await api.get(`${BASE_URL}/${endpoint}?page=${page}`);
        const dom = new JSDOM(response.data);
        const document = dom.window.document;
        
        const metas = [];
        const elements = document.querySelectorAll('div.recent-anime');
        
        elements.forEach(element => {
            try {
                const meta = parseSearchResult(response.data, element);
                if (meta && meta.id && meta.name) {
                    metas.push(meta);
                }
            } catch (err) {
                console.log('Error parsing result:', err.message);
            }
        });
        
        return { metas };
    } catch (error) {
        console.error('Catalog error:', error.message);
        return { metas: [] };
    }
});

// Extract JWT token from JavaScript code
function extractJwtFromScript(scriptContent) {
    const jwtPattern = /['"]([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)['"]/;
    const match = scriptContent.match(jwtPattern);
    return match ? match[1] : null;
}

// Simplified JavaScript deobfuscation (basic string replacements)
function simpleDeobfuscate(code) {
    return code
        .replace(/\s+/g, ' ')
        .replace(/\/\*.*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
}

// Extract streaming links from the video page
async function extractStreamingLinks(url, referer = BASE_URL) {
    const api = createAxiosInstance();
    const streams = [];
    
    try {
        console.log('Extracting streams from:', url);
        
        // Get the main page content
        const response = await api.get(url);
        const dom = new JSDOM(response.data);
        const document = dom.window.document;
        
        // Look for data-source attribute (contains video server info)
        const hotTab = document.querySelector('#hot-anime-tab');
        const dataSrc = hotTab?.getAttribute('data-source');
        
        if (!dataSrc) {
            console.log('No data-source found');
            return streams;
        }
        
        // Extract ID from data-source
        const id = dataSrc.split('/').pop();
        const jsUrl = `${referer}/players/${id}.v2.js`;
        
        console.log('Fetching JS:', jsUrl);
        
        // Get the JavaScript file
        const jsResponse = await api.get(jsUrl);
        const deobfuscatedJS = simpleDeobfuscate(jsResponse.data);
        
        // Extract JWT token
        const jwt = extractJwtFromScript(deobfuscatedJS);
        if (!jwt) {
            console.log('No JWT token found');
            return streams;
        }
        
        console.log('JWT extracted successfully');
        
        // Get video server data
        const jsonUrl = `${referer}${dataSrc}`;
        const jsonResponse = await api.get(jsonUrl);
        const servers = jsonResponse.data;
        
        // Process different server types
        
        // Kaido server (single source)
        if (servers.kaido && servers.kaido.length > 0) {
            const kaidoUrl = servers.kaido[0].url + jwt;
            streams.push({
                name: 'AnimeOwl Kaido',
                title: 'Kaido Server (HD)',
                url: kaidoUrl,
                behaviorHints: {
                    bingeGroup: 'animeowl-kaido'
                }
            });
        }
        
        // Luffy server (multiple resolutions)
        if (servers.luffy && servers.luffy.length > 0) {
            for (const video of servers.luffy) {
                const luffyUrl = video.url + jwt;
                streams.push({
                    name: `AnimeOwl Luffy (${video.resolution})`,
                    title: `Luffy Server - ${video.resolution}`,
                    url: luffyUrl,
                    behaviorHints: {
                        bingeGroup: 'animeowl-luffy'
                    }
                });
            }
        }
        
        // Zoro server (with subtitles)
        if (servers.zoro && servers.zoro.length > 0) {
            const zoroUrl = servers.zoro[0].url + jwt;
            try {
                const zoroResponse = await api.get(zoroUrl);
                const zoroData = zoroResponse.data;
                
                if (zoroData.url) {
                    streams.push({
                        name: 'AnimeOwl Zoro',
                        title: 'Zoro Server (SUB)',
                        url: zoroData.url,
                        subtitles: zoroData.subtitle ? [
                            {
                                url: zoroData.subtitle,
                                lang: 'eng'
                            }
                        ] : undefined,
                        behaviorHints: {
                            bingeGroup: 'animeowl-zoro'
                        }
                    });
                }
            } catch (zoroError) {
                console.log('Zoro server error:', zoroError.message);
            }
        }
        
    } catch (error) {
        console.error('Stream extraction error:', error.message);
    }
    
    return streams;
}

// Stream handler - provides direct streaming links
builder.defineStreamHandler(async ({ type, id }) => {
    console.log(`Stream request: ${type}/${id}`);
    
    if (!id.startsWith('animeowl:')) {
        return { streams: [] };
    }
    
    try {
        const animeSlug = id.replace('animeowl:', '');
        const api = createAxiosInstance();
        
        // Get anime page to find episodes/movie links
        const animeUrl = `${BASE_URL}/anime/${animeSlug}`;
        const response = await api.get(animeUrl);
        const dom = new JSDOM(response.data);
        const document = dom.window.document;
        
        const streams = [];
        
        // Check if it's a TV series or movie
        const typeElement = document.querySelector('div.type.d-flex a');
        const typeText = typeElement?.textContent?.trim() || '';
        const isMovie = typeText !== 'TV';
        
        if (isMovie) {
            // For movies, get direct episode links
            const movieLinks = [];
            const episodeNodes = document.querySelectorAll('a.episode-node');
            episodeNodes.forEach(node => {
                const href = node.getAttribute('href');
                if (href) movieLinks.push(href);
            });
            
            // Extract streams from movie links
            for (const link of movieLinks.slice(0, 3)) { // Limit to first 3 to avoid timeout
                const movieStreams = await extractStreamingLinks(link);
                streams.push(...movieStreams);
                if (streams.length > 0) break; // Stop after finding working streams
            }
        } else {
            // For TV series, get first available episode
            const subEpisode = document.querySelector('#anime-cover-sub-content .episode-node a');
            const dubEpisode = document.querySelector('#anime-cover-dub-content .episode-node a');
            
            const firstEpisode = subEpisode?.getAttribute('href') || dubEpisode?.getAttribute('href');
            
            if (firstEpisode) {
                const episodeStreams = await extractStreamingLinks(firstEpisode);
                streams.push(...episodeStreams);
            }
        }
        
        console.log(`Found ${streams.length} streams for ${id}`);
        return { streams };
        
    } catch (error) {
        console.error('Stream handler error:', error.message);
        return { streams: [] };
    }
});

module.exports = builder.getInterface();

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5600);
const ROOT = __dirname;
const OPEN_SKY_URL = 'https://opensky-network.org/api/states/all';
const AIRPORTS_SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const TLE_SOURCES = {
    stations: [
        'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle',
        'https://retlector.eu/tle/stations'
    ],
    active: [
        'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',
        'https://retlector.eu/tle/active'
    ]
};
const ALLOWED_FLIGHT_PARAMS = new Set(['lamin', 'lomin', 'lamax', 'lomax']);
const FLIGHT_CACHE_TTL_MS = 60000;
const FLIGHT_ERROR_CACHE_TTL_MS = 30000;
const FLIGHT_RATE_LIMIT_TTL_MS = 120000;
const AIRPORT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TLE_CACHE_TTL_MS = 60 * 60 * 1000;
const TLE_REQUEST_TIMEOUT_MS = 15000;
const TLE_CACHE_DIR = path.join(ROOT, '.cache');
const flightCache = new Map();
const tleCache = new Map();
let airportCache = null;
let openSkyRateLimitedUntil = 0;

function loadDotEnv() {
    const envPath = path.join(ROOT, '.env');
    try {
        const body = fs.readFileSync(envPath, 'utf8');
        body.split(/\r?\n/).forEach(line => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const separator = trimmed.indexOf('=');
            if (separator <= 0) return;
            const key = trimmed.slice(0, separator).trim();
            const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
            if (!process.env[key]) process.env[key] = value;
        });
    } catch (error) {
        return;
    }
}

loadDotEnv();

const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml'
};

function send(response, statusCode, body, headers = {}) {
    response.writeHead(statusCode, {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        ...headers
    });
    response.end(body);
}

function sendRuntimeConfig(response) {
    const config = {
        CESIUM_ION_TOKEN: process.env.CESIUM_ION_TOKEN || '',
        AIS_API_KEY: process.env.AIS_API_KEY || ''
    };
    const body = Object.entries(config)
        .map(([key, value]) => `window.${key} = ${JSON.stringify(value)};`)
        .join('\n');
    send(response, 200, `${body}\n`, {
        'Content-Type': 'text/javascript; charset=utf-8'
    });
}

function getTleCachePath(sourceName) {
    return path.join(TLE_CACHE_DIR, `${sourceName}.tle`);
}

function isTleBody(body) {
    const lines = String(body || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    for (let i = 0; i + 1 < lines.length; i += 1) {
        if (lines[i].startsWith('1 ') && lines[i + 1].startsWith('2 ')) {
            return true;
        }
    }
    return false;
}

function readTleDiskCache(sourceName) {
    try {
        const body = fs.readFileSync(getTleCachePath(sourceName), 'utf8');
        if (isTleBody(body)) {
            return body;
        }
    } catch (error) {
        return null;
    }
    return null;
}

function writeTleDiskCache(sourceName, body) {
    try {
        fs.mkdirSync(TLE_CACHE_DIR, { recursive: true });
        fs.writeFileSync(getTleCachePath(sourceName), body, 'utf8');
    } catch (error) {
        console.warn('Kunne ikke gemme TLE-cache:', error.message);
    }
}

function createEmptyFlightResult(reason = 'rate-limited') {
    return {
        statusCode: 200,
        body: JSON.stringify({ time: Math.floor(Date.now() / 1000), states: [] }),
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Flight-Data-Source': reason
        },
        expiresAt: Date.now() + FLIGHT_ERROR_CACHE_TTL_MS
    };
}

function createRateLimitFallback(cached) {
    if (cached && cached.body && cached.statusCode === 200) {
        return {
            ...cached,
            headers: {
                ...cached.headers,
                'X-Flight-Data-Source': 'stale-cache',
                'X-OpenSky-Rate-Limited': 'true'
            },
            expiresAt: Date.now() + FLIGHT_ERROR_CACHE_TTL_MS
        };
    }

    return createEmptyFlightResult();
}

async function proxyFlights(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const openSkyUrl = new URL(OPEN_SKY_URL);

    for (const key of ALLOWED_FLIGHT_PARAMS) {
        const value = requestUrl.searchParams.get(key);
        const numericValue = Number(value);
        if (value !== null && Number.isFinite(numericValue)) {
            openSkyUrl.searchParams.set(key, numericValue.toFixed(4));
        }
    }

    const cacheKey = openSkyUrl.searchParams.toString() || 'world';
    const cached = flightCache.get(cacheKey);
    const now = Date.now();

    if (now < openSkyRateLimitedUntil) {
        const fallback = createRateLimitFallback(cached);
        flightCache.set(cacheKey, fallback);
        send(response, fallback.statusCode, fallback.body, fallback.headers);
        return;
    }

    if (cached && cached.pending) {
        try {
            const pendingResult = await cached.pending;
            send(response, pendingResult.statusCode, pendingResult.body, pendingResult.headers);
        } catch (error) {
            const fallback = createEmptyFlightResult('opensky-unavailable');
            send(response, fallback.statusCode, fallback.body, fallback.headers);
        }
        return;
    }

    if (cached && cached.expiresAt > now) {
        send(response, cached.statusCode, cached.body, cached.headers);
        return;
    }

    try {
        const pending = fetch(openSkyUrl)
            .then(async openSkyResponse => {
                const body = await openSkyResponse.text();
                const headers = {
                    'Content-Type': openSkyResponse.headers.get('content-type') || 'application/json; charset=utf-8',
                    'X-Flight-Data-Source': 'opensky'
                };
                if (openSkyResponse.status === 429) {
                    openSkyRateLimitedUntil = Date.now() + FLIGHT_RATE_LIMIT_TTL_MS;
                    const fallback = createRateLimitFallback(cached);
                    flightCache.set(cacheKey, fallback);
                    return fallback;
                }

                if (!openSkyResponse.ok) {
                    const fallback = createRateLimitFallback(cached);
                    fallback.headers = {
                        ...fallback.headers,
                        'X-Flight-Data-Source': `opensky-http-${openSkyResponse.status}`
                    };
                    flightCache.set(cacheKey, fallback);
                    return fallback;
                }

                const ttl = openSkyResponse.ok ? FLIGHT_CACHE_TTL_MS : FLIGHT_ERROR_CACHE_TTL_MS;
                const result = {
                    statusCode: openSkyResponse.status,
                    body,
                    headers,
                    expiresAt: Date.now() + ttl
                };
                flightCache.set(cacheKey, result);
                return result;
            })
            .finally(() => {
                const latest = flightCache.get(cacheKey);
                if (latest && latest.pending) {
                    flightCache.delete(cacheKey);
                }
            });

        flightCache.set(cacheKey, { pending });
        const result = await pending;
        send(response, result.statusCode, result.body, result.headers);
    } catch (error) {
        console.error('OpenSky proxy error:', error);
        const fallback = createRateLimitFallback(cached);
        fallback.headers = {
            ...fallback.headers,
            'X-Flight-Data-Source': 'opensky-unavailable'
        };
        flightCache.set(cacheKey, fallback);
        send(response, fallback.statusCode, fallback.body, fallback.headers);
    }
}

async function proxyAirports(request, response) {
    const now = Date.now();

    if (airportCache && airportCache.expiresAt > now) {
        send(response, airportCache.statusCode, airportCache.body, airportCache.headers);
        return;
    }

    try {
        const airportResponse = await fetch(AIRPORTS_SOURCE_URL);
        const body = await airportResponse.text();
        airportCache = {
            statusCode: airportResponse.status,
            body,
            headers: {
                'Content-Type': airportResponse.headers.get('content-type') || 'text/csv; charset=utf-8',
                'X-Airport-Data-Source': 'ourairports'
            },
            expiresAt: now + (airportResponse.ok ? AIRPORT_CACHE_TTL_MS : FLIGHT_ERROR_CACHE_TTL_MS)
        };
        send(response, airportCache.statusCode, airportCache.body, airportCache.headers);
    } catch (error) {
        console.error('Airport proxy error:', error);
        send(response, 502, 'Kunne ikke hente lufthavnsdata.', {
            'Content-Type': 'text/plain; charset=utf-8'
        });
    }
}

async function proxyTle(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const sourceName = requestUrl.pathname.endsWith('/active') ? 'active' : 'stations';
    const sourceUrls = TLE_SOURCES[sourceName];
    const cached = tleCache.get(sourceName);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
        send(response, cached.statusCode, cached.body, cached.headers);
        return;
    }

    try {
        let lastError = null;

        for (const sourceUrl of sourceUrls) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), TLE_REQUEST_TIMEOUT_MS);
            try {
                const tleResponse = await fetch(sourceUrl, {
                    signal: controller.signal,
                    headers: {
                        'Accept': 'text/plain,*/*',
                        'User-Agent': 'SpaceEarthControlCenter/1.0 (local map app)'
                    }
                });
                const body = await tleResponse.text();
                if (!tleResponse.ok || !isTleBody(body)) {
                    lastError = new Error(`TLE-kilde svarede ${tleResponse.status}`);
                    continue;
                }

                const result = {
                    statusCode: 200,
                    body,
                    headers: {
                        'Content-Type': 'text/plain; charset=utf-8',
                        'X-TLE-Data-Source': sourceUrl
                    },
                    expiresAt: now + TLE_CACHE_TTL_MS
                };
                tleCache.set(sourceName, result);
                writeTleDiskCache(sourceName, body);
                send(response, result.statusCode, result.body, result.headers);
                return;
            } catch (error) {
                lastError = error;
            } finally {
                clearTimeout(timeout);
            }
        }

        const diskBody = readTleDiskCache(sourceName);
        if (diskBody) {
            const result = {
                statusCode: 200,
                body: diskBody,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'X-TLE-Data-Source': 'disk-cache',
                    'X-TLE-Stale': 'true'
                },
                expiresAt: now + FLIGHT_ERROR_CACHE_TTL_MS
            };
            tleCache.set(sourceName, result);
            send(response, result.statusCode, result.body, result.headers);
            return;
        }

        throw lastError || new Error('Ingen TLE-kilder svarede.');
    } catch (error) {
        console.error('TLE proxy error:', error);
        send(response, 502, 'Kunne ikke hente TLE-data.', {
            'Content-Type': 'text/plain; charset=utf-8'
        });
    }
}

function serveStatic(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const requestedPath = requestUrl.pathname === '/' ? '/map.html' : requestUrl.pathname;
    const filePath = path.resolve(ROOT, `.${decodeURIComponent(requestedPath)}`);

    if (!filePath.startsWith(ROOT)) {
        send(response, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
    }

    fs.readFile(filePath, (error, contents) => {
        if (error) {
            send(response, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
            return;
        }

        const extension = path.extname(filePath).toLowerCase();
        send(response, 200, contents, {
            'Content-Type': contentTypes[extension] || 'application/octet-stream'
        });
    });
}

const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') {
        send(response, 204, '', {
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return;
    }

    if (request.url.startsWith('/api/flights')) {
        proxyFlights(request, response);
        return;
    }

    if (request.url.startsWith('/api/airports')) {
        proxyAirports(request, response);
        return;
    }

    if (request.url.startsWith('/api/tle')) {
        proxyTle(request, response);
        return;
    }

    if (request.url.startsWith('/api/config.js')) {
        sendRuntimeConfig(response);
        return;
    }

    serveStatic(request, response);
});

server.on('error', error => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use.`);
        console.error(`The map server may already be running at http://127.0.0.1:${PORT}/map.html`);
        console.error('Close the other server window, or open the URL above in your browser.');
        process.exit(1);
    }

    throw error;
});

server.listen(PORT, () => {
    console.log(`Map server running at http://127.0.0.1:${PORT}/map.html`);
});

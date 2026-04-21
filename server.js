const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5600);
const ROOT = __dirname;
const OPEN_SKY_URL = 'https://opensky-network.org/api/states/all';
const ALLOWED_FLIGHT_PARAMS = new Set(['lamin', 'lomin', 'lamax', 'lomax']);
const FLIGHT_CACHE_TTL_MS = 60000;
const FLIGHT_ERROR_CACHE_TTL_MS = 30000;
const FLIGHT_RATE_LIMIT_TTL_MS = 120000;
const flightCache = new Map();
let openSkyRateLimitedUntil = 0;

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
            send(response, 502, JSON.stringify({ error: 'Kunne ikke hente flydata fra OpenSky.' }), {
                'Content-Type': 'application/json; charset=utf-8'
            });
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
                    'Content-Type': openSkyResponse.headers.get('content-type') || 'application/json; charset=utf-8'
                };
                if (openSkyResponse.status === 429) {
                    openSkyRateLimitedUntil = Date.now() + FLIGHT_RATE_LIMIT_TTL_MS;
                    const fallback = createRateLimitFallback(cached);
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
        send(response, 502, JSON.stringify({ error: 'Kunne ikke hente flydata fra OpenSky.' }), {
            'Content-Type': 'application/json; charset=utf-8'
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

    serveStatic(request, response);
});

server.listen(PORT, () => {
    console.log(`Map server running at http://127.0.0.1:${PORT}/map.html`);
});

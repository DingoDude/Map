const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5600);
const ROOT = __dirname;
const OPEN_SKY_URL = 'https://opensky-network.org/api/states/all';
const AIRPORTS_SOURCE_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const WINDY_WEBCAMS_URL = 'https://api.windy.com/webcams/api/v3/webcams';
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
const WIND_CACHE_TTL_MS = 10 * 60 * 1000;
const LIVE_CAMERA_CACHE_TTL_MS = 60 * 60 * 1000;
const WIND_MAX_POINTS = 48;
const TLE_CACHE_DIR = path.join(ROOT, '.cache');
const flightCache = new Map();
const windCache = new Map();
let liveCameraCache = null;
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

function clampNumber(value, min, max, fallback) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(Math.max(numeric, min), max);
}

function buildWindSamplesFromBounds(requestUrl) {
    let west = clampNumber(requestUrl.searchParams.get('west'), -180, 180, 8);
    let east = clampNumber(requestUrl.searchParams.get('east'), -180, 180, 16);
    const south = clampNumber(requestUrl.searchParams.get('south'), -85, 85, 52);
    const north = clampNumber(requestUrl.searchParams.get('north'), -85, 85, 58);
    const columns = Math.round(clampNumber(requestUrl.searchParams.get('columns'), 3, 8, 7));
    const rows = Math.round(clampNumber(requestUrl.searchParams.get('rows'), 3, 6, 5));
    const pointCount = Math.min(columns * rows, WIND_MAX_POINTS);

    if (east < west) east += 360;

    const actualColumns = Math.max(1, Math.min(columns, pointCount));
    const actualRows = Math.max(1, Math.ceil(pointCount / actualColumns));
    const lonSpan = Math.max(east - west, 0.5);
    const latSpan = Math.max(north - south, 0.5);
    const lonStep = lonSpan / actualColumns;
    const latStep = latSpan / actualRows;
    const samples = [];

    for (let row = 0; row < actualRows; row += 1) {
        for (let column = 0; column < actualColumns; column += 1) {
            if (samples.length >= pointCount) break;
            let lon = west + lonStep * (column + 0.5);
            if (lon > 180) lon -= 360;
            const lat = south + latStep * (row + 0.5);
            samples.push({
                lon,
                lat,
                cellLonSpan: lonStep,
                cellLatSpan: latStep
            });
        }
    }

    return samples;
}

function normalizeOpenMeteoCurrent(payload) {
    if (Array.isArray(payload)) return payload;
    return payload ? [payload] : [];
}

async function proxyWind(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const samples = buildWindSamplesFromBounds(requestUrl);
    const cacheKey = samples
        .map(sample => `${sample.lat.toFixed(3)},${sample.lon.toFixed(3)}`)
        .join('|');
    const now = Date.now();
    const cached = windCache.get(cacheKey);

    if (cached && cached.expiresAt > now) {
        send(response, 200, cached.body, cached.headers);
        return;
    }

    try {
        const weatherUrl = new URL(OPEN_METEO_URL);
        weatherUrl.searchParams.set('latitude', samples.map(sample => sample.lat.toFixed(4)).join(','));
        weatherUrl.searchParams.set('longitude', samples.map(sample => sample.lon.toFixed(4)).join(','));
        weatherUrl.searchParams.set('current', 'wind_speed_10m,wind_direction_10m');
        weatherUrl.searchParams.set('wind_speed_unit', 'ms');
        weatherUrl.searchParams.set('timezone', 'auto');

        const weatherResponse = await fetch(weatherUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SpaceEarthControlCenter/1.0 (local map app)'
            }
        });

        if (!weatherResponse.ok) {
            throw new Error(`Open-Meteo svarede ${weatherResponse.status}`);
        }

        const payload = normalizeOpenMeteoCurrent(await weatherResponse.json());
        const windSamples = samples.map((sample, index) => {
            const item = payload[index] || {};
            const current = item.current || {};
            return {
                lon: sample.lon,
                lat: sample.lat,
                cellLonSpan: sample.cellLonSpan,
                cellLatSpan: sample.cellLatSpan,
                speed: Number(current.wind_speed_10m),
                direction: Number(current.wind_direction_10m),
                time: current.time || ''
            };
        }).filter(sample => Number.isFinite(sample.speed) && Number.isFinite(sample.direction));

        const body = JSON.stringify({
            meta: {
                source: 'Open-Meteo',
                unit: 'm/s',
                generatedAt: new Date().toISOString()
            },
            samples: windSamples
        });
        const headers = {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Wind-Data-Source': 'open-meteo'
        };

        windCache.set(cacheKey, {
            body,
            headers,
            expiresAt: now + WIND_CACHE_TTL_MS
        });
        send(response, 200, body, headers);
    } catch (error) {
        console.error('Wind proxy error:', error);
        send(response, 502, JSON.stringify({ samples: [], error: 'Kunne ikke hente vinddata.' }), {
            'Content-Type': 'application/json; charset=utf-8'
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

function normalizeWindyCamera(webcam) {
    const location = webcam.location || {};
    const player = webcam.player || {};
    const urls = webcam.urls || {};
    const categories = Array.isArray(webcam.categories) ? webcam.categories : [];
    const lat = Number(location.latitude ?? location.lat);
    const lon = Number(location.longitude ?? location.lon ?? location.lng);
    const id = String(webcam.id || '').trim();

    if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

    const title = String(webcam.title || webcam.name || `Windy webcam ${id}`).trim();
    const categoryNames = categories
        .map(category => category && (category.name || category.id))
        .filter(Boolean);
    const playerUrl = player.day || player.live || player.month || player.year || player.lifetime || urls.detail || urls.webcam;

    if (!playerUrl) return null;

    return {
        id: `windy-${id}`,
        name: title,
        type: categoryNames[0] || 'Live kamera',
        position: [lon, lat],
        source: 'Windy Webcams',
        sourceUrl: urls.detail || urls.webcam || playerUrl,
        embedUrl: playerUrl,
        keywords: `${title} ${location.city || ''} ${location.region || ''} ${location.country || ''} ${categoryNames.join(' ')} windy webcam`
    };
}

async function proxyLiveCameras(request, response) {
    const apiKey = process.env.WINDY_WEBCAMS_API_KEY || '';
    if (!apiKey) {
        send(response, 200, JSON.stringify({
            meta: {
                source: 'Windy Webcams',
                disabled: true,
                reason: 'WINDY_WEBCAMS_API_KEY mangler'
            },
            cameras: []
        }), { 'Content-Type': 'application/json; charset=utf-8' });
        return;
    }

    const now = Date.now();
    if (liveCameraCache && liveCameraCache.expiresAt > now) {
        send(response, 200, liveCameraCache.body, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Live-Camera-Data-Source': 'cache'
        });
        return;
    }

    try {
        const requestUrl = new URL(request.url, `http://${request.headers.host}`);
        const limit = Math.min(Math.max(Number(requestUrl.searchParams.get('limit')) || 200, 1), 200);
        const windyUrl = new URL(WINDY_WEBCAMS_URL);
        windyUrl.searchParams.set('limit', String(limit));
        windyUrl.searchParams.set('offset', '0');
        windyUrl.searchParams.set('include', 'categories,location,player,urls');
        windyUrl.searchParams.set('lang', 'en');
        windyUrl.searchParams.set('sortBy', 'popularity');
        windyUrl.searchParams.set('sortDirection', 'desc');

        const windyResponse = await fetch(windyUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'SpaceEarthControlCenter/1.0 (local map app)',
                'x-windy-api-key': apiKey
            }
        });

        if (!windyResponse.ok) {
            const errorReason = `Windy Webcams svarede ${windyResponse.status}`;
            console.warn('Live camera proxy response error:', errorReason);
            send(response, 200, JSON.stringify({
                meta: {
                    source: 'Windy Webcams',
                    disabled: true,
                    reason: errorReason
                },
                cameras: []
            }), { 'Content-Type': 'application/json; charset=utf-8' });
            return;
        }

        const payload = await windyResponse.json();
        const rawCameras = Array.isArray(payload)
            ? payload
            : Array.isArray(payload.webcams)
                ? payload.webcams
                : Array.isArray(payload.result && payload.result.webcams)
                    ? payload.result.webcams
                    : [];
        const cameras = rawCameras.map(normalizeWindyCamera).filter(Boolean).slice(0, limit);
        const body = JSON.stringify({
            meta: {
                source: 'Windy Webcams',
                generatedAt: new Date().toISOString(),
                count: cameras.length
            },
            cameras
        });

        liveCameraCache = {
            body,
            expiresAt: now + LIVE_CAMERA_CACHE_TTL_MS
        };

        send(response, 200, body, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Live-Camera-Data-Source': 'windy'
        });
    } catch (error) {
        console.error('Live camera proxy error:', error);
        send(response, 200, JSON.stringify({
            meta: {
                source: 'Windy Webcams',
                disabled: true,
                reason: `Kunne ikke hente ekstra live-kameraer: ${error.message}`
            },
            cameras: []
        }), { 'Content-Type': 'application/json; charset=utf-8' });
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

    if (request.url.startsWith('/api/wind')) {
        proxyWind(request, response);
        return;
    }

    if (request.url.startsWith('/api/live-cameras')) {
        proxyLiveCameras(request, response);
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

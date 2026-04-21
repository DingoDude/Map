const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 5600);
const ROOT = __dirname;
const OPEN_SKY_URL = 'https://opensky-network.org/api/states/all';
const ALLOWED_FLIGHT_PARAMS = new Set(['lamin', 'lomin', 'lamax', 'lomax']);

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

async function proxyFlights(request, response) {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const openSkyUrl = new URL(OPEN_SKY_URL);

    for (const [key, value] of requestUrl.searchParams) {
        if (ALLOWED_FLIGHT_PARAMS.has(key)) {
            openSkyUrl.searchParams.set(key, value);
        }
    }

    try {
        const openSkyResponse = await fetch(openSkyUrl);
        const body = await openSkyResponse.text();
        send(response, openSkyResponse.status, body, {
            'Content-Type': openSkyResponse.headers.get('content-type') || 'application/json; charset=utf-8'
        });
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

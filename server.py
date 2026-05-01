from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
import json
import time


PORT = 5600
ROOT = Path(__file__).resolve().parent
OPEN_SKY_URL = "https://opensky-network.org/api/states/all"
ALLOWED_FLIGHT_PARAMS = {"lamin", "lomin", "lamax", "lomax"}
FLIGHT_CACHE_TTL_SECONDS = 60
FLIGHT_ERROR_CACHE_TTL_SECONDS = 30
FLIGHT_RATE_LIMIT_TTL_SECONDS = 120

flight_cache = {}
open_sky_rate_limited_until = 0


def empty_flight_result(reason="rate-limited"):
    return {
        "status": 200,
        "body": json.dumps({"time": int(time.time()), "states": []}).encode("utf-8"),
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "X-Flight-Data-Source": reason,
        },
        "expires_at": time.time() + FLIGHT_ERROR_CACHE_TTL_SECONDS,
    }


def rate_limit_fallback(cached):
    if cached and cached.get("status") == 200 and cached.get("body"):
        headers = dict(cached.get("headers", {}))
        headers["X-Flight-Data-Source"] = "stale-cache"
        headers["X-OpenSky-Rate-Limited"] = "true"
        return {
            **cached,
            "headers": headers,
            "expires_at": time.time() + FLIGHT_ERROR_CACHE_TTL_SECONDS,
        }

    return empty_flight_result()


def build_open_sky_query(path):
    request_query = parse_qs(urlparse(path).query)
    params = {}

    for key in ALLOWED_FLIGHT_PARAMS:
        values = request_query.get(key)
        if not values:
            continue
        try:
            params[key] = f"{float(values[0]):.4f}"
        except ValueError:
            continue

    return urlencode(params)


class MapRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/flights"):
            self.proxy_flights()
            return

        if self.path == "/":
            self.path = "/map.html"
        super().do_GET()

    def proxy_flights(self):
        global open_sky_rate_limited_until

        query = build_open_sky_query(self.path)
        cache_key = query or "world"
        cached = flight_cache.get(cache_key)
        now = time.time()

        if cached and cached.get("expires_at", 0) > now:
            self.send_cached(cached)
            return

        if now < open_sky_rate_limited_until:
            fallback = rate_limit_fallback(cached)
            flight_cache[cache_key] = fallback
            self.send_cached(fallback)
            return

        url = f"{OPEN_SKY_URL}?{query}" if query else OPEN_SKY_URL
        request = Request(url, headers={"User-Agent": "SpaceEarthControlCenter/1.0"})

        try:
            with urlopen(request, timeout=12) as response:
                body = response.read()
                result = {
                    "status": response.status,
                    "body": body,
                    "headers": {
                        "Content-Type": response.headers.get("content-type", "application/json; charset=utf-8"),
                        "X-Flight-Data-Source": "opensky",
                    },
                    "expires_at": now + FLIGHT_CACHE_TTL_SECONDS,
                }
        except HTTPError as error:
            if error.code == 429:
                open_sky_rate_limited_until = time.time() + FLIGHT_RATE_LIMIT_TTL_SECONDS
                result = rate_limit_fallback(cached)
            else:
                result = {
                    "status": error.code,
                    "body": error.read() or json.dumps({"error": "OpenSky request failed."}).encode("utf-8"),
                    "headers": {"Content-Type": "application/json; charset=utf-8"},
                    "expires_at": now + FLIGHT_ERROR_CACHE_TTL_SECONDS,
                }
        except URLError as error:
            message = json.dumps({"error": f"Kunne ikke hente flydata fra OpenSky: {error.reason}"}).encode("utf-8")
            result = {
                "status": 502,
                "body": message,
                "headers": {"Content-Type": "application/json; charset=utf-8"},
                "expires_at": now + FLIGHT_ERROR_CACHE_TTL_SECONDS,
            }

        flight_cache[cache_key] = result
        self.send_cached(result)

    def send_cached(self, result):
        self.send_response(result["status"])
        for key, value in result.get("headers", {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(result["body"])


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), MapRequestHandler)
    print(f"Map server running at http://127.0.0.1:{PORT}/map.html")
    server.serve_forever()

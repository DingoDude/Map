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
AIRPORTS_SOURCE_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"
TLE_SOURCES = {
    "stations": [
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle",
        "https://retlector.eu/tle/stations",
    ],
    "active": [
        "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle",
        "https://retlector.eu/tle/active",
    ],
}
ALLOWED_FLIGHT_PARAMS = {"lamin", "lomin", "lamax", "lomax"}
FLIGHT_CACHE_TTL_SECONDS = 60
FLIGHT_ERROR_CACHE_TTL_SECONDS = 30
FLIGHT_RATE_LIMIT_TTL_SECONDS = 120
AIRPORT_CACHE_TTL_SECONDS = 24 * 60 * 60
TLE_CACHE_TTL_SECONDS = 60 * 60
TLE_CACHE_DIR = ROOT / ".cache"

flight_cache = {}
airport_cache = None
tle_cache = {}
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


def is_tle_body(body):
    text = body.decode("utf-8", errors="ignore") if isinstance(body, bytes) else str(body or "")
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return any(lines[i].startswith("1 ") and lines[i + 1].startswith("2 ") for i in range(len(lines) - 1))


def read_tle_disk_cache(source_name):
    path = TLE_CACHE_DIR / f"{source_name}.tle"
    try:
        body = path.read_bytes()
        return body if is_tle_body(body) else None
    except OSError:
        return None


def write_tle_disk_cache(source_name, body):
    try:
        TLE_CACHE_DIR.mkdir(exist_ok=True)
        (TLE_CACHE_DIR / f"{source_name}.tle").write_bytes(body)
    except OSError as error:
        print(f"Kunne ikke gemme TLE-cache: {error}")


def read_airport_disk_cache():
    try:
        body = (TLE_CACHE_DIR / "airports.csv").read_bytes()
        return body if b"ident,type,name" in body[:200] else None
    except OSError:
        return None


def write_airport_disk_cache(body):
    try:
        TLE_CACHE_DIR.mkdir(exist_ok=True)
        (TLE_CACHE_DIR / "airports.csv").write_bytes(body)
    except OSError as error:
        print(f"Kunne ikke gemme lufthavns-cache: {error}")


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
        if self.path.startswith("/api/airports"):
            self.proxy_airports()
            return
        if self.path.startswith("/api/tle"):
            self.proxy_tle()
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
                result = rate_limit_fallback(cached)
                result["headers"]["X-Flight-Data-Source"] = f"opensky-http-{error.code}"
        except URLError as error:
            result = rate_limit_fallback(cached)
            result["headers"]["X-Flight-Data-Source"] = "opensky-unavailable"

        flight_cache[cache_key] = result
        self.send_cached(result)

    def proxy_airports(self):
        global airport_cache

        now = time.time()
        if airport_cache and airport_cache.get("expires_at", 0) > now:
            self.send_cached(airport_cache)
            return

        request = Request(
            AIRPORTS_SOURCE_URL,
            headers={"User-Agent": "SpaceEarthControlCenter/1.0 (local map app)"},
        )

        try:
            with urlopen(request, timeout=15) as response:
                body = response.read()
            airport_cache = {
                "status": 200,
                "body": body,
                "headers": {
                    "Content-Type": "text/csv; charset=utf-8",
                    "X-Airport-Data-Source": "ourairports",
                },
                "expires_at": now + AIRPORT_CACHE_TTL_SECONDS,
            }
            write_airport_disk_cache(body)
            self.send_cached(airport_cache)
            return
        except (HTTPError, URLError, TimeoutError):
            disk_body = read_airport_disk_cache()
            if disk_body:
                airport_cache = {
                    "status": 200,
                    "body": disk_body,
                    "headers": {
                        "Content-Type": "text/csv; charset=utf-8",
                        "X-Airport-Data-Source": "disk-cache",
                        "X-Airport-Stale": "true",
                    },
                    "expires_at": now + FLIGHT_ERROR_CACHE_TTL_SECONDS,
                }
                self.send_cached(airport_cache)
                return

        self.send_response(502)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("Kunne ikke hente lufthavnsdata.".encode("utf-8"))

    def proxy_tle(self):
        source_name = "active" if urlparse(self.path).path.endswith("/active") else "stations"
        cached = tle_cache.get(source_name)
        now = time.time()

        if cached and cached.get("expires_at", 0) > now:
            self.send_cached(cached)
            return

        for url in TLE_SOURCES[source_name]:
            request = Request(
                url,
                headers={
                    "Accept": "text/plain,*/*",
                    "User-Agent": "SpaceEarthControlCenter/1.0 (local map app)",
                },
            )
            try:
                with urlopen(request, timeout=15) as response:
                    body = response.read()
                if not is_tle_body(body):
                    continue
                result = {
                    "status": 200,
                    "body": body,
                    "headers": {
                        "Content-Type": "text/plain; charset=utf-8",
                        "X-TLE-Data-Source": url,
                    },
                    "expires_at": now + TLE_CACHE_TTL_SECONDS,
                }
                tle_cache[source_name] = result
                write_tle_disk_cache(source_name, body)
                self.send_cached(result)
                return
            except (HTTPError, URLError, TimeoutError):
                continue

        disk_body = read_tle_disk_cache(source_name)
        if disk_body:
            result = {
                "status": 200,
                "body": disk_body,
                "headers": {
                    "Content-Type": "text/plain; charset=utf-8",
                    "X-TLE-Data-Source": "disk-cache",
                    "X-TLE-Stale": "true",
                },
                "expires_at": now + FLIGHT_ERROR_CACHE_TTL_SECONDS,
            }
            tle_cache[source_name] = result
            self.send_cached(result)
            return

        self.send_response(502)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        self.wfile.write("Kunne ikke hente TLE-data.".encode("utf-8"))

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

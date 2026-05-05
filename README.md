# Space & Earth Control Center

Lokal Cesium-baseret kort-app med satellitter, skibe, fly, lufthavne, jordskælv og enkle vejrzoner.

## Start

1. Installer Node.js 18 eller nyere.
2. Kopier `.env.example` til `.env`.
3. Udfyld dine nøgler:

```env
CESIUM_ION_TOKEN=...
AIS_API_KEY=...
WINDY_WEBCAMS_API_KEY=...
```

4. Start appen:

```bat
start-map.bat
```

Appen åbnes på:

```text
http://127.0.0.1:5600/map.html
```

## Konfiguration

API-nøgler skal ligge i `.env` eller som miljøvariabler. De er ikke længere hardcodet i `script.js` eller `js/config.js`.

Bemærk: AIS-streamen åbnes stadig fra browseren. Det betyder, at AIS-nøglen kan ses i browserens netværkstrafik, når laget bruges. For fuld hemmeligholdelse skal AIS flyttes bag en WebSocket-proxy på serveren.

## Datakilder

- Cesium Ion til globe/terrain
- AISStream til live skibstrafik
- OpenSky Network til flydata via lokal proxy
- OurAirports til lufthavnsdata via lokal proxy
- CelesTrak/Retlector til TLE-satellitdata via lokal proxy
- USGS til jordskælv
- Open-Meteo til live vindkort
- Windy Webcams til op til 200 ekstra live-kameraer via lokal proxy

## Lag

`Live kameraer` viser de indbyggede kameraer med det samme. Hvis `WINDY_WEBCAMS_API_KEY` er sat i `.env`, henter serveren desuden op til 200 ekstra kameraer fra Windy Webcams via `/api/live-cameras`.

`Live vindkort` henter aktuelle 10m-vinddata for det område, kameraet viser. Farverne viser vindstyrke i knob, og stregerne viser vindretning.

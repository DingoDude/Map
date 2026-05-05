# Space & Earth Control Center

Lokal Cesium-baseret kort-app med satellitter, skibe, fly, lufthavne, jordskælv og enkle vejrzoner.

## Start

1. Installer Node.js 18 eller nyere.
2. Kopier `.env.example` til `.env`.
3. Udfyld dine nøgler:

```env
CESIUM_ION_TOKEN=...
AIS_API_KEY=...
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

## Lag

`Vejrzoner` er statiske, brede vejrområder som jetstream- og stormspor-zoner. Det er ikke live vejrdata.

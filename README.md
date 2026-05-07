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

`Satellitter` viser ISS og Tiangong som live entities. Positionerne opdateres med TLE-baserede samples og korte lookahead-punkter, så Cesium kan interpolere bevægelsen glat mellem dataopdateringer.

`Alle satellitter` henter aktive TLE-data via den lokale proxy og opdaterer punkterne løbende i batches. Opdateringen er throttlet for at holde Cesium-renderingen stabil.

Bemærk: Satellitbaner/traces er midlertidigt slået fra. CesiumJS 1.116 kan crashe i `GeometryVisualizer.updateShows` med `Cannot read properties of undefined (reading 'id')`, når satellitbaner/traces som entity-polylines bliver vist, skjult eller fjernet tæt på samme render-frame. Satellitpositionerne virker stadig; det er kun de tegnede banespor, der er deaktiveret indtil trace-rendering flyttes til en mere stabil primitive-baseret løsning eller Cesium opgraderes.

`Live kameraer` viser de indbyggede kameraer med det samme. Hvis `WINDY_WEBCAMS_API_KEY` er sat i `.env`, henter serveren desuden op til 200 ekstra kameraer fra Windy Webcams via `/api/live-cameras`.

`Live vindkort` henter aktuelle 10m-vinddata for det område, kameraet viser. Farverne viser vindstyrke i knob, og stregerne viser vindretning.

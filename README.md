# Space & Earth Control Center

Lokal Cesium-baseret kort-app til at udforske rum, luft, hav og live data i et samlet 3D-kort.

## Hurtigt Overblik

Fede features:

- `Rumstationer`: ISS og Tiangong med live position, fakta og spor.
- `Alle satellitter`: tusindvis af TLE-baserede satellitter, kategorier som Starlink, OneWeb, navigation, jordobservation og mere.
- `Smooth bevægelse`: satellitter og fly glider mellem opdateringer i stedet for at hoppe.
- `Trace / spor`: vis bane for valgt satellit eller for synlige satellitter.
- `Flytrafik`: live fly med callsign, kurs, højde og fart.
- `Skibstrafik`: live AIS-skibe med kurs, fart og trail.
- `Live vindkort`: vindfelter med pile, hvor større pil betyder mere vind.
- `Lufthavne og live kameraer`: udvidede lufthavns-overlays, inkl. Vágar Airport (FAE/EKVG) på Færøerne, og live kameraer til geografisk orientering.
- `Tastatur-navigation`: pan med `W/A/S/D` og piletaster, zoom med `Q/E`, hurtigere med `Shift`.
- `Søgning og watchlist`: find objekter hurtigt og hold øje med bestemte navne eller callsigns.

## Hvad Appen Er

Appen er bygget som en lokal web-app:

- frontend i `map.html`, `script.js` og `style.css`
- lokal Node-server i `server.js`
- data proxied lokalt til browseren for TLE, fly, vind, lufthavne og live kameraer

Det giver en hurtig arbejdsgang, hvor du bare starter serveren lokalt og åbner kortet i browseren.

## Krav

- Windows
- Node.js 18 eller nyere

Der er også understøttelse for en lokal fallback-binary i:

```text
tools/node/node.exe
```

`start-map.bat` bruger automatisk systemets `node`, og falder tilbage til den lokale binary hvis den findes.

## Hurtig Start

1. Kopiér `.env.example` til `.env`
2. Udfyld de nøgler du har adgang til
3. Start appen

```bat
start-map.bat
```

Åbn derefter:

```text
http://127.0.0.1:5600/map.html
```

## Miljøvariabler

Eksempel:

```env
CESIUM_ION_TOKEN=...
AIS_API_KEY=...
WINDY_WEBCAMS_API_KEY=...
```

Forklaring:

- `CESIUM_ION_TOKEN`: bruges til Cesium/3D-klode.
- `AIS_API_KEY`: bruges til live skibstrafik.
- `WINDY_WEBCAMS_API_KEY`: giver ekstra live kameraer fra Windy.

API-nøgler kan ligge i `.env` eller som miljøvariabler.

## Sådan Bruger Du Kortet

### Navigation

- `W` / `Pil op`: nord
- `S` / `Pil ned`: syd
- `A` / `Pil venstre`: vest
- `D` / `Pil højre`: øst
- `Q`: zoom ind
- `E`: zoom ud
- `Shift`: hurtigere bevægelse
- mus: almindelig Cesium navigation med zoom, tilt og rotation

### Søgning

Du kan søge på fx:

- satellitnavne
- callsigns
- ICAO
- MMSI
- lufthavne
- havne
- live kameraer

### Watchlist

Watchlist gør det nemmere at fremhæve bestemte mål i kortet, fx:

- en bestemt satellit
- et flycallsign
- et skib

## Lag

### Rum og luft

- `Rumstationer`: ISS og Tiangong.
- `Alle satellitter`: alle aktive TLE-satellitter.
- `Starlink / OneWeb / Navigation / Vejr og jord / Øvrige`: underfiltre til satellitlaget.
- `Lufthavne`: udvidet lufthavnskatalog med store, mellemstore og zoom-afhængige små lufthavne. Vágar Airport (FAE/EKVG) på Færøerne er prioriteret, så den vises selv ved fallback-data.
- `Flytrafik`: live fly via OpenSky proxy.

### Vand

- `Civile havne`
- `Skibstrafik`
- `Militær flåde`

### Natur og lys

- `Jordskælv`
- `Live vindkort`
- `Dag/nat`

### Live video

- `Live kameraer`

## Satellitter Og Spor

Der er to forskellige satellitlag:

- `Rumstationer`: kun ISS og Tiangong
- `Alle satellitter`: TLE-baseret katalog over mange aktive satellitter

Baner/spor vises som ground tracks over den roterende Jord. Derfor vil et spor ofte ikke ende præcis samme sted, selv om satellitten har gennemført en hel omløbstid. Det er normalt for de fleste LEO-satellitter.

Sporene følger nu satellitternes bevægelse løbende i stedet for kun at være et statisk snapshot.

## Vindkort

Vindkortet henter aktuelle 10m-vinddata for det område, kameraet viser.

Det viser nu:

- farvede felter for styrke
- pile for retning
- større pile ved højere vind
- værdier i `m/s`

## Datakilder

- Cesium Ion
- CelesTrak / Retlector
- OpenSky Network
- AISStream
- OurAirports med lokal prioriteret fallback for udvalgte nordatlantiske og nordiske lufthavne
- Open-Meteo
- Windy Webcams
- USGS

## Lokal Server

`server.js` håndterer blandt andet:

- `/api/tle/stations`
- `/api/tle/active`
- `/api/flights`
- `/api/airports`
- `/api/wind`
- `/api/live-cameras`
- `/api/config.js`

Serveren cacher flere datakilder lokalt i hukommelsen og gemmer TLE-cache på disk i `.cache/`.

## Vigtige Bemærkninger

- Hvis du åbner `map.html` via en simpel statisk server uden `server.js`, vil flere lag fejle.
- `TLE`, `Lufthavne`, `Flytrafik`, `Vind` og ekstra `Live kameraer` kræver de lokale `/api/...` routes.
- AIS-forbindelsen åbnes stadig fra browseren. Det betyder, at AIS-nøglen kan være synlig i netværkstrafik. Hvis det skal skjules helt, bør AIS flyttes bag en server-side WebSocket-proxy.

## Fejlfinding

### TLE eller lufthavne viser fejl 404

Du kører sandsynligvis ikke appen gennem `server.js`.

Brug:

```bat
start-map.bat
```

### Port 5600 er optaget

Der kører sandsynligvis allerede en anden lokal server på porten. Luk den proces og start appen igen.

### Ingen live fly eller skibe

Tjek:

- at laget er slået til
- at API-nøgler er sat korrekt
- at `server.js` faktisk kører

### Vindkort opdaterer ikke

Tjek at:

- `Live vindkort` er slået til
- kortet kører via lokal server
- der er forbindelse til Open-Meteo via `/api/wind`

## Projektfiler

Vigtige filer:

- `map.html`: layout og UI
- `script.js`: hovedlogik for lag, rendering og interaktion
- `style.css`: styling
- `server.js`: lokal proxy/server
- `start-map.bat`: hurtig opstart på Windows

## Status

Projektet er bedst egnet som en lokal explorations-app og prototype til overvågning/visualisering. Fokus er på hurtig iteration, mange datalag og et levende 3D-overblik frem for hård enterprise-struktur.

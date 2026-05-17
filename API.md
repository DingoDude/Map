# API Documentation - Space & Earth Control Center

## Server Endpoints

### Lokale Proxy Endpoints (`http://localhost:5600`)

#### GET `/api/config.js`
Returnerer Cesium & AIS API-nøgler som JavaScript, injiceret i `window` objekt.

**Response:**
```javascript
window.CESIUM_ION_TOKEN = "token...";
window.AIS_API_KEY = "key...";
// ... flere config variabler
```

#### GET `/api/health`
Health check endpoint - viser status for alle eksterne API'er.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2026-05-15T12:34:56.789Z",
  "services": {
    "ais": { "ok": true, "latency": 145 },
    "flights": { "ok": true, "latency": 320 },
    "tle": { "ok": true, "latency": 890 },
    "wind": { "ok": true, "latency": 210 },
    "airports": { "ok": true, "latency": 45 }
  }
}
```

#### GET `/api/tle/stations`
Hent aktuelle TLE-data for rumstationer (ISS, Tiangong etc).

**Response:** TLE-format (Two-Line Element set)
```
ISS (ZARYA)
1 25544U 98067A   26135.23456789  .00016717  00000-0  29696-3 0  9990
2 25544  51.6423 340.1234 0005149 108.5679 251.5831 15.53797651391234
```

#### GET `/api/tle/active`
Hent alle aktive satellitter (Starlink, OneWeb, navigation osv).

**Response:** TLE-format (mange hunderede linjer)

#### GET `/api/flights?lamin=53&lomin=10&lamax=58&lomax=15`
Hent live flytrafik indenfor bounding box.

**Query Parameters:**
- `lamin`: Min latitude
- `lamax`: Max latitude
- `lomin`: Min longitude
- `lomax`: Max longitude

**Response:**
```json
{
  "aircraft": [
    {
      "icao": "4ca5d2",
      "callsign": "SAS123",
      "latitude": 55.5,
      "longitude": 12.5,
      "altitude": 8500,
      "velocity": 450,
      "heading": 180,
      "verticalRate": 50
    }
  ]
}
```

#### GET `/api/airports`
Hent liste af lufthavne (gecached i 24 timer).

**Response:**
```json
{
  "airports": [
    {
      "id": "EKCH",
      "name": "Copenhagen Airport",
      "latitude": 55.6161,
      "longitude": 12.6560,
      "type": "large_airport",
      "iso_country": "DK"
    }
  ]
}
```

#### GET `/api/wind?lat=55.5&lon=12.5`
Hent live vinddata.

**Query Parameters:**
- `lat`: Latitude center
- `lon`: Longitude center

**Response:**
```json
{
  "windData": [
    {
      "latitude": 55.5,
      "longitude": 12.5,
      "speed": 8.5,
      "direction": 270
    }
  ]
}
```

#### GET `/api/live-cameras`
Hent liste af live webcams.

**Response:**
```json
{
  "cameras": [
    {
      "id": "cam123",
      "name": "Nyhavn Live",
      "latitude": 55.6793,
      "longitude": 12.5880,
      "url": "https://...",
      "preview": "https://..."
    }
  ]
}
```

#### GET `/api/earthquakes`
Hent seneste jordskælv.

**Response:**
```json
{
  "earthquakes": [
    {
      "latitude": -20.5,
      "longitude": 169.5,
      "magnitude": 5.2,
      "depth": 15.5,
      "timestamp": "2026-05-15T12:30:00Z",
      "source": "USGS"
    }
  ]
}
```

---

## Browser API'er (Javascript)

### ErrorHandler
```javascript
import errorHandler from './js/error-handler.js';

// Log fejl med kontekst
errorHandler.handle(error, 'My Feature Name');

// Wrap async funktioner
const wrappedFn = errorHandler.wrapAsync(myAsyncFn, 'Feature Name');

// Lyt på fejl
errorHandler.onError((errorInfo) => {
  console.log('Error occurred:', errorInfo);
});

// Hent alle fejl
const errors = errorHandler.getErrors();
```

### StateManager
```javascript
import stateManager from './js/state-manager.js';

// Get state
const activeTab = stateManager.get('ui.activeTab');

// Set state (gemmes til localStorage)
stateManager.set('ui.activeTab', 'search');

// Watchlist management
stateManager.addToWatchlist({ name: 'SAS123', type: 'flight' });
stateManager.removeFromWatchlist('SAS123');

// Scene snapshots
const snapshot = stateManager.saveSnapshot('My Scene', camera, activeLayers);
stateManager.deleteSnapshot(snapshot.id);

// Subscribe to changes
const unsubscribe = stateManager.subscribe((key, value) => {
  console.log(`State changed: ${key}`, value);
});
```

### HelpDialog
```javascript
import helpDialog from './js/help-dialog.js';

helpDialog.initialize();
helpDialog.open();
helpDialog.close();
```

### DraggablePanels
```javascript
import { initDraggablePanels } from './js/draggable-panels.js';

initDraggablePanels(); // Gør alle paneler flytbare
```

---

## Data Flow

```
┌─────────────────────────────────────────────────────┐
│         Browser (Frontend)                          │
│  ┌────────────────────────────────────────────┐    │
│  │ Cesium 3D Viewer                           │    │
│  │ - Satellitter (TLE)                        │    │
│  │ - Flytrafik (OpenSky)                      │    │
│  │ - Skibstrafik (AIS WebSocket)              │    │
│  │ - Lufthavne (CSV)                          │    │
│  │ - Vind (Open-Meteo)                        │    │
│  │ - Live kameraer (Windy)                    │    │
│  │ - Jordskælv (USGS)                         │    │
│  └────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
           │                      │
           ├─ API Proxy ────┐     │
           │                │     │
           └────────────────┼─────┼──────────────────┐
                            │     │                  │
                     ┌──────┴┐    │                  │
                     │       │    │                  │
                ┌────▼─┬─────▼┬───▼──┬────────┐      │
                │      │      │      │        │      │
            Celestrak OpenSky  AIS  Open-    Windy   USGS
                           Meteo
```

---

## Error Handling

API'er kan fejle af forskellige årsager:

- **Rate limiting**: OpenSky har begrænsninger - serveren cacher svar
- **Timeout**: Hvis eksterne API'er er langsomme, bruges cached data
- **Network**: Hvis offline, bruges sidste cached version
- **Invalid data**: Fejl data logges men blokerer ikke UI

Fejlstatus vises i "Status" tab i UI-panelet.

---

## Environment Variables

Se `.env.example` for alle tilgængelige variabler.

Key variabler:
- `CESIUM_ION_TOKEN`: Cesium 3D viewer token
- `AIS_API_KEY`: AIS Streams API-nøgle
- `DEBUG`: Sæt til `true` for verbose logging
- `PORT`: Server port (default 5600)


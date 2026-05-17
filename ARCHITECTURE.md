# Architecture - Space & Earth Control Center

## System Overview

```
┌────────────────────────────────────────────────────────────┐
│                    BROWSER (Frontend)                      │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  map.html                                            │  │
│  │  ├─ Cesium 3D Globe                                 │  │
│  │  ├─ UI-panel (Layers, Search, Status)               │  │
│  │  └─ Detail panels (Satellite, Flight, Camera info)  │  │
│  └──────────────────────────────────────────────────────┘  │
│         ▲         ▲          ▲         ▲          ▲         │
│         │         │          │         │          │         │
│    script.js, style.css    Layer modules & JS utilities     │
└────────────────────────────────────────────────────────────┘
         │         │          │         │          │
         │         └──────────┼─────────┴──────────┘
         │                    │
         └────────────────────┼─────────────────────────┐
                              │                         │
                    ┌─────────▼──────────┐              │
                    │  Node.js Server    │              │
                    │  (Proxy/Cache)     │              │
                    │                    │              │
                    │  server.js         │              │
                    └─────────┬──────────┘              │
                              │                         │
        ┌─────────────────────┼────────────────────────┼─────────┐
        │                     │                        │         │
        ▼                     ▼                        ▼         ▼
   Celestrak             OpenSky              AIS Stream     Windy API
   (TLE Data)            (Flights)            (Ships)        (Weather & Webcams)
   
        ▲
        │
    USGS API
    (Earthquakes)
```

## Frontend Architecture

### Layer Structure

```
map.html (Main HTML file)
    │
    ├─ style.css (All styling)
    │
    ├─ Cesium Library (3D rendering)
    │   └─ Terrain, imagery, entities
    │
    ├─ satellite.js (Orbital calculations)
    │
    ├─ script.js (Main app logic) ⚠️ LARGE - should be modularized
    │   ├─ Initialize Cesium viewer
    │   ├─ Setup UI event handlers
    │   ├─ Layer management
    │   ├─ Search/watchlist
    │   └─ Camera control
    │
    └─ js/ (Modular features)
        ├─ config.js (Centralized configuration)
        ├─ error-handler.js (Global error handling)
        ├─ state-manager.js (localStorage persistence)
        ├─ help-dialog.js (Keyboard shortcuts UI)
        ├─ draggable-panels.js (Moveable UI panels)
        ├─ icons.js (Icon SVG definitions)
        ├─ viewer.js (Cesium viewer setup)
        │
        └─ layers/ (Feature layers)
            ├─ airports.js (Airport markers)
            ├─ earthquakes.js (USGS earthquake data)
            ├─ maritime.js (AIS ship tracking)
            ├─ satellites.js (ISS, Tiangong, etc)
            ├─ flights.js (Live aircraft)
            ├─ wind.js (Wind field visualization)
            └─ live-cameras.js (Webcam overlays)
```

### Data Flow - Layer Lifecycle

```
┌──────────────────────────┐
│  User toggles layer      │
│  (checkbox in UI)        │
└────────────┬─────────────┘
             │
             ▼
    ┌────────────────────────────┐
    │  Layer.initialize()        │
    │  - Create layer container  │
    │  - Setup event handlers    │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Layer.fetchData()         │
    │  - Call /api/... endpoint  │
    │  - Use cached if available │
    │  - Handle errors           │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Layer.processData()       │
    │  - Parse/transform data    │
    │  - Create Cesium entities  │
    │  - Add to viewer           │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Layer.update()            │
    │  - Periodic refresh        │
    │  - Handle real-time data   │
    │  - Smooth animations       │
    └────────────┬───────────────┘
                 │
                 ▼
    ┌────────────────────────────┐
    │  Layer.cleanup()           │
    │  - Remove entities         │
    │  - Clear references        │
    │  - Stop timers             │
    └────────────────────────────┘
```

## Backend Architecture (server.js)

### Request Flow

```
Browser Request
    │
    ▼
Express Router
    │
    ├─ GET /               → Serve map.html
    ├─ GET /api/config.js  → Inject secrets into window
    ├─ GET /api/health     → Service status check
    ├─ GET /api/tle/*      → Fetch & cache TLE data
    ├─ GET /api/flights    → Proxy OpenSky API
    ├─ GET /api/airports   → Serve cached airport CSV
    ├─ GET /api/wind       → Call Open-Meteo API
    ├─ GET /api/earthquakes → Call USGS API
    └─ GET /api/live-cameras → Call Windy API
                 │
                 ▼
    ┌─────────────────────────────┐
    │  Cache Layer                │
    │  - Check if cached          │
    │  - Validate TTL             │
    │  - Return or fetch new      │
    └─────────────────────────────┘
                 │
                 ▼
    ┌─────────────────────────────┐
    │  Rate Limiting              │
    │  - Track requests           │
    │  - Backoff on limits        │
    │  - Queue requests           │
    └─────────────────────────────┘
                 │
                 ▼
    ┌─────────────────────────────┐
    │  External API Call          │
    │  - Add timeout              │
    │  - Parse response           │
    │  - Transform format         │
    └─────────────────────────────┘
                 │
                 ▼
    ┌─────────────────────────────┐
    │  Cache Result               │
    │  - Store in memory          │
    │  - Set TTL timer            │
    │  - Return to client         │
    └─────────────────────────────┘
                 │
                 ▼
         Response to Browser
```

### Caching Strategy

```
Request comes in
    │
    ├─ Is cache valid?
    │  ├─ YES → Return cached
    │  └─ NO  → Fetch new
    │
    ├─ Fetch from external API
    │  ├─ Success → Cache & return
    │  └─ Fail    → Return last cache OR error
    │
    └─ Handle rate limits
       └─ Return 429 with retry-after
```

## State Management

### localStorage Schema

```
space-control-layers.satellites: boolean
space-control-layers.flights: boolean
space-control-watchlist: Array<{name, type, mmsi?}>
space-control-cameraPosition: {lng, lat, height}
space-control-ui.activeTab: string
space-control-ui.panelPosX: number
space-control-ui.panelPosY: number
space-control-snapshots: Array<Snapshot>
space-control-filters: {minSpeed, altitude, etc}
```

### State Update Flow

```
User Action (toggle layer, change filter, etc)
    │
    ▼
Event Handler (script.js or layer module)
    │
    ▼
stateManager.set(key, value)
    │
    ├─ Update in-memory state
    ├─ Save to localStorage
    └─ Notify subscribers
        │
        ├─ Update UI
        ├─ Trigger layer refresh
        └─ Update display
```

## Error Handling Flow

```
Error Occurs (JavaScript, Promise, API call)
    │
    ▼
Global Error Listener
    │
    ├─ Catch & log
    ├─ Create errorInfo object
    ├─ Store in errorHandler.errors[]
    └─ Notify subscribers
        │
        ├─ Display in error box
        ├─ Log to console (if DEBUG=true)
        └─ Send to error webhook (if configured)
        
User can:
    ├─ See error details
    ├─ Clear error box
    └─ Access error report via Debug mode
```

## Performance Optimization

### Strategies Used

1. **Lazy Loading**
   - Layers only fetch data when toggled on
   - Heavy calculations deferred until needed

2. **Caching**
   - Server-side: Endpoints cache for TTL (1 min to 24 hrs)
   - Client-side: Browser cache + localStorage for UI state
   - Memory: Keep max N entities in memory

3. **Debouncing**
   - Camera movement: 2000ms
   - Search input: 180ms
   - Label refresh: 150ms

4. **Async Operations**
   - API calls don't block UI
   - Entities rendered in batches
   - Web Workers for heavy math

5. **Animation**
   - Smooth interpolation between updates
   - 33ms frame time target (60 FPS)
   - Reduced quality when many entities visible

### Targets

- First load: < 3 seconds
- Layer toggle: < 100ms response
- Search: < 200ms
- 60 FPS camera movement
- Memory: < 200MB base

## Security Considerations

### Secrets Management
- API keys stored in `.env` (never committed)
- Injected into browser via `/api/config.js`
- Server validates and proxies all external API calls

### CORS
- Server acts as proxy to avoid CORS issues
- All external API calls go through localhost:5600

### Input Validation
- Search inputs sanitized
- Lat/lon bounds validated
- API parameters whitelisted

### Rate Limiting
- Server implements rate limiting
- Requests queued if limit hit
- Client-side backoff on 429 responses

## Monitoring & Debugging

### DEBUG Mode
Set `DEBUG=true` in `.env` to enable:
- API call logging
- Cache operation logging
- Performance metrics
- Extended error details

### Health Check
`GET /api/health` returns:
- Status of all data sources
- Latency per endpoint
- Cache hit rate
- Error count

### Browser DevTools
- Network tab: Monitor API calls
- Console: See logs and errors
- Performance: Measure rendering time
- Storage: View localStorage state

---

## Future Improvements

1. **Modularize script.js**
   - Split into feature modules
   - Reduce main file from ~5000 lines to ~500

2. **Add WebWorkers**
   - Orbital calculations
   - Trail rendering
   - TLE parsing

3. **Implement Real-time WebSocket**
   - Live satellite updates
   - Persistent server connection
   - Reduce polling overhead

4. **Add Testing**
   - Unit tests with Jest
   - Integration tests
   - E2E tests with Playwright

5. **Performance Monitoring**
   - Send metrics to backend
   - Track performance trends
   - Alert on regressions


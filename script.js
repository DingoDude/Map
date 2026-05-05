const CesiumLib = window.Cesium;
const SatelliteLib = window.satellite;
Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN || '';
const AIS_API_KEY = window.AIS_API_KEY || '';
const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const AIS_RECONNECT_MS = 10000;
const AIS_SUBSCRIPTION_DEBOUNCE_MS = 600;
const AIS_MIN_SUBSCRIPTION_GAP_MS = 1500;
const AIS_VIEW_PADDING_DEGREES = 3;
const AIS_MAX_LAT_SPAN_DEGREES = 45;
const AIS_MAX_LON_SPAN_DEGREES = 75;
const AIS_STALE_MS = 10 * 60 * 1000;
const AIS_CACHE_KEY = 'space-control-live-ais-ships-v1';
const AIS_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const AIS_CACHE_WRITE_DEBOUNCE_MS = 2500;
const AIS_CACHE_MAX_SHIPS = 700;
const AIS_MAX_LIVE_SHIPS = 900;
const AIS_LABEL_REFRESH_DEBOUNCE_MS = 150;
const LOCAL_PROXY_ORIGIN = 'http://127.0.0.1:5600';
const PERSIAN_GULF_VIEW = Cesium.Rectangle.fromDegrees(35.0, 20.0, 60.0, 34.0);
const FLIGHT_UPDATE_INTERVAL_MS = 60000;
const FLIGHT_STALE_MS = 180000;
const FLIGHT_MAX_RESULTS = 160;
const FLIGHT_VIEW_PADDING_DEGREES = 1.5;
const FLIGHT_MIN_SCOPE_DEGREES = 1.0;
const FLIGHT_TRAIL_SECONDS = 180;
const FLIGHT_SCOPE_GRID_DEGREES = 0.5;
const FLIGHT_CAMERA_DEBOUNCE_MS = 2000;
const FLIGHT_MIN_REQUEST_GAP_MS = 30000;
const FLIGHT_RATE_LIMIT_BACKOFF_MS = 120000;
const FLIGHT_GREEN_ALTITUDE_M = 10000;
const FLIGHT_BLUE_ALTITUDE_M = 15000;
const AIRPORT_MAX_RESULTS = 1000;
const AIRPORT_TYPE_RANK = {
    large_airport: 0,
    medium_airport: 1,
    small_airport: 2
};
const ALWAYS_SHOW_BILLBOARD_DISTANCE = Number.POSITIVE_INFINITY;
const SHIP_LABEL_MAX_DISTANCE_M = 1800000;
const SHIP_LABEL_MAX_LENGTH = 20;
const SHIP_LABEL_CHAR_WIDTH_PX = 6.4;
const SHIP_LABEL_HEIGHT_PX = 16;
const SHIP_LABEL_PADDING_PX = 5;
const SHIP_ICON_COLLISION_PX = 18;
const SHIP_TRAIL_MAX_POINTS = 24;
const SHIP_TRAIL_MIN_DISTANCE_M = 60;
const SHIP_TRAIL_RESET_AFTER_MS = 4 * 60 * 1000;
const SHIP_TRAIL_MAX_JUMP_M = 25000;
const SHIP_TRAIL_MAX_REASONABLE_SPEED_KN = 80;
const SHIP_SEARCH_FOCUS_HEIGHT_M = 35000;
const UI_INPUT_DEBOUNCE_MS = 180;
const ALTITUDE_DISPLAY_UPDATE_MS = 250;
const WATCHLIST_KEY = 'space-control-watchlist-v1';
const AIRPORT_LABEL_NEAR_DISTANCE_M = 900000;
const AIRPORT_MEDIUM_MAX_CAMERA_HEIGHT_M = 3500000;
const PORT_MAX_CAMERA_HEIGHT_M = 5200000;
const ALL_SATELLITES_TLE_URL = '/api/tle/active';
const ALL_SATELLITES_UPDATE_INTERVAL_MS = 30000;
const ALL_SATELLITES_BATCH_SIZE = 250;
const ALL_SATELLITES_POINT_SIZE = 5;
const SATELLITE_FULL_ORBIT_SAMPLE_COUNT = 180;
const SATELLITE_FULL_ORBIT_MIN_STEP_MINUTES = 0.5;
const SATELLITE_FULL_ORBIT_MAX_STEP_MINUTES = 8;
const SATELLITE_FALLBACK_ORBIT_PERIOD_MINUTES = 93;
const ALL_SATELLITE_TRACE_WIDTH = 2;
const ALL_SATELLITE_TRACE_ALL_LIMIT = 180;
const ALL_SATELLITE_CATEGORY_TOGGLES = {
    starlink: 'toggle-sat-starlink',
    oneweb: 'toggle-sat-oneweb',
    navigation: 'toggle-sat-navigation',
    earth: 'toggle-sat-earth',
    other: 'toggle-sat-other'
};
const ALL_SATELLITE_CATEGORY_LABELS = {
    starlink: 'Starlink',
    oneweb: 'OneWeb',
    navigation: 'Navigation',
    earth: 'Vejr og jord',
    other: 'Øvrige satellitter'
};
const ALL_SATELLITE_TYPE_LABELS = {
    starlink: 'Starlink',
    oneweb: 'OneWeb',
    navigation: 'Navigation',
    weather: 'Vejr',
    earthObservation: 'Jordobservation',
    communications: 'Kommunikation',
    crewed: 'Stationer/bemandet',
    science: 'Forskning',
    other: 'Øvrig'
};

// 2. INITIALISÉR VIEWERS (Rettet version uden createWorldTerrain-fejl)
function createBaseLayer() {
    return Cesium.ImageryLayer.fromProviderAsync(
        Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        )
    );
}

const viewer = new Cesium.Viewer('cesiumContainer', {
    baseLayer: createBaseLayer(),
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    selectionIndicator: false,
    shouldAnimate: true
});

viewer.scene.globe.depthTestAgainstTerrain = false;

viewer.camera.setView({
    destination: PERSIAN_GULF_VIEW
});

// Lister til styring af lag (Layers)
const satelliteEntities = [];
const quakeEntities = [];
const shipEntities = [];
const airportEntities = [];
const militaryEntities = [];
const weatherEntities = [];
const liveShipEntities = new Map();
const planeEntities = new Map();
const searchableItems = [];
const searchableByKey = new Map();
let watchlist = [];
let selectedDetailItem = null;

// Konfiguration af satellitter
const satellites = {
    iss: { 
        id: '25544', 
        name: 'ISS (International)', 
        color: CesiumLib.Color.RED, 
        source: 'api',
        tleName: 'ISS (ZARYA)',
        orbitPeriodMinutes: 93,
        facts: [
            'ISS er cirka på størrelse med en fodboldbane.',
            'Den har typisk 7 astronauter ombord.',
            'Den ser omkring 16 solopgange i døgnet.'
        ],
        posProperty: new CesiumLib.SampledPositionProperty(),
        sampleCount: 0,
        telemetry: null,
        entity: null 
    },
    tiangong: { 
        id: '48274', 
        name: 'Tiangong (Kina)', 
        color: CesiumLib.Color.CYAN, 
        source: 'tle',
        tleName: 'CSS (TIANHE)',
        orbitPeriodMinutes: 92,
        facts: [
            'Tiangong betyder "Himmelsk Palads".',
            'Rumstationen består af modulerne Tianhe, Wentian og Mengtian.',
            'Den kredser lavt om Jorden, ligesom ISS.'
        ],
        posProperty: new CesiumLib.SampledPositionProperty(),
        sampleCount: 0,
        telemetry: null,
        entity: null 
    }
};

const TLE_SOURCE_URL = '/api/tle/stations';
const tleCache = {};
const tleFallback = {
    'CSS (TIANHE)': {
        line1: '1 48274U 21035A   26106.12836677  .00016257  00000+0  18121-3 0  9997',
        line2: '2 48274  41.4686 340.0449 0005797 217.8333 142.2100 15.62435361283464'
    }
};

function hasFiniteNumbers(...values) {
    return values.every(value => Number.isFinite(Number(value)));
}

function hasValidCartesian(position) {
    return position && hasFiniteNumbers(position.x, position.y, position.z);
}

function isLayerChecked(id) {
    const element = document.getElementById(id);
    return !element || element.checked;
}

function getInputValue(id) {
    const element = document.getElementById(id);
    return element ? element.value.trim() : '';
}

function normalizeSearchText(value) {
    return String(value || '').toLowerCase();
}

function entityMatchesWatch(text) {
    const haystack = normalizeSearchText(text);
    return watchlist.some(item => item && haystack.includes(normalizeSearchText(item)));
}

function registerSearchItem(type, label, entity, keywords = '', details = '', key = `${type}:${label}`) {
    const item = {
        type,
        label,
        entity,
        keywords: normalizeSearchText(`${label} ${keywords}`),
        details: typeof details === 'string' ? details : ''
    };

    if (searchableByKey.has(key)) {
        Object.assign(searchableByKey.get(key), item);
        return;
    }

    searchableByKey.set(key, item);
    searchableItems.push(item);
}

function unregisterSearchItem(key) {
    const item = searchableByKey.get(key);
    if (!item) return;

    searchableByKey.delete(key);
    const index = searchableItems.indexOf(item);
    if (index >= 0) {
        searchableItems.splice(index, 1);
    }
}

function getItemEntity(item) {
    return item && (item.entity || item);
}

function itemPassesFilters(item) {
    const entity = getItemEntity(item);
    if (!entity) return false;
    if (entity.filterVisible === false) return false;
    if (entity.zoomVisible === false) return false;
    return true;
}

function getEntityPosition(entity) {
    if (!entity || !entity.position) return null;

    if (typeof entity.position.getValue === 'function') {
        return entity.position.getValue(viewer.clock.currentTime);
    }

    return entity.position;
}

function isEntityOnVisibleSide(entity, occluder) {
    const position = getEntityPosition(entity);
    return hasValidCartesian(position) && occluder.isPointVisible(position);
}

function setScopedEntityVisibility(entities, visible, occluder) {
    entities.forEach(item => {
        const entity = item.entity || item;
        entity.show = visible && itemPassesFilters(item) && isEntityOnVisibleSide(entity, occluder);
    });
}

function applyVisibleSideScope() {
    const occluder = new CesiumLib.EllipsoidalOccluder(
        viewer.scene.globe.ellipsoid,
        viewer.camera.positionWC
    );

    setScopedEntityVisibility(satelliteEntities, isLayerChecked('toggle-sat'), occluder);
    setScopedEntityVisibility(quakeEntities, isLayerChecked('toggle-quakes'), occluder);
    setScopedEntityVisibility(shipEntities, isLayerChecked('toggle-ships'), occluder);
    setScopedEntityVisibility(airportEntities, isLayerChecked('toggle-airports'), occluder);
    setScopedEntityVisibility(liveShipEntities, isLayerChecked('toggle-ship-traffic'), occluder);
    setScopedEntityVisibility(planeEntities, isLayerChecked('toggle-planes'), occluder);
    setScopedEntityVisibility(militaryEntities, isLayerChecked('toggle-military'), occluder);
}

function refreshVisibleSideScope() {
    updateZoomPriority();
    applyFilters();
    applyVisibleSideScope();
    setWeatherVisible(isLayerChecked('toggle-weather'));
    setShipTrailsVisible(isLayerChecked('toggle-ship-trails'));
    updateTrackedSatelliteTraceVisibility();
    declutterLiveShipLabels();
    updateWatchlistHighlights();
    updateSatelliteControlPanel();
}

function scheduleShipLabelRefresh() {
    window.clearTimeout(shipLabelRefreshTimer);
    shipLabelRefreshTimer = window.setTimeout(refreshVisibleSideScope, AIS_LABEL_REFRESH_DEBOUNCE_MS);
}

function createPlaneIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.translate(24, 24);
    ctx.fillStyle = '#f6c400';
    ctx.strokeStyle = '#6d5700';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(5, -4);
    ctx.lineTo(20, 3);
    ctx.lineTo(20, 8);
    ctx.lineTo(4, 5);
    ctx.lineTo(4, 16);
    ctx.lineTo(10, 20);
    ctx.lineTo(10, 23);
    ctx.lineTo(0, 18);
    ctx.lineTo(-10, 23);
    ctx.lineTo(-10, 20);
    ctx.lineTo(-4, 16);
    ctx.lineTo(-4, 5);
    ctx.lineTo(-20, 8);
    ctx.lineTo(-20, 3);
    ctx.lineTo(-5, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return canvas.toDataURL();
}

const PLANE_ICON = createPlaneIcon();

function createShipIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 72;
    canvas.height = 72;
    const ctx = canvas.getContext('2d');
    ctx.translate(36, 36);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = '#d8f5ff';
    ctx.strokeStyle = '#5f3718';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -25);
    ctx.lineTo(0, 10);
    ctx.stroke();

    ctx.fillStyle = '#f7efe0';
    ctx.beginPath();
    ctx.moveTo(2, -22);
    ctx.lineTo(20, 1);
    ctx.lineTo(2, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff7e8';
    ctx.beginPath();
    ctx.moveTo(-2, -18);
    ctx.lineTo(-18, 4);
    ctx.lineTo(-2, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#8b4f24';
    ctx.strokeStyle = '#4b2a13';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-25, 10);
    ctx.quadraticCurveTo(0, 25, 25, 10);
    ctx.lineTo(16, 20);
    ctx.quadraticCurveTo(0, 29, -16, 20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#f3d6a0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 17);
    ctx.lineTo(14, 17);
    ctx.stroke();

    return canvas.toDataURL();
}

const SHIP_ICON = createShipIcon();

function createAirportIcon() {
    const canvas = document.createElement('canvas');
    canvas.width = 44;
    canvas.height = 44;
    const ctx = canvas.getContext('2d');
    ctx.translate(22, 22);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.fillStyle = 'rgba(8, 16, 22, 0.78)';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#00ffcc';
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(4, -2);
    ctx.lineTo(15, 3);
    ctx.lineTo(15, 7);
    ctx.lineTo(3, 5);
    ctx.lineTo(3, 12);
    ctx.lineTo(8, 15);
    ctx.lineTo(8, 18);
    ctx.lineTo(0, 14);
    ctx.lineTo(-8, 18);
    ctx.lineTo(-8, 15);
    ctx.lineTo(-3, 12);
    ctx.lineTo(-3, 5);
    ctx.lineTo(-15, 7);
    ctx.lineTo(-15, 3);
    ctx.lineTo(-4, -2);
    ctx.closePath();
    ctx.fill();

    return canvas.toDataURL();
}

const AIRPORT_ICON = createAirportIcon();

let selectedSatelliteKey = null;
let isUpdatingFlights = false;
let lastFlightRequestAt = 0;
let flightRateLimitedUntil = 0;
let pendingFlightTimer = null;
let lastFlightScopeKey = '';
let aisSocket = null;
let aisReconnectTimer = null;
let aisSubscriptionTimer = null;
let aisLastSubscriptionAt = 0;
let aisLastScopeKey = '';
let aisCacheWriteTimer = null;
let shipLabelRefreshTimer = null;
let lastAltitudeDisplayUpdateAt = 0;
let lastAltitudeDisplayText = '';
let allSatellitePointCollection = null;
let allSatelliteRecords = [];
let allSatelliteTraceEntity = null;
let allVisibleSatelliteTraceEntities = [];
let selectedAllSatelliteRecord = null;
let selectedTrackedSatelliteOrbitEntity = null;
let visibleTrackedSatelliteOrbitEntities = new Map();
let visibleTrackedSatelliteOrbitRefreshId = 0;
let selectedTrackedSatelliteOrbitRequestId = 0;
let isLoadingAllSatellites = false;
let allSatellitesUpdateTimer = null;
const shipStaticByMmsi = new Map();

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function debounce(fn, delayMs) {
    let timer = null;
    return (...args) => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => fn(...args), delayMs);
    };
}

function addOptionalEventListener(id, eventName, handler) {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener(eventName, handler);
    }
    return element;
}

function clearElement(element) {
    if (element) {
        element.replaceChildren();
    }
}

function snapDown(value, step) {
    return Math.floor(value / step) * step;
}

function snapUp(value, step) {
    return Math.ceil(value / step) * step;
}

function getFlightScopeQueries() {
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);

    if (!rectangle) {
        return [''];
    }

    let west = CesiumLib.Math.toDegrees(rectangle.west) - FLIGHT_VIEW_PADDING_DEGREES;
    let east = CesiumLib.Math.toDegrees(rectangle.east) + FLIGHT_VIEW_PADDING_DEGREES;
    let south = CesiumLib.Math.toDegrees(rectangle.south) - FLIGHT_VIEW_PADDING_DEGREES;
    let north = CesiumLib.Math.toDegrees(rectangle.north) + FLIGHT_VIEW_PADDING_DEGREES;

    south = clamp(snapDown(south, FLIGHT_SCOPE_GRID_DEGREES), -90, 90);
    north = clamp(snapUp(north, FLIGHT_SCOPE_GRID_DEGREES), -90, 90);

    if (north - south < FLIGHT_MIN_SCOPE_DEGREES) {
        const midLat = (north + south) / 2;
        south = clamp(midLat - FLIGHT_MIN_SCOPE_DEGREES / 2, -90, 90);
        north = clamp(midLat + FLIGHT_MIN_SCOPE_DEGREES / 2, -90, 90);
    }

    let width = east - west;
    if (width < 0) width += 360;

    if (width >= 359) {
        return [''];
    }

    if (width < FLIGHT_MIN_SCOPE_DEGREES) {
        const midLon = west + width / 2;
        west = midLon - FLIGHT_MIN_SCOPE_DEGREES / 2;
        east = midLon + FLIGHT_MIN_SCOPE_DEGREES / 2;
    }

    west = snapDown(west, FLIGHT_SCOPE_GRID_DEGREES);
    east = snapUp(east, FLIGHT_SCOPE_GRID_DEGREES);
    west = CesiumLib.Math.negativePiToPi(CesiumLib.Math.toRadians(west));
    east = CesiumLib.Math.negativePiToPi(CesiumLib.Math.toRadians(east));
    west = CesiumLib.Math.toDegrees(west);
    east = CesiumLib.Math.toDegrees(east);

    const makeQuery = (lomin, lomax) => new URLSearchParams({
        lamin: south.toFixed(4),
        lomin: lomin.toFixed(4),
        lamax: north.toFixed(4),
        lomax: lomax.toFixed(4)
    }).toString();

    if (west <= east) {
        return [makeQuery(west, east)];
    }

    return [
        makeQuery(west, 180),
        makeQuery(-180, east)
    ];
}

function buildFlightDataUrls() {
    const queries = getFlightScopeQueries();
    const localOrigin = window.location.port === '5600' ? '' : LOCAL_PROXY_ORIGIN;
    return queries.map(query => `${localOrigin}/api/flights${query ? `?${query}` : ''}`);
}

function scheduleFlightUpdate(delayMs = FLIGHT_CAMERA_DEBOUNCE_MS) {
    window.clearTimeout(pendingFlightTimer);
    pendingFlightTimer = window.setTimeout(() => {
        updateFlights();
    }, delayMs);
}

function limitAisSpan(south, west, north, east) {
    const latSpan = north - south;
    const lonSpan = east - west;
    const midLat = (south + north) / 2;
    const midLon = (west + east) / 2;
    const limitedLatSpan = Math.min(latSpan, AIS_MAX_LAT_SPAN_DEGREES);
    const limitedLonSpan = Math.min(lonSpan, AIS_MAX_LON_SPAN_DEGREES);

    return {
        south: clamp(midLat - limitedLatSpan / 2, -90, 90),
        west: clamp(midLon - limitedLonSpan / 2, -180, 180),
        north: clamp(midLat + limitedLatSpan / 2, -90, 90),
        east: clamp(midLon + limitedLonSpan / 2, -180, 180)
    };
}

function getAisBoundingBoxes() {
    const rectangle = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);

    if (!rectangle) {
        return [[[-90, -180], [90, 180]]];
    }

    let west = CesiumLib.Math.toDegrees(rectangle.west) - AIS_VIEW_PADDING_DEGREES;
    let east = CesiumLib.Math.toDegrees(rectangle.east) + AIS_VIEW_PADDING_DEGREES;
    let south = clamp(CesiumLib.Math.toDegrees(rectangle.south) - AIS_VIEW_PADDING_DEGREES, -90, 90);
    let north = clamp(CesiumLib.Math.toDegrees(rectangle.north) + AIS_VIEW_PADDING_DEGREES, -90, 90);

    let width = east - west;
    if (width < 0) width += 360;
    if (width >= 359) {
        const center = viewer.camera.positionCartographic;
        const centerLat = CesiumLib.Math.toDegrees(center.latitude);
        const centerLon = CesiumLib.Math.toDegrees(center.longitude);
        const limited = limitAisSpan(
            centerLat - AIS_MAX_LAT_SPAN_DEGREES / 2,
            centerLon - AIS_MAX_LON_SPAN_DEGREES / 2,
            centerLat + AIS_MAX_LAT_SPAN_DEGREES / 2,
            centerLon + AIS_MAX_LON_SPAN_DEGREES / 2
        );
        return [[[limited.south, limited.west], [limited.north, limited.east]]];
    }

    if (width > AIS_MAX_LON_SPAN_DEGREES || north - south > AIS_MAX_LAT_SPAN_DEGREES) {
        const midLon = west + width / 2;
        const limited = limitAisSpan(south, midLon - width / 2, north, midLon + width / 2);
        west = limited.west;
        east = limited.east;
        south = limited.south;
        north = limited.north;
    }

    west = CesiumLib.Math.toDegrees(CesiumLib.Math.negativePiToPi(CesiumLib.Math.toRadians(west)));
    east = CesiumLib.Math.toDegrees(CesiumLib.Math.negativePiToPi(CesiumLib.Math.toRadians(east)));

    if (west <= east) {
        return [[[south, west], [north, east]]];
    }

    return [
        [[south, west], [north, 180]],
        [[south, -180], [north, east]]
    ];
}

function getAisScopeKey() {
    return JSON.stringify(getAisBoundingBoxes().map(box => box.map(point => point.map(value => Number(value).toFixed(2)))));
}

async function fetchFlightData() {
    const urls = [...new Set(buildFlightDataUrls())];
    const mergedStates = [];
    let hasSuccessfulResponse = false;
    let lastFailure = null;

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn('Kunne ikke hente flydata:', response.status, response.statusText, url);
                lastFailure = new Error(`${response.status} ${response.statusText}`);
                lastFailure.rateLimited = response.status === 429;
                continue;
            }
            const data = await response.json();
            hasSuccessfulResponse = true;
            if (Array.isArray(data.states)) {
                mergedStates.push(...data.states);
            }
        } catch (e) {
            console.warn('Flydata-kilde fejlede:', url, e);
            lastFailure = e;
        }
    }

    if (hasSuccessfulResponse) {
        return { states: mergedStates };
    }

    throw lastFailure || new Error('Ingen flydata-kilder svarede. Start proxyen med: node server.js');
}

function addSatelliteSample(sat, time, position, telemetry) {
    if (!hasValidCartesian(position)) {
        console.warn('Springer ugyldig Cesium-position over:', sat.name, position);
        return;
    }

    sat.posProperty.addSample(time, position);
    sat.sampleCount += 1;
    sat.telemetry = telemetry;

    if (sat.entity) {
        sat.entity.show = true;
        sat.entity.satelliteTraceReady = sat.sampleCount >= 3;
        sat.entity.path.show = false;
    }

    if (selectedSatelliteKey && satellites[selectedSatelliteKey] === sat) {
        updateSatelliteInfoPanel(selectedSatelliteKey);
        showTrackedSatelliteOrbit(selectedSatelliteKey);
    }

    if (isVisibleSatelliteTraceEnabled()) {
        refreshVisibleTrackedSatelliteOrbits();
    }
}

async function loadTLEData() {
    try {
        setDataStatus('status-tle', 'warn', 'Henter');
        const res = await fetch(TLE_SOURCE_URL);
        if (!res.ok) {
            setDataStatus('status-tle', 'error', `Fejl ${res.status}`);
            console.warn('Kunne ikke hente TLE-data:', res.status, res.statusText);
            return;
        }
        const text = await res.text();
        const lines = text.split(/\r?\n/).map(l => l.trim());
        for (let i = 0; i + 2 < lines.length; i += 3) {
            const name = lines[i];
            const line1 = lines[i + 1];
            const line2 = lines[i + 2];
            if (name && line1 && line2) {
                tleCache[name.toUpperCase()] = { line1, line2 };
            }
        }
        setDataStatus('status-tle', 'ok', `${Object.keys(tleCache).length} TLE`);
    } catch (e) {
        setDataStatus('status-tle', 'error', 'Fejl');
        console.error('Fejl ved indlæsning af TLE-data:', e);
    }
}

function parseTleRecords(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const records = [];

    for (let i = 0; i + 2 < lines.length; i += 3) {
        const name = lines[i];
        const line1 = lines[i + 1];
        const line2 = lines[i + 2];
        if (name && line1 && line2 && line1.startsWith('1 ') && line2.startsWith('2 ')) {
            records.push({ name, line1, line2 });
        }
    }

    return records;
}

function getSatelliteGmst(date) {
    if (typeof SatelliteLib.gstimeFromDate === 'function') {
        return SatelliteLib.gstimeFromDate(date);
    }

    return SatelliteLib.gstime(date);
}

function findTLE(key) {
    const sat = satellites[key];
    if (!sat || !sat.tleName) return null;
    const query = sat.tleName.toUpperCase();
    if (tleFallback[query]) {
        return tleFallback[query];
    }

    for (const name in tleCache) {
        if (name.includes(query)) {
            return tleCache[name];
        }
    }
    return null;
}

function setAllSatellitesVisible(visible) {
    if (allSatellitePointCollection) {
        allSatellitePointCollection.show = visible;
    }

    if (visible && allSatelliteRecords.length === 0) {
        loadAllSatellitesLayer();
    }

    updateAllSatelliteCategoryVisibility();
    updateSatelliteControlPanel();
}

function getAllSatelliteCategory(record) {
    const name = normalizeSearchText(record.name);
    if (name.includes('starlink')) return 'starlink';
    if (name.includes('oneweb')) return 'oneweb';
    if (
        name.includes('gps') ||
        name.includes('navstar') ||
        name.includes('galileo') ||
        name.includes('glonass') ||
        name.includes('beidou') ||
        name.includes('qzss') ||
        name.includes('sbas')
    ) {
        return 'navigation';
    }
    if (
        name.includes('noaa') ||
        name.includes('meteor') ||
        name.includes('metop') ||
        name.includes('goes') ||
        name.includes('himawari') ||
        name.includes('fengyun') ||
        name.includes('landsat') ||
        name.includes('sentinel') ||
        name.includes('terra') ||
        name.includes('aqua') ||
        name.includes('suomi')
    ) {
        return 'earth';
    }
    return 'other';
}

function getAllSatelliteType(record) {
    const name = normalizeSearchText(record.name);
    if (name.includes('starlink')) return 'starlink';
    if (name.includes('oneweb')) return 'oneweb';
    if (
        name.includes('iss') ||
        name.includes('tiangong') ||
        name.includes('css') ||
        name.includes('crew dragon') ||
        name.includes('soyuz') ||
        name.includes('progress') ||
        name.includes('shenzhou') ||
        name.includes('tianzhou')
    ) {
        return 'crewed';
    }
    if (
        name.includes('gps') ||
        name.includes('navstar') ||
        name.includes('galileo') ||
        name.includes('glonass') ||
        name.includes('beidou') ||
        name.includes('qzss') ||
        name.includes('sbas')
    ) {
        return 'navigation';
    }
    if (
        name.includes('noaa') ||
        name.includes('meteor') ||
        name.includes('metop') ||
        name.includes('goes') ||
        name.includes('himawari') ||
        name.includes('fengyun') ||
        name.includes('weather')
    ) {
        return 'weather';
    }
    if (
        name.includes('landsat') ||
        name.includes('sentinel') ||
        name.includes('terra') ||
        name.includes('aqua') ||
        name.includes('suomi') ||
        name.includes('spot') ||
        name.includes('pleiades') ||
        name.includes('worldview') ||
        name.includes('cartosat') ||
        name.includes('resourcesat')
    ) {
        return 'earthObservation';
    }
    if (
        name.includes('intelsat') ||
        name.includes('eutelsat') ||
        name.includes('ses') ||
        name.includes('viasat') ||
        name.includes('inmarsat') ||
        name.includes('iridium') ||
        name.includes('globalstar') ||
        name.includes('orbcomm') ||
        name.includes('thuraya')
    ) {
        return 'communications';
    }
    if (
        name.includes('hubble') ||
        name.includes('chandra') ||
        name.includes('swift') ||
        name.includes('nustar') ||
        name.includes('xmm') ||
        name.includes('tess') ||
        name.includes('gaia')
    ) {
        return 'science';
    }
    return 'other';
}

function isAllSatelliteCategoryVisible(category) {
    return isLayerChecked('toggle-all-satellites') && isLayerChecked(ALL_SATELLITE_CATEGORY_TOGGLES[category]);
}

function updateAllSatelliteCategoryVisibility() {
    allSatelliteRecords.forEach(record => {
        if (record.point) {
            record.point.show = Boolean(record.hasPosition && isAllSatelliteCategoryVisible(record.category));
        }
    });
    refreshAllSatelliteTrace();
    refreshAllVisibleSatelliteTraces();
    updateSatelliteControlPanel();
}

function getVisibleAllSatelliteRecords() {
    return allSatelliteRecords.filter(record => (
        record.point &&
        record.point.show &&
        record.hasPosition &&
        isAllSatelliteCategoryVisible(record.category)
    ));
}

function getTraceableVisibleSatelliteRecords() {
    const cameraPosition = viewer.camera.positionWC;
    return getVisibleAllSatelliteRecords()
        .map(record => ({
            record,
            distance: hasValidCartesian(record.point.position)
                ? CesiumLib.Cartesian3.distance(cameraPosition, record.point.position)
                : Number.POSITIVE_INFINITY
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, ALL_SATELLITE_TRACE_ALL_LIMIT)
        .map(item => item.record);
}

function isSatelliteLayerVisible() {
    return isLayerChecked('toggle-sat') || isLayerChecked('toggle-all-satellites');
}

function isVisibleSatelliteTraceEnabled() {
    return isLayerChecked('toggle-visible-satellite-traces');
}

function getSatellitePanelTraceCount() {
    const trackedTraceCount = Array.from(visibleTrackedSatelliteOrbitEntities.values()).filter(entity => entity.show).length;
    return trackedTraceCount +
        (selectedTrackedSatelliteOrbitEntity && selectedTrackedSatelliteOrbitEntity.show ? 1 : 0) +
        allVisibleSatelliteTraceEntities.filter(entity => entity.show).length +
        (allSatelliteTraceEntity && allSatelliteTraceEntity.show ? 1 : 0);
}

function updateSatelliteControlPanel() {
    const panel = document.getElementById('satellite-control-panel');
    if (panel) {
        panel.style.display = isSatelliteLayerVisible() ? 'block' : 'none';
    }

    const visibleRecords = getVisibleAllSatelliteRecords();
    setText('sat-panel-visible-count', String(visibleRecords.length + satelliteEntities.filter(entity => entity.show).length));
    setText('sat-panel-trace-count', String(getSatellitePanelTraceCount()));

    const note = document.getElementById('sat-panel-note');
    if (note) {
        const visibleAllCount = visibleRecords.length;
        if (isVisibleSatelliteTraceEnabled() && visibleAllCount > ALL_SATELLITE_TRACE_ALL_LIMIT) {
            note.textContent = `Viser trace for de ${ALL_SATELLITE_TRACE_ALL_LIMIT} nærmeste satellitter for at holde kortet hurtigt.`;
        } else if (isSatelliteLayerVisible()) {
            note.textContent = 'Klik på en satellit for separat infovindue og valgt trace.';
        } else {
            note.textContent = '';
        }
    }
}

function updateTrackedSatelliteTraceVisibility() {
    satelliteEntities.forEach(entity => {
        if (entity.path) {
            entity.path.show = false;
        }
    });

    if (
        selectedSatelliteKey &&
        (!isLayerChecked('toggle-sat') ||
            !satellites[selectedSatelliteKey] ||
            !satellites[selectedSatelliteKey].entity ||
            !satellites[selectedSatelliteKey].entity.show)
    ) {
        clearTrackedSatelliteOrbit();
    }

    refreshVisibleTrackedSatelliteOrbits();
    updateSatelliteControlPanel();
}

function formatAllSatelliteDetails(record) {
    if (!record) return 'Satellit';

    let latitude = '-';
    let longitude = '-';
    let altitude = '-';

    if (record.point && hasValidCartesian(record.point.position)) {
        const cartographic = CesiumLib.Cartographic.fromCartesian(record.point.position);
        latitude = `${formatNumber(CesiumLib.Math.toDegrees(cartographic.latitude), 2)}°`;
        longitude = `${formatNumber(CesiumLib.Math.toDegrees(cartographic.longitude), 2)}°`;
        altitude = `${formatNumber(cartographic.height / 1000, 1)} km`;
    }

    return [
        'Satellit',
        `Kategori: ${ALL_SATELLITE_CATEGORY_LABELS[record.category] || 'Ukendt'}`,
        `Type: ${ALL_SATELLITE_TYPE_LABELS[record.satelliteType] || 'Ukendt'}`,
        `Navn: ${record.name}`,
        `Højde: ${altitude}`,
        `Breddegrad: ${latitude}`,
        `Længdegrad: ${longitude}`
    ].join('<br>');
}

function getAllSatelliteColor(record) {
    if (record.satelliteType === 'starlink') return Cesium.Color.CYAN.withAlpha(0.82);
    if (record.satelliteType === 'oneweb') return Cesium.Color.LIME.withAlpha(0.78);
    if (record.satelliteType === 'navigation') return Cesium.Color.YELLOW.withAlpha(0.82);
    if (record.satelliteType === 'weather') return Cesium.Color.ORANGE.withAlpha(0.82);
    if (record.satelliteType === 'earthObservation') return Cesium.Color.SPRINGGREEN.withAlpha(0.78);
    if (record.satelliteType === 'communications') return Cesium.Color.MAGENTA.withAlpha(0.76);
    if (record.satelliteType === 'crewed') return Cesium.Color.RED.withAlpha(0.86);
    if (record.satelliteType === 'science') {
        return Cesium.Color.MEDIUMPURPLE.withAlpha(0.78);
    }
    return Cesium.Color.WHITE.withAlpha(0.68);
}

function propagateSatelliteRecord(record, date, gmst) {
    const propagated = SatelliteLib.propagate(record.satrec, date);
    if (!propagated || !propagated.position) return null;

    const positionGd = SatelliteLib.eciToGeodetic(propagated.position, gmst);
    const longitude = SatelliteLib.degreesLong(positionGd.longitude);
    const latitude = SatelliteLib.degreesLat(positionGd.latitude);
    const altitudeMeters = Number(positionGd.height) * 1000;
    if (!hasFiniteNumbers(longitude, latitude, altitudeMeters)) return null;

    return CesiumLib.Cartesian3.fromDegrees(longitude, latitude, altitudeMeters);
}

function getSatrecOrbitPeriodMinutes(satrec, fallbackMinutes = SATELLITE_FALLBACK_ORBIT_PERIOD_MINUTES) {
    const meanMotionRadiansPerMinute = satrec && Number(satrec.no);
    if (hasFiniteNumbers(meanMotionRadiansPerMinute) && meanMotionRadiansPerMinute > 0) {
        return (Math.PI * 2) / meanMotionRadiansPerMinute;
    }

    return fallbackMinutes;
}

function getFullOrbitStepMinutes(periodMinutes) {
    return clamp(
        periodMinutes / SATELLITE_FULL_ORBIT_SAMPLE_COUNT,
        SATELLITE_FULL_ORBIT_MIN_STEP_MINUTES,
        SATELLITE_FULL_ORBIT_MAX_STEP_MINUTES
    );
}

function buildFullOrbitPositionsFromSatrec(satrec, fallbackPeriodMinutes = SATELLITE_FALLBACK_ORBIT_PERIOD_MINUTES) {
    if (!satrec) return [];

    const positions = [];
    const now = Date.now();
    const periodMinutes = getSatrecOrbitPeriodMinutes(satrec, fallbackPeriodMinutes);
    const stepMinutes = getFullOrbitStepMinutes(periodMinutes);

    for (let minute = 0; minute <= periodMinutes; minute += stepMinutes) {
        const date = new Date(now + minute * 60 * 1000);
        const position = propagateSatelliteRecord({ satrec }, date, getSatelliteGmst(date));
        if (position) {
            positions.push(position);
        }
    }

    const endDate = new Date(now + periodMinutes * 60 * 1000);
    const endPosition = propagateSatelliteRecord({ satrec }, endDate, getSatelliteGmst(endDate));
    if (endPosition) {
        positions.push(endPosition);
    }

    return positions;
}

function buildAllSatelliteTracePositions(record) {
    if (!record || !record.satrec) return [];

    return buildFullOrbitPositionsFromSatrec(record.satrec);
}

function clearAllSatelliteTrace() {
    selectedAllSatelliteRecord = null;
    if (allSatelliteTraceEntity) {
        allSatelliteTraceEntity.show = false;
    }
    updateSatelliteControlPanel();
}

function clearTrackedSatelliteOrbit() {
    selectedTrackedSatelliteOrbitRequestId += 1;
    selectedSatelliteKey = null;
    if (selectedTrackedSatelliteOrbitEntity) {
        selectedTrackedSatelliteOrbitEntity.show = false;
    }
    updateSatelliteControlPanel();
}

async function getTrackedSatelliteSatrec(key) {
    const sat = satellites[key];
    if (!sat) return null;

    let tle = findTLE(key);
    if (!tle && Object.keys(tleCache).length === 0) {
        await loadTLEData();
        tle = findTLE(key);
    }
    if (!tle) return null;

    try {
        return SatelliteLib.twoline2satrec(tle.line1, tle.line2);
    } catch (error) {
        console.warn('Kunne ikke oprette TLE-bane for satellit:', sat.name, error);
        return null;
    }
}

async function buildTrackedSatelliteOrbitPositions(key) {
    const sat = satellites[key];
    const satrec = await getTrackedSatelliteSatrec(key);
    if (!sat || !satrec) return [];

    return buildFullOrbitPositionsFromSatrec(satrec, sat.orbitPeriodMinutes || SATELLITE_FALLBACK_ORBIT_PERIOD_MINUTES);
}

async function showTrackedSatelliteOrbit(key) {
    const requestId = ++selectedTrackedSatelliteOrbitRequestId;
    const sat = satellites[key];
    if (!sat || !sat.entity || !sat.entity.show) {
        clearTrackedSatelliteOrbit();
        return;
    }

    selectedSatelliteKey = key;
    const positions = await buildTrackedSatelliteOrbitPositions(key);
    if (requestId !== selectedTrackedSatelliteOrbitRequestId || selectedSatelliteKey !== key) {
        return;
    }
    if (positions.length < 2) {
        if (selectedTrackedSatelliteOrbitEntity) {
            selectedTrackedSatelliteOrbitEntity.show = false;
        }
        updateSatelliteControlPanel();
        return;
    }

    if (!selectedTrackedSatelliteOrbitEntity) {
        selectedTrackedSatelliteOrbitEntity = viewer.entities.add({
            name: `Satellitbane: ${sat.name}`,
            show: true,
            polyline: {
                positions,
                arcType: CesiumLib.ArcType.NONE,
                width: ALL_SATELLITE_TRACE_WIDTH + 1,
                material: new CesiumLib.PolylineGlowMaterialProperty({
                    glowPower: 0.14,
                    color: sat.color.withAlpha(0.74)
                })
            },
            description: sat.facts.join('<br>')
        });
    } else {
        selectedTrackedSatelliteOrbitEntity.name = `Satellitbane: ${sat.name}`;
        selectedTrackedSatelliteOrbitEntity.description = sat.facts.join('<br>');
        selectedTrackedSatelliteOrbitEntity.polyline.positions = positions;
        selectedTrackedSatelliteOrbitEntity.polyline.arcType = CesiumLib.ArcType.NONE;
        selectedTrackedSatelliteOrbitEntity.polyline.material = new CesiumLib.PolylineGlowMaterialProperty({
            glowPower: 0.14,
            color: sat.color.withAlpha(0.74)
        });
        selectedTrackedSatelliteOrbitEntity.show = true;
    }

    updateSatelliteControlPanel();
}

function clearVisibleTrackedSatelliteOrbits() {
    visibleTrackedSatelliteOrbitEntities.forEach(entity => viewer.entities.remove(entity));
    visibleTrackedSatelliteOrbitEntities = new Map();
}

async function refreshVisibleTrackedSatelliteOrbits() {
    const refreshId = ++visibleTrackedSatelliteOrbitRefreshId;
    clearVisibleTrackedSatelliteOrbits();
    satelliteEntities.forEach(entity => {
        if (entity.path) {
            entity.path.show = false;
        }
    });

    if (!isVisibleSatelliteTraceEnabled() || !isLayerChecked('toggle-sat')) {
        updateSatelliteControlPanel();
        return;
    }

    for (const key in satellites) {
        const sat = satellites[key];
        if (!sat || !sat.entity || !sat.entity.show) continue;

        const positions = await buildTrackedSatelliteOrbitPositions(key);
        if (refreshId !== visibleTrackedSatelliteOrbitRefreshId || !isVisibleSatelliteTraceEnabled() || !isLayerChecked('toggle-sat')) {
            return;
        }
        if (positions.length < 2) continue;

        const entity = viewer.entities.add({
            name: `Satellitbane: ${sat.name}`,
            polyline: {
                positions,
                arcType: CesiumLib.ArcType.NONE,
                width: 2,
                material: sat.color.withAlpha(0.36)
            },
            description: sat.facts.join('<br>')
        });
        visibleTrackedSatelliteOrbitEntities.set(key, entity);
    }

    updateSatelliteControlPanel();
}

function showAllSatelliteTrace(record) {
    selectedAllSatelliteRecord = record;
    const visible = record && record.hasPosition && isAllSatelliteCategoryVisible(record.category);
    const positions = visible ? buildAllSatelliteTracePositions(record) : [];

    if (positions.length < 2) {
        if (allSatelliteTraceEntity) {
            allSatelliteTraceEntity.show = false;
        }
        return;
    }

    const color = getAllSatelliteColor(record).withAlpha(0.7);
    if (!allSatelliteTraceEntity) {
        allSatelliteTraceEntity = viewer.entities.add({
            name: `Satellitspor: ${record.name}`,
            show: true,
            polyline: {
                positions,
                arcType: CesiumLib.ArcType.NONE,
                width: ALL_SATELLITE_TRACE_WIDTH,
                material: new CesiumLib.PolylineGlowMaterialProperty({
                    glowPower: 0.12,
                    color
                })
            },
            description: formatAllSatelliteDetails(record)
        });
        return;
    }

    allSatelliteTraceEntity.name = `Satellitspor: ${record.name}`;
    allSatelliteTraceEntity.description = formatAllSatelliteDetails(record);
    allSatelliteTraceEntity.polyline.positions = positions;
    allSatelliteTraceEntity.polyline.arcType = CesiumLib.ArcType.NONE;
    allSatelliteTraceEntity.polyline.material = new CesiumLib.PolylineGlowMaterialProperty({
        glowPower: 0.12,
        color
    });
    allSatelliteTraceEntity.show = true;
}

function refreshAllSatelliteTrace() {
    if (!selectedAllSatelliteRecord) return;
    showAllSatelliteTrace(selectedAllSatelliteRecord);
}

function clearAllVisibleSatelliteTraces() {
    allVisibleSatelliteTraceEntities.forEach(entity => viewer.entities.remove(entity));
    allVisibleSatelliteTraceEntities = [];
    updateSatelliteControlPanel();
}

function refreshAllVisibleSatelliteTraces() {
    clearAllVisibleSatelliteTraces();
    updateTrackedSatelliteTraceVisibility();
    if (!isVisibleSatelliteTraceEnabled() || !isLayerChecked('toggle-all-satellites')) {
        return;
    }

    getTraceableVisibleSatelliteRecords().forEach(record => {
        const positions = buildAllSatelliteTracePositions(record);
        if (positions.length < 2) return;

        allVisibleSatelliteTraceEntities.push(viewer.entities.add({
            name: `Satellitspor: ${record.name}`,
            polyline: {
                positions,
                arcType: CesiumLib.ArcType.NONE,
                width: 1,
                material: getAllSatelliteColor(record).withAlpha(0.24)
            },
            description: formatAllSatelliteDetails(record)
        }));
    });

    updateSatelliteControlPanel();
}

function updateAllSatellitesLayer(startIndex = 0, date = new Date(), gmst = getSatelliteGmst(date)) {
    if (!allSatellitePointCollection || allSatelliteRecords.length === 0) return;

    const endIndex = Math.min(startIndex + ALL_SATELLITES_BATCH_SIZE, allSatelliteRecords.length);
    for (let i = startIndex; i < endIndex; i += 1) {
        const record = allSatelliteRecords[i];
        const position = propagateSatelliteRecord(record, date, gmst);
        if (position && record.point) {
            record.point.position = position;
            record.hasPosition = true;
            record.point.show = isAllSatelliteCategoryVisible(record.category);
        } else if (record.point) {
            record.hasPosition = false;
            record.point.show = false;
        }
    }

    if (endIndex < allSatelliteRecords.length) {
        window.requestAnimationFrame(() => updateAllSatellitesLayer(endIndex, date, gmst));
        return;
    }

    setDataStatus('status-tle', 'ok', `${allSatelliteRecords.length} sat`);
    refreshAllSatelliteTrace();
}

function scheduleAllSatellitesUpdate() {
    window.clearInterval(allSatellitesUpdateTimer);
    allSatellitesUpdateTimer = window.setInterval(() => {
        if (isLayerChecked('toggle-all-satellites')) {
            updateAllSatellitesLayer();
        }
    }, ALL_SATELLITES_UPDATE_INTERVAL_MS);
}

async function loadAllSatellitesLayer() {
    if (isLoadingAllSatellites || allSatelliteRecords.length > 0) return;

    isLoadingAllSatellites = true;
    setDataStatus('status-tle', 'warn', 'Henter alle');

    try {
        const response = await fetch(ALL_SATELLITES_TLE_URL);
        if (!response.ok) {
            setDataStatus('status-tle', 'error', `Fejl ${response.status}`);
            return;
        }

        const records = parseTleRecords(await response.text())
            .map(record => {
                try {
                    return {
                        ...record,
                        satrec: SatelliteLib.twoline2satrec(record.line1, record.line2),
                        category: getAllSatelliteCategory(record),
                        satelliteType: getAllSatelliteType(record),
                        hasPosition: false,
                        point: null
                    };
                } catch (e) {
                    return null;
                }
            })
            .filter(Boolean);

        if (!allSatellitePointCollection) {
            allSatellitePointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection());
        }

        allSatellitePointCollection.removeAll();
        allSatelliteRecords = records;
        allSatelliteRecords.forEach(record => {
            record.point = allSatellitePointCollection.add({
                position: CesiumLib.Cartesian3.ZERO,
                pixelSize: ALL_SATELLITES_POINT_SIZE,
                color: getAllSatelliteColor(record),
                outlineColor: CesiumLib.Color.BLACK.withAlpha(0.7),
                outlineWidth: 1,
                id: { allSatelliteRecord: record },
                show: false
            });
        });

        allSatellitePointCollection.show = isLayerChecked('toggle-all-satellites');
        updateAllSatellitesLayer();
        scheduleAllSatellitesUpdate();
    } catch (error) {
        setDataStatus('status-tle', 'error', 'Fejl');
        console.warn('Kunne ikke hente alle satellitter:', error);
    } finally {
        isLoadingAllSatellites = false;
    }
}

function formatNumber(value, digits) {
    if (!hasFiniteNumbers(value)) return '-';
    return Number(value).toLocaleString('da-DK', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits
    });
}

function applyFilters() {
    const minShipSpeed = Number(getInputValue('filter-ship-speed') || 0);
    const shipText = normalizeSearchText(getInputValue('filter-ship-type'));
    const minPlaneAltitude = Number(getInputValue('filter-plane-altitude') || 0);
    const airportType = getInputValue('filter-airport-type') || 'all';

    liveShipEntities.forEach(ship => {
        const speedOk = !Number.isFinite(minShipSpeed) || minShipSpeed <= 0 || (hasFiniteNumbers(ship.speed) && Number(ship.speed) >= minShipSpeed);
        const textHaystack = normalizeSearchText(`${ship.name} ${ship.destination} ${ship.shipType} ${ship.description}`);
        const textOk = !shipText || textHaystack.includes(shipText);
        ship.filterVisible = speedOk && textOk;
    });

    planeEntities.forEach(plane => {
        plane.filterVisible = !Number.isFinite(minPlaneAltitude) || minPlaneAltitude <= 0 || (hasFiniteNumbers(plane.altitude) && Number(plane.altitude) >= minPlaneAltitude);
    });

    airportEntities.forEach(entity => {
        const type = entity.airportType || '';
        entity.filterVisible = airportType === 'all' ||
            type === 'large_airport' ||
            (airportType === 'medium_airport' && type === 'medium_airport');
    });
}

function updateZoomPriority() {
    const cameraHeight = viewer.camera.positionCartographic.height;

    airportEntities.forEach(entity => {
        entity.zoomVisible = entity.airportType === 'large_airport' || cameraHeight <= AIRPORT_MEDIUM_MAX_CAMERA_HEIGHT_M;
        if (entity.label) {
            entity.label.show = cameraHeight <= AIRPORT_LABEL_NEAR_DISTANCE_M;
        }
    });

    shipEntities.forEach(entity => {
        entity.zoomVisible = cameraHeight <= PORT_MAX_CAMERA_HEIGHT_M;
    });
}

function setWeatherVisible(visible) {
    weatherEntities.forEach(entity => {
        entity.show = visible;
    });
}

function setShipTrailsVisible(visible) {
    liveShipEntities.forEach(ship => {
        if (ship.trailEntity) {
            ship.trailEntity.show = visible && ship.entity.show && ship.history && ship.history.length > 1;
        }
    });
}

function removeLiveShip(mmsi, ship) {
    if (!ship) return;
    viewer.entities.remove(ship.entity);
    if (ship.trailEntity) viewer.entities.remove(ship.trailEntity);
    liveShipEntities.delete(mmsi);
    shipStaticByMmsi.delete(mmsi);
    unregisterSearchItem(`ship:${mmsi}`);
}

function loadWatchlist() {
    try {
        const raw = localStorage.getItem(WATCHLIST_KEY);
        watchlist = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(watchlist)) watchlist = [];
    } catch (e) {
        watchlist = [];
    }
    renderWatchlist();
}

function saveWatchlist() {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist));
}

function setDataStatus(id, state, text) {
    const element = document.getElementById(id);
    if (!element) return;
    element.classList.remove('status-ok', 'status-warn', 'status-error');
    element.classList.add(`status-${state}`);
    const value = element.children[1];
    if (value) value.textContent = text;
}

function getFreshAisShipCount(maxAgeMs = AIS_STALE_MS) {
    const now = Date.now();
    let count = 0;
    liveShipEntities.forEach(ship => {
        if (now - Number(ship.lastSeen || 0) <= maxAgeMs) {
            count += 1;
        }
    });
    return count;
}

function updateAisLiveStatus(fallbackState = 'ok', fallbackText = 'Forbundet') {
    const count = getFreshAisShipCount();
    if (count > 0) {
        setDataStatus('status-ais', 'ok', `${count} skibe`);
        return;
    }

    setDataStatus('status-ais', fallbackState, fallbackText);
}

function pruneLiveAisShips() {
    if (liveShipEntities.size <= AIS_MAX_LIVE_SHIPS) return false;

    const overflow = liveShipEntities.size - AIS_MAX_LIVE_SHIPS;
    Array.from(liveShipEntities.entries())
        .sort((a, b) => Number(a[1].lastSeen || 0) - Number(b[1].lastSeen || 0))
        .slice(0, overflow)
        .forEach(([mmsi, ship]) => removeLiveShip(mmsi, ship));

    return overflow > 0;
}

function findSearchItemForWatch(value) {
    const needle = normalizeSearchText(value);
    if (!needle) return null;

    const matches = searchableItems
        .map(item => {
            const label = normalizeSearchText(item.label);
            const keywords = normalizeSearchText(item.keywords);
            let score = Number.POSITIVE_INFINITY;

            if (label === needle) {
                score = 0;
            } else if (keywords.split(/\s+/).includes(needle)) {
                score = 1;
            } else if (label.includes(needle)) {
                score = 2;
            } else if (keywords.includes(needle)) {
                score = 3;
            }

            return { item, score };
        })
        .filter(match => Number.isFinite(match.score))
        .sort((a, b) => a.score - b.score);

    return matches.length ? matches[0].item : null;
}

function focusWatchlistItem(value) {
    const item = findSearchItemForWatch(value);
    if (!item) return;
    focusSearchItem(item);
}

function renderWatchlist() {
    const container = document.getElementById('watchlist-items');
    if (!container) return;
    clearElement(container);

    if (watchlist.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'empty-state';
        empty.textContent = 'Ingen watch-items endnu.';
        container.appendChild(empty);
        return;
    }

    watchlist.forEach((item, index) => {
        const row = document.createElement('div');
        row.className = 'watchlist-item';
        row.tabIndex = 0;
        row.title = 'Klik for at zoome ind';
        row.addEventListener('click', () => focusWatchlistItem(item));
        row.addEventListener('keydown', event => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                focusWatchlistItem(item);
            }
        });

        const label = document.createElement('span');
        label.textContent = item;

        const remove = document.createElement('button');
        remove.className = 'watchlist-remove';
        remove.type = 'button';
        remove.textContent = 'x';
        remove.addEventListener('click', event => {
            event.stopPropagation();
            removeWatchlistItem(index);
        });

        row.appendChild(label);
        row.appendChild(remove);
        container.appendChild(row);
    });
}

function addWatchlistItem(value) {
    const item = String(value || '').trim();
    if (!item) return;
    if (!watchlist.some(existing => normalizeSearchText(existing) === normalizeSearchText(item))) {
        watchlist.push(item);
        saveWatchlist();
        renderWatchlist();
        refreshVisibleSideScope();
        runSearch();
    }
}

function removeWatchlistItem(index) {
    watchlist.splice(index, 1);
    saveWatchlist();
    renderWatchlist();
    refreshVisibleSideScope();
    runSearch();
}

function initTabs() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            const tabName = button.dataset.tab;
            document.querySelectorAll('.tab-button').forEach(item => item.classList.toggle('active', item === button));
            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.classList.toggle('active', panel.id === `tab-${tabName}`);
            });
        });
    });
}

function updateWatchlistHighlights() {
    searchableItems.forEach(item => {
        const entity = item.entity;
        if (!entity || !entity.billboard) return;
        const matched = entityMatchesWatch(`${item.label} ${item.keywords}`);
        entity.billboard.color = matched ? Cesium.Color.YELLOW : (entity.baseColor || Cesium.Color.WHITE);
        if (entity.baseScale) {
            entity.billboard.scale = matched ? entity.baseScale * 1.35 : entity.baseScale;
        }
    });

    liveShipEntities.forEach(ship => {
        if (!ship.entity || !ship.entity.billboard) return;
        const matched = entityMatchesWatch(`${ship.name} ${ship.mmsi} ${ship.destination} ${ship.shipType}`);
        ship.entity.billboard.color = matched ? Cesium.Color.YELLOW : Cesium.Color.WHITE;
        ship.entity.billboard.scale = matched ? 0.58 : 0.42;
    });
}

function createDetailImageElement(type) {
    const normalizedType = normalizeSearchText(type);
    let image = '';
    let alt = '';

    if (normalizedType === 'fly') {
        image = PLANE_ICON;
        alt = 'Fly';
    } else if (normalizedType === 'skib') {
        image = SHIP_ICON;
        alt = 'Skib';
    }

    if (!image) return null;

    const wrapper = document.createElement('div');
    wrapper.className = 'detail-image';
    const img = document.createElement('img');
    img.src = image;
    img.alt = alt;
    wrapper.appendChild(img);
    return wrapper;
}

function renderDetailBody(element, body, type) {
    clearElement(element);
    const image = createDetailImageElement(type);
    if (image) {
        element.appendChild(image);
    }

    String(body || '').split(/<br\s*\/?>/i).forEach(line => {
        const text = line.replace(/<[^>]*>/g, '').trim();
        if (!text) return;
        const row = document.createElement('div');
        row.textContent = text;
        element.appendChild(row);
    });
}

function showDetailPanel(title, body, watchText = '', type = '') {
    selectedDetailItem = watchText || title;
    setText('detail-title', title);
    const bodyElement = document.getElementById('detail-body');
    const panel = document.getElementById('detail-panel');
    if (bodyElement) renderDetailBody(bodyElement, body, type);
    if (panel) panel.style.display = 'block';
}

function hideDetailPanel() {
    const panel = document.getElementById('detail-panel');
    if (panel) panel.style.display = 'none';
    selectedDetailItem = null;
    clearAllSatelliteTrace();
}

function initDetailPicking() {
    viewer.screenSpaceEventHandler.setInputAction(click => {
        const picked = viewer.scene.pick(click.position);
        if (!Cesium.defined(picked)) return;

        const satelliteRecord = picked.id && picked.id.allSatelliteRecord;
        if (satelliteRecord) {
            showAllSatelliteTrace(satelliteRecord);
            showDetailPanel(
                satelliteRecord.name,
                formatAllSatelliteDetails(satelliteRecord),
                satelliteRecord.name,
                'Satellit'
            );
            return;
        }

        if (!picked.id) return;

        const entity = picked.id;
        if (entity.satelliteKey) {
            updateSatelliteInfoPanel(entity.satelliteKey);
            showTrackedSatelliteOrbit(entity.satelliteKey);
            return;
        }

        const item = searchableItems.find(candidate => candidate.entity === entity);
        if (item) {
            showDetailPanel(item.label, item.details || describeEntity(entity, item.type), item.label, item.type);
            return;
        }

        showDetailPanel(entity.name || 'Detaljer', describeEntity(entity, 'Ingen detaljer.'), entity.name || '');
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function describeEntity(entity, fallback = '') {
    if (!entity) return fallback;
    if (typeof entity.description === 'string') return entity.description;
    if (entity.description && typeof entity.description.getValue === 'function') {
        return entity.description.getValue(viewer.clock.currentTime) || fallback;
    }
    return fallback;
}

function flyToShipEntity(entity) {
    const position = getEntityPosition(entity);
    if (!hasValidCartesian(position)) {
        viewer.flyTo(entity);
        return;
    }

    viewer.trackedEntity = undefined;
    viewer.camera.flyToBoundingSphere(
        new Cesium.BoundingSphere(position, 200),
        {
            offset: new Cesium.HeadingPitchRange(
                viewer.camera.heading,
                Cesium.Math.toRadians(-55),
                SHIP_SEARCH_FOCUS_HEIGHT_M
            ),
            duration: 1.2,
            complete: refreshVisibleSideScope
        }
    );
}

function focusSearchItem(item) {
    if (!item || !item.entity) return;
    if (item.type === 'Skib') {
        flyToShipEntity(item.entity);
    } else {
        viewer.trackedEntity = undefined;
        viewer.flyTo(item.entity);
    }
    showDetailPanel(item.label, item.details || describeEntity(item.entity, item.type), item.label, item.type);
}

function runSearch() {
    const query = normalizeSearchText(getInputValue('search-box'));
    const container = document.getElementById('search-results');
    if (!container) return;
    clearElement(container);
    if (!query) return;

    const matches = searchableItems
        .filter(item => item.keywords.includes(query))
        .slice(0, 12);

    matches.forEach(item => {
        const result = document.createElement('div');
        result.className = 'search-result';
        result.textContent = `${item.type}: ${item.label}`;
        result.addEventListener('click', () => focusSearchItem(item));
        container.appendChild(result);
    });
}

function getPlaneAltitudeColor(altitudeMeters) {
    const altitude = clamp(Number(altitudeMeters), 0, FLIGHT_BLUE_ALTITUDE_M);

    if (altitude <= FLIGHT_GREEN_ALTITUDE_M) {
        const ratio = altitude / FLIGHT_GREEN_ALTITUDE_M;
        return new CesiumLib.Color(1 - ratio, ratio, 0, 1);
    }

    const ratio = (altitude - FLIGHT_GREEN_ALTITUDE_M) / (FLIGHT_BLUE_ALTITUDE_M - FLIGHT_GREEN_ALTITUDE_M);
    return new CesiumLib.Color(0, 1 - ratio, ratio, 1);
}

function getPlaneBillboardRotation(headingDegrees) {
    if (!hasFiniteNumbers(headingDegrees)) return 0;
    return -Cesium.Math.toRadians(Number(headingDegrees));
}

function getPointAtBearing(lonDegrees, latDegrees, bearingDegrees, distanceMeters) {
    const angularDistance = distanceMeters / Cesium.Ellipsoid.WGS84.maximumRadius;
    const bearing = Cesium.Math.toRadians(Number(bearingDegrees));
    const lat1 = Cesium.Math.toRadians(Number(latDegrees));
    const lon1 = Cesium.Math.toRadians(Number(lonDegrees));
    const sinLat1 = Math.sin(lat1);
    const cosLat1 = Math.cos(lat1);
    const sinDistance = Math.sin(angularDistance);
    const cosDistance = Math.cos(angularDistance);

    const lat2 = Math.asin(
        sinLat1 * cosDistance +
        cosLat1 * sinDistance * Math.cos(bearing)
    );
    const lon2 = lon1 + Math.atan2(
        Math.sin(bearing) * sinDistance * cosLat1,
        cosDistance - sinLat1 * Math.sin(lat2)
    );

    return {
        lon: Cesium.Math.toDegrees(lon2),
        lat: Cesium.Math.toDegrees(lat2)
    };
}

function getScreenAlignedRotation(position, lon, lat, headingDegrees) {
    if (!hasValidCartesian(position) || !hasFiniteNumbers(lon, lat, headingDegrees)) {
        return getPlaneBillboardRotation(headingDegrees);
    }

    const currentScreen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, position);
    const cartographic = Cesium.Cartographic.fromCartesian(position);
    const nextPoint = getPointAtBearing(lon, lat, headingDegrees, 10000);
    const nextPosition = Cesium.Cartesian3.fromDegrees(nextPoint.lon, nextPoint.lat, cartographic.height);
    const nextScreen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, nextPosition);

    if (!currentScreen || !nextScreen || !hasFiniteNumbers(currentScreen.x, currentScreen.y, nextScreen.x, nextScreen.y)) {
        return getPlaneBillboardRotation(headingDegrees);
    }

    const dx = nextScreen.x - currentScreen.x;
    const dy = nextScreen.y - currentScreen.y;
    if (!hasFiniteNumbers(dx, dy) || (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001)) {
        return getPlaneBillboardRotation(headingDegrees);
    }

    return -Math.atan2(dx, -dy);
}

function updatePlaneBillboardRotation(plane, positionOverride = null) {
    if (!plane || !plane.entity || !plane.entity.billboard || !hasFiniteNumbers(plane.lon, plane.lat, plane.heading)) {
        return;
    }

    const position = positionOverride || getEntityPosition(plane.entity);
    plane.entity.billboard.rotation = getScreenAlignedRotation(position, plane.lon, plane.lat, plane.heading);
}

function updatePlaneBillboardRotations() {
    planeEntities.forEach(updatePlaneBillboardRotation);
}

function getBillboardRotationFromHeading(headingDegrees) {
    return 0;
}

function formatShipLabel(name) {
    const cleanName = String(name || '').replace(/\s+/g, ' ').trim();
    if (cleanName.length <= SHIP_LABEL_MAX_LENGTH) return cleanName;
    return `${cleanName.slice(0, SHIP_LABEL_MAX_LENGTH - 3)}...`;
}

function boxesOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function makeShipIconBox(screenPosition) {
    return {
        left: screenPosition.x - SHIP_ICON_COLLISION_PX,
        right: screenPosition.x + SHIP_ICON_COLLISION_PX,
        top: screenPosition.y - SHIP_ICON_COLLISION_PX,
        bottom: screenPosition.y + SHIP_ICON_COLLISION_PX
    };
}

function makeShipLabelBox(screenPosition, text) {
    const width = Math.max(36, text.length * SHIP_LABEL_CHAR_WIDTH_PX) + SHIP_LABEL_PADDING_PX * 2;
    const height = SHIP_LABEL_HEIGHT_PX + SHIP_LABEL_PADDING_PX * 2;
    const centerY = screenPosition.y - 24;

    return {
        left: screenPosition.x - width / 2,
        right: screenPosition.x + width / 2,
        top: centerY - height / 2,
        bottom: centerY + height / 2
    };
}

function isBoxInsideCanvas(box) {
    const canvas = viewer.scene.canvas;
    return box.right >= 0 && box.left <= canvas.clientWidth && box.bottom >= 0 && box.top <= canvas.clientHeight;
}

function getEntityWindowPosition(entity) {
    const position = getEntityPosition(entity);
    if (!hasValidCartesian(position)) return null;
    return Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, position);
}

function declutterLiveShipLabels() {
    const layerVisible = isLayerChecked('toggle-ship-traffic');
    const cameraPosition = viewer.camera.positionWC;
    const iconBoxes = [];
    const candidates = [];

    liveShipEntities.forEach(ship => {
        const entity = ship.entity;
        if (!entity || !entity.label) return;

        entity.label.show = false;
        if (!layerVisible || !entity.show) return;

        const position = getEntityPosition(entity);
        if (!hasValidCartesian(position)) return;

        const distance = Cesium.Cartesian3.distance(cameraPosition, position);
        if (distance > SHIP_LABEL_MAX_DISTANCE_M) return;

        const screenPosition = getEntityWindowPosition(entity);
        if (!screenPosition) return;

        const iconBox = makeShipIconBox(screenPosition);
        iconBoxes.push({ box: iconBox, entity });

        const text = formatShipLabel(ship.name || entity.name);
        const labelBox = makeShipLabelBox(screenPosition, text);
        if (!isBoxInsideCanvas(labelBox)) return;

        candidates.push({
            entity,
            text,
            box: labelBox,
            lastSeen: ship.lastSeen || 0
        });
    });

    candidates
        .sort((a, b) => b.lastSeen - a.lastSeen || a.text.localeCompare(b.text))
        .forEach(candidate => {
            const overlapsIcon = iconBoxes.some(icon => icon.entity !== candidate.entity && boxesOverlap(candidate.box, icon.box));
            if (overlapsIcon) return;

            const overlapsLabel = candidates.some(other => other !== candidate && other.accepted && boxesOverlap(candidate.box, other.box));
            if (overlapsLabel) return;

            candidate.accepted = true;
            candidate.entity.label.text = candidate.text;
            candidate.entity.label.show = true;
        });
}

function appendShipTrailPoint(ship, position) {
    if (!ship || !hasValidCartesian(position)) return;

    ship.history = ship.history || [];
    const previous = ship.history[ship.history.length - 1];
    if (previous && Cesium.Cartesian3.distance(previous, position) < SHIP_TRAIL_MIN_DISTANCE_M) return;

    ship.history.push(position);
    if (ship.history.length > SHIP_TRAIL_MAX_POINTS) {
        ship.history.shift();
    }

    if (ship.trailEntity) {
        ship.trailEntity.polyline.positions = ship.history.slice();
        ship.trailEntity.show = isLayerChecked('toggle-ship-trails') && ship.entity.show && ship.history.length > 1;
    }
}

function resetShipTrail(ship, position) {
    if (!ship || !hasValidCartesian(position)) return;

    ship.history = [position];
    if (ship.trailEntity) {
        ship.trailEntity.polyline.positions = [position];
        ship.trailEntity.show = false;
    }
}

function shouldResetShipTrail(ship, nextPosition, nextSpeed, nowMs) {
    if (!ship || !hasValidCartesian(nextPosition) || !ship.history || ship.history.length === 0) {
        return false;
    }

    const previousPosition = ship.history[ship.history.length - 1];
    const distanceMeters = Cesium.Cartesian3.distance(previousPosition, nextPosition);
    const elapsedMs = nowMs - Number(ship.lastSeen || 0);
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return false;

    if (elapsedMs > SHIP_TRAIL_RESET_AFTER_MS) return true;

    const previousSpeed = hasFiniteNumbers(ship.speed) ? Number(ship.speed) : 0;
    const reportedSpeed = hasFiniteNumbers(nextSpeed) ? Number(nextSpeed) : 0;
    const allowedSpeedKn = Math.max(previousSpeed, reportedSpeed, SHIP_TRAIL_MAX_REASONABLE_SPEED_KN);
    const allowedMeters = Math.max(
        SHIP_TRAIL_MAX_JUMP_M,
        allowedSpeedKn * 0.514444 * (elapsedMs / 1000) * 2
    );

    return distanceMeters > allowedMeters;
}

function createLiveShipEntity({ mmsi, name, lon, lat, course, speed, description, lastSeen }) {
    const position = CesiumLib.Cartesian3.fromDegrees(lon, lat, SHIP_MARKER_HEIGHT_METERS);
    if (!hasValidCartesian(position)) return null;

    const entity = viewer.entities.add({
        name,
        position,
        billboard: {
            image: SHIP_ICON,
            scale: 0.42,
            rotation: getBillboardRotationFromHeading(course),
            alignedAxis: Cesium.Cartesian3.ZERO,
            disableDepthTestDistance: ALWAYS_SHOW_BILLBOARD_DISTANCE
        },
        label: {
            text: formatShipLabel(name),
            show: false,
            font: 'bold 10pt sans-serif',
            fillColor: Cesium.Color.WHITE,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 3,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            pixelOffset: new Cesium.Cartesian2(0, -24),
            disableDepthTestDistance: ALWAYS_SHOW_BILLBOARD_DISTANCE,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, SHIP_LABEL_MAX_DISTANCE_M)
        },
        description
    });

    const trailEntity = viewer.entities.add({
        name: `Spor: ${name}`,
        show: false,
        polyline: {
            positions: [position],
            width: 2,
            material: Cesium.Color.CYAN.withAlpha(0.58),
            clampToGround: true
        }
    });

    liveShipEntities.set(mmsi, {
        mmsi,
        entity,
        trailEntity,
        history: [position],
        lastSeen,
        lat,
        lon,
        course,
        speed,
        name,
        description
    });

    return entity;
}

function setText(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text;
    }
}

function updateSatelliteInfoPanel(key) {
    const sat = satellites[key];
    const panel = document.getElementById('satellite-info');
    if (!sat || !panel) return;

    selectedSatelliteKey = key;
    panel.style.display = 'block';
    setText('sat-info-title', sat.name);

    const telemetry = sat.telemetry;
    setText('sat-info-altitude', telemetry ? `${formatNumber(telemetry.altitudeKm, 1)} km` : 'Henter...');
    setText('sat-info-speed', telemetry ? `${formatNumber(telemetry.speedKmh, 0)} km/t` : 'Henter...');
    setText('sat-info-latitude', telemetry ? `${formatNumber(telemetry.latitude, 2)}°` : 'Henter...');
    setText('sat-info-longitude', telemetry ? `${formatNumber(telemetry.longitude, 2)}°` : 'Henter...');
    setText('sat-info-orbit', `ca. ${sat.orbitPeriodMinutes} min`);

    const factsElement = document.getElementById('sat-info-facts');
    if (factsElement) {
        clearElement(factsElement);
        sat.facts.forEach(fact => {
            const row = document.createElement('div');
            row.textContent = fact;
            factsElement.appendChild(row);
        });
    }
}

function hideSatelliteInfoPanel() {
    clearTrackedSatelliteOrbit();
    const panel = document.getElementById('satellite-info');
    if (panel) {
        panel.style.display = 'none';
    }
}

// 3. FUNKTION: INITIALISÉR SATELLITTER
function sendAisSubscription(force = false) {
    if (!aisSocket || aisSocket.readyState !== WebSocket.OPEN || !isLayerChecked('toggle-ship-traffic')) {
        return;
    }

    const now = Date.now();
    const scopeKey = getAisScopeKey();
    if (!force && scopeKey === aisLastScopeKey) return;

    if (!force && now - aisLastSubscriptionAt < AIS_MIN_SUBSCRIPTION_GAP_MS) {
        scheduleAisSubscription(AIS_MIN_SUBSCRIPTION_GAP_MS - (now - aisLastSubscriptionAt));
        return;
    }

    aisLastScopeKey = scopeKey;
    aisLastSubscriptionAt = now;
    aisSocket.send(JSON.stringify({
        APIKey: AIS_API_KEY,
        BoundingBoxes: getAisBoundingBoxes(),
        FilterMessageTypes: [
            'PositionReport',
            'StandardClassBPositionReport',
            'ExtendedClassBPositionReport',
            'ShipStaticData',
            'StaticDataReport'
        ]
    }));
}

function scheduleAisSubscription(delayMs = AIS_SUBSCRIPTION_DEBOUNCE_MS) {
    window.clearTimeout(aisSubscriptionTimer);
    aisSubscriptionTimer = window.setTimeout(() => sendAisSubscription(), delayMs);
}

function getAisPositionReport(message) {
    if (!message) return null;
    return message.PositionReport ||
        message.StandardClassBPositionReport ||
        message.ExtendedClassBPositionReport;
}

function cleanAisText(value) {
    if (value === undefined || value === null) return '';
    return String(value).replace(/@+$/g, '').trim();
}

function getAisMmsi(aisData) {
    return aisData.MetaData && aisData.MetaData.MMSI ||
        aisData.Message && Object.values(aisData.Message).find(Boolean)?.UserID;
}

function getAisStaticPayload(message) {
    if (!message) return {};
    const shipStaticData = message.ShipStaticData || {};
    const staticDataReport = message.StaticDataReport || {};
    const extendedClassB = message.ExtendedClassBPositionReport || {};
    const reportA = staticDataReport.ReportA || {};
    const reportB = staticDataReport.ReportB || {};

    return {
        name: cleanAisText(shipStaticData.Name || reportA.Name || extendedClassB.Name),
        destination: cleanAisText(shipStaticData.Destination),
        shipType: shipStaticData.Type ?? reportB.ShipType ?? extendedClassB.Type
    };
}

function getShipTypeLabel(shipType) {
    const type = Number(shipType);
    if (!Number.isFinite(type)) return '';

    if (type >= 20 && type <= 29) return `WIG/fartøj type ${type}`;
    if (type === 30) return 'Fiskeri';
    if (type === 31 || type === 32) return 'Bugsering';
    if (type === 33) return 'Uddybning/undervandsarbejde';
    if (type === 34) return 'Dykkerfartøj';
    if (type === 35) return 'Militær operation';
    if (type === 36) return 'Sejlbåd';
    if (type === 37) return 'Lystfartøj';
    if (type >= 40 && type <= 49) return `Højhastighedsfartøj type ${type}`;
    if (type === 50) return 'Lods-/specialfartøj';
    if (type === 51) return 'SAR';
    if (type === 52) return 'Slæbebåd';
    if (type === 53) return 'Havnefartøj';
    if (type === 54) return 'Anti-forurening';
    if (type === 55) return 'Politi/kystvagt';
    if (type === 58) return 'Medicinsk transport';
    if (type >= 60 && type <= 69) return `Passagerskib type ${type}`;
    if (type >= 70 && type <= 79) return `Fragtskib type ${type}`;
    if (type >= 80 && type <= 89) return `Tankskib type ${type}`;
    if (type >= 90 && type <= 99) return `Andet skib type ${type}`;
    return `AIS type ${type}`;
}

function buildAisDescription(mmsi, speed, course, staticData) {
    const destination = staticData.destination || 'Ikke oplyst';
    const shipType = staticData.shipTypeLabel || 'Afventer AIS static data';

    return [
        'Live AIS',
        `MMSI: ${mmsi}`,
        `Fart: ${hasFiniteNumbers(speed) ? speed.toFixed(1) : '-'} kn`,
        `Kurs: ${hasFiniteNumbers(course) ? course.toFixed(0) : '-'} deg`,
        `Destination: ${destination}`,
        `Skibstype: ${shipType}`
    ].join('<br>');
}

function refreshAisShipDescription(mmsi) {
    const ship = liveShipEntities.get(mmsi);
    if (!ship) return;

    const staticData = shipStaticByMmsi.get(mmsi) || {};
    const description = buildAisDescription(mmsi, ship.speed, ship.course, staticData);
    ship.description = description;
    ship.entity.description = description;
    if (staticData.name) {
        ship.name = staticData.name;
        ship.entity.name = staticData.name;
        ship.entity.label.text = staticData.name;
    }
}

function updateAisStaticData(mmsi, aisData) {
    if (!mmsi) return;

    const existing = shipStaticByMmsi.get(mmsi) || {};
    const staticPayload = getAisStaticPayload(aisData.Message);
    const metadataName = cleanAisText(aisData.MetaData && aisData.MetaData.ShipName);
    const name = metadataName || staticPayload.name || existing.name || `Vessel ${mmsi}`;
    const destination = staticPayload.destination || existing.destination || '';
    const shipType = staticPayload.shipType ?? existing.shipType;
    const shipTypeLabel = getShipTypeLabel(shipType) || existing.shipTypeLabel || '';

    shipStaticByMmsi.set(mmsi, {
        name,
        destination,
        shipType,
        shipTypeLabel
    });

    refreshAisShipDescription(mmsi);
}

function upsertAisShip(aisData) {
    const report = getAisPositionReport(aisData.Message);
    if (!aisData.MetaData || !report) return;

    const mmsi = getAisMmsi(aisData);
    updateAisStaticData(mmsi, aisData);

    const staticData = shipStaticByMmsi.get(mmsi) || {};
    const name = staticData.name || (aisData.MetaData.ShipName || `Vessel ${mmsi}`).trim();
    const lat = Number(report.Latitude);
    const lon = Number(report.Longitude);
    const speed = Number(report.Sog);
    const course = Number(report.Cog);

    if (!mmsi || !hasFiniteNumbers(lat, lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
        return;
    }

    const position = CesiumLib.Cartesian3.fromDegrees(lon, lat, SHIP_MARKER_HEIGHT_METERS);
    if (!hasValidCartesian(position)) return;

    const description = [
        'Live AIS',
        `MMSI: ${mmsi}`,
        `Fart: ${hasFiniteNumbers(speed) ? speed.toFixed(1) : '-'} kn`,
        `Kurs: ${hasFiniteNumbers(course) ? course.toFixed(0) : '-'}°`,
        `Destination: ${staticData.destination || '-'}`,
        `Skibstype: ${staticData.shipType || '-'}`
    ].join('<br>');

    if (liveShipEntities.has(mmsi)) {
        const ship = liveShipEntities.get(mmsi);
        const now = Date.now();
        const resetTrail = shouldResetShipTrail(ship, position, speed, now);
        ship.entity.position = position;
        ship.entity.show = isLayerChecked('toggle-ship-traffic');
        ship.entity.name = name;
        ship.entity.description = description;
        ship.entity.label.text = formatShipLabel(name);
        ship.entity.billboard.rotation = getBillboardRotationFromHeading(course);
        ship.lastSeen = now;
        ship.lat = lat;
        ship.lon = lon;
        ship.course = course;
        ship.speed = speed;
        ship.destination = staticData.destination || '';
        ship.shipType = staticData.shipType || '';
        ship.name = name;
        ship.description = description;
        if (resetTrail) {
            resetShipTrail(ship, position);
        } else {
            appendShipTrailPoint(ship, position);
        }
        registerSearchItem('Skib', name, ship.entity, `${mmsi} ${staticData.destination || ''} ${staticData.shipType || ''}`, description, `ship:${mmsi}`);
        pruneLiveAisShips();
        scheduleAisCacheWrite();
        scheduleShipLabelRefresh();
        updateAisLiveStatus();
        return;
    }

    createLiveShipEntity({
        mmsi,
        name,
        lon,
        lat,
        course,
        speed,
        description,
        lastSeen: Date.now()
    });
    const created = liveShipEntities.get(mmsi);
    if (created) {
        created.speed = speed;
        created.destination = staticData.destination || '';
        created.shipType = staticData.shipType || '';
        registerSearchItem('Skib', name, created.entity, `${mmsi} ${created.destination} ${created.shipType}`, description, `ship:${mmsi}`);
    }
    pruneLiveAisShips();
    scheduleAisCacheWrite();
    scheduleShipLabelRefresh();
    updateAisLiveStatus();
}

function cleanupStaleAisShips() {
    const now = Date.now();
    let removedAny = false;
    liveShipEntities.forEach((ship, mmsi) => {
        if (now - ship.lastSeen <= AIS_STALE_MS) return;
        removeLiveShip(mmsi, ship);
        removedAny = true;
    });
    if (removedAny) {
        scheduleAisCacheWrite();
        scheduleShipLabelRefresh();
        updateAisLiveStatus('warn', 'Ingen live');
    }
}

function scheduleAisCacheWrite() {
    window.clearTimeout(aisCacheWriteTimer);
    aisCacheWriteTimer = window.setTimeout(writeAisShipCache, AIS_CACHE_WRITE_DEBOUNCE_MS);
}

function writeAisShipCache() {
    try {
        const now = Date.now();
        const ships = Array.from(liveShipEntities.entries())
            .map(([mmsi, ship]) => ({
                mmsi,
                lastSeen: ship.lastSeen,
                lat: ship.lat,
                lon: ship.lon,
                course: ship.course,
                speed: ship.speed,
                destination: ship.destination,
                shipType: ship.shipType,
                name: ship.name,
                description: ship.description,
                staticData: shipStaticByMmsi.get(mmsi) || null
            }))
            .filter(ship => now - ship.lastSeen <= AIS_CACHE_MAX_AGE_MS && hasFiniteNumbers(ship.lat, ship.lon))
            .sort((a, b) => b.lastSeen - a.lastSeen)
            .slice(0, AIS_CACHE_MAX_SHIPS);

        localStorage.setItem(AIS_CACHE_KEY, JSON.stringify(ships));
    } catch (e) {
        console.warn('Kunne ikke gemme AIS-cache:', e);
    }
}

function restoreAisShipCache() {
    try {
        const raw = localStorage.getItem(AIS_CACHE_KEY);
        if (!raw) return;

        const now = Date.now();
        const ships = JSON.parse(raw);
        if (!Array.isArray(ships)) return;

        ships.forEach(ship => {
            if (!ship.mmsi || !hasFiniteNumbers(ship.lat, ship.lon) || now - Number(ship.lastSeen) > AIS_CACHE_MAX_AGE_MS) {
                return;
            }

            createLiveShipEntity({
                mmsi: ship.mmsi,
                name: ship.name || `Vessel ${ship.mmsi}`,
                lon: Number(ship.lon),
                lat: Number(ship.lat),
                course: Number(ship.course),
                speed: Number(ship.speed),
                description: ship.description || `Cached AIS<br>MMSI: ${ship.mmsi}`,
                lastSeen: Number(ship.lastSeen)
            });
            const restored = liveShipEntities.get(ship.mmsi);
            if (restored) {
                restored.speed = Number(ship.speed);
                restored.destination = ship.destination || '';
                restored.shipType = ship.shipType || '';
            }
        });
        pruneLiveAisShips();
        refreshVisibleSideScope();
        updateAisLiveStatus('warn', 'Cache');
    } catch (e) {
        console.warn('Kunne ikke læse AIS-cache:', e);
    }
}

async function parseWebSocketJsonMessage(data) {
    const text = data instanceof Blob ? await data.text() : data;
    return JSON.parse(text);
}

function closeAIS() {
    window.clearTimeout(aisReconnectTimer);
    window.clearTimeout(aisSubscriptionTimer);
    aisLastScopeKey = '';

    if (aisSocket) {
        const socket = aisSocket;
        aisSocket = null;
        socket.close();
    }

    setDataStatus('status-ais', 'warn', 'Slukket');
}

function connectAIS() {
    if (!isLayerChecked('toggle-ship-traffic')) {
        closeAIS();
        return;
    }

    if (aisSocket && (aisSocket.readyState === WebSocket.OPEN || aisSocket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    if (!AIS_API_KEY) {
        setDataStatus('status-ais', 'error', 'Mangler key');
        console.warn('AIS API key mangler.');
        return;
    }

    window.clearTimeout(aisReconnectTimer);
    setDataStatus('status-ais', 'warn', 'Forbinder');
    aisSocket = new WebSocket(AIS_STREAM_URL);

    aisSocket.addEventListener('open', () => {
        updateAisLiveStatus('ok', 'Forbundet');
        aisLastScopeKey = '';
        sendAisSubscription(true);
    });

    aisSocket.addEventListener('message', async event => {
        if (!isLayerChecked('toggle-ship-traffic')) return;

        try {
            const aisData = await parseWebSocketJsonMessage(event.data);
            if (aisData.error) {
                console.warn('AISStream svar:', aisData.error);
                return;
            }
            upsertAisShip(aisData);
            cleanupStaleAisShips();
        } catch (e) {
            console.warn('AIS besked kunne ikke læses:', e);
        }
    });

    aisSocket.addEventListener('close', () => {
        if (!isLayerChecked('toggle-ship-traffic')) {
            setDataStatus('status-ais', 'warn', 'Slukket');
            return;
        }

        aisSocket = null;
        updateAisLiveStatus('warn', 'Genopretter');
        aisReconnectTimer = window.setTimeout(connectAIS, AIS_RECONNECT_MS);
    });

    aisSocket.addEventListener('error', error => {
        setDataStatus('status-ais', 'error', 'Fejl');
        console.warn('AISStream fejl:', error);
    });
}

async function updateFlights() {
    if (!isLayerChecked('toggle-planes')) return;
    if (isUpdatingFlights) return;
    const nowMs = Date.now();
    if (nowMs < flightRateLimitedUntil) {
        setDataStatus('status-flights', 'warn', 'Rate limit');
        return;
    }

    const scopeKey = getFlightScopeQueries().join('|');
    const scopeChanged = scopeKey !== lastFlightScopeKey;
    const requestGap = nowMs - lastFlightRequestAt;
    if (!scopeChanged && requestGap < FLIGHT_MIN_REQUEST_GAP_MS) return;
    if (scopeChanged && requestGap < FLIGHT_MIN_REQUEST_GAP_MS) {
        scheduleFlightUpdate(FLIGHT_MIN_REQUEST_GAP_MS - requestGap);
        return;
    }

    isUpdatingFlights = true;
    lastFlightRequestAt = nowMs;
    lastFlightScopeKey = scopeKey;
    setDataStatus('status-flights', 'warn', 'Henter');

    try {
        const data = await fetchFlightData();
        if (!Array.isArray(data.states)) return;
        setDataStatus('status-flights', 'ok', `${data.states.length} fly`);
        const now = Cesium.JulianDate.now();
        const seenFlights = new Set();

        data.states.slice(0, FLIGHT_MAX_RESULTS).forEach(flight => {
            const icao = flight[0];
            const callsign = (flight[1] || icao || 'Ukendt').trim();
            const lon = Number(flight[5]);
            const lat = Number(flight[6]);
            const altitude = Number(flight[7] || flight[13] || 10000);
            const velocityMs = Number(flight[9]);
            const heading = Number(flight[10]);

            if (!icao || !hasFiniteNumbers(lon, lat, altitude) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                return;
            }

            const position = CesiumLib.Cartesian3.fromDegrees(lon, lat, Math.max(altitude, 0));
            if (!hasValidCartesian(position)) return;

            seenFlights.add(icao);
            const originCountry = (flight[2] || 'Ukendt').trim();
            const altitudeColor = getPlaneAltitudeColor(altitude);

            const description = [
                'Live flytrafik',
                `Callsign: ${callsign}`,
                `ICAO: ${icao}`,
                `Registreret land: ${originCountry}`,
                `Højde: ${formatNumber(altitude, 0)} m`,
                `Hastighed: ${hasFiniteNumbers(velocityMs) ? formatNumber(velocityMs * 3.6, 0) : '-'} km/t`,
                `Kurs: ${hasFiniteNumbers(heading) ? formatNumber(heading, 0) : '-'}°`
            ].join('<br>');

            if (planeEntities.has(icao)) {
                const plane = planeEntities.get(icao);
                const entity = plane.entity;
                plane.positionProperty.addSample(now, position);
                plane.sampleCount += 1;
                plane.lastSeen = Date.now();
                entity.show = true;
                entity.description = description;
                entity.label.text = callsign;
                entity.billboard.rotation = getPlaneBillboardRotation(heading);
                entity.billboard.color = altitudeColor;
                entity.baseColor = altitudeColor;
                entity.path.show = plane.sampleCount >= 2;
                plane.altitude = altitude;
                plane.callsign = callsign;
                plane.country = originCountry;
                plane.lon = lon;
                plane.lat = lat;
                plane.heading = heading;
                plane.filterVisible = true;
                updatePlaneBillboardRotation(plane, position);
                registerSearchItem('Fly', callsign, entity, `${icao} ${originCountry}`, description, `plane:${icao}`);
                return;
            }

            const positionProperty = new CesiumLib.SampledPositionProperty();
            positionProperty.setInterpolationOptions({
                interpolationDegree: 1,
                interpolationAlgorithm: CesiumLib.LinearApproximation
            });
            positionProperty.forwardExtrapolationType = CesiumLib.ExtrapolationType.HOLD;
            positionProperty.forwardExtrapolationDuration = 20;
            positionProperty.addSample(now, position);

            const entity = viewer.entities.add({
                name: `Fly: ${callsign}`,
                position: positionProperty,
                billboard: {
                    image: PLANE_ICON,
                    scale: 0.45,
                    rotation: getPlaneBillboardRotation(heading),
                    alignedAxis: CesiumLib.Cartesian3.ZERO,
                    color: altitudeColor
                },
                label: {
                    text: callsign,
                    font: '9pt sans-serif',
                    pixelOffset: new CesiumLib.Cartesian2(0, -14),
                    distanceDisplayCondition: new CesiumLib.DistanceDisplayCondition(0, 900000)
                },
                path: {
                    show: false,
                    resolution: 1,
                    material: new CesiumLib.PolylineGlowMaterialProperty({
                        glowPower: 0.12,
                        color: CesiumLib.Color.YELLOW.withAlpha(0.72)
                    }),
                    width: 3,
                    leadTime: 0,
                    trailTime: FLIGHT_TRAIL_SECONDS
                },
                description
            });
            planeEntities.set(icao, {
                entity,
                positionProperty,
                sampleCount: 1,
                lastSeen: Date.now(),
                altitude,
                callsign,
                country: originCountry,
                lon,
                lat,
                heading,
                filterVisible: true
            });
            entity.baseScale = 0.45;
            entity.baseColor = altitudeColor;
            updatePlaneBillboardRotation(planeEntities.get(icao), position);
            registerSearchItem('Fly', callsign, entity, `${icao} ${originCountry}`, description, `plane:${icao}`);
        });

        planeEntities.forEach((plane, icao) => {
            if (seenFlights.has(icao) && Date.now() - plane.lastSeen <= FLIGHT_STALE_MS) {
                return;
            }

            viewer.entities.remove(plane.entity);
            planeEntities.delete(icao);
        });
    } catch (e) {
        console.warn('Fejl ved hentning af flytrafik:', e);
        if (e && e.rateLimited) {
            flightRateLimitedUntil = Date.now() + FLIGHT_RATE_LIMIT_BACKOFF_MS;
            setDataStatus('status-flights', 'warn', 'Rate limit');
        } else {
            setDataStatus('status-flights', 'error', 'Fejl');
        }
    } finally {
        isUpdatingFlights = false;
        refreshVisibleSideScope();
    }
}

function initSatellites() {
    for (let key in satellites) {
        const sat = satellites[key];

        // Gør banen blød/buet
        sat.posProperty.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: CesiumLib.LinearApproximation
        });
        sat.posProperty.forwardExtrapolationType = CesiumLib.ExtrapolationType.HOLD;
        sat.posProperty.forwardExtrapolationDuration = 30;

        sat.entity = viewer.entities.add({
            name: sat.name,
            satelliteKey: key,
            show: false,
            position: sat.posProperty,
            point: { pixelSize: 10, color: sat.color, outlineColor: CesiumLib.Color.WHITE, outlineWidth: 2 },
            label: { 
                text: sat.name, font: '12pt sans-serif', 
                pixelOffset: new CesiumLib.Cartesian2(0, -15)
            },
            path: {
                show: false,
                resolution: 1,
                material: new CesiumLib.PolylineGlowMaterialProperty({ glowPower: 0.1, color: sat.color }),
                width: 4,
                leadTime: 0,
                trailTime: 5400 // Viser ruten for de sidste 90 minutter
            }
        });
        satelliteEntities.push(sat.entity);
        registerSearchItem('Satellit', sat.name, sat.entity, key, sat.facts.join('<br>'), `sat:${key}`);
    }
}

// 4. FUNKTION: FLY-TO SATELLIT (KNAP LOGIK)
window.flyToSat = function(key) {
    const sat = satellites[key];
    if (sat && sat.entity) {
        viewer.trackedEntity = sat.entity; // Låser kameraet til satellitten
        updateSatelliteInfoPanel(key);
        showTrackedSatelliteOrbit(key);
    }
};

// 5. FUNKTION: HENT LIVE SATELLIT DATA
async function updateSatelliteData() {
    if (!isLayerChecked('toggle-sat')) return;

    const now = CesiumLib.JulianDate.now();
    for (let key in satellites) {
        const sat = satellites[key];
        try {
            if (sat.source === 'tle') {
                let tle = findTLE(key);
                if (!tle && Object.keys(tleCache).length === 0) {
                    await loadTLEData();
                    tle = findTLE(key);
                }
                if (!tle) {
                    console.warn('TLE ikke fundet for satellit:', sat.name);
                    continue;
                }
                const satrec = SatelliteLib.twoline2satrec(tle.line1, tle.line2);
                const nowDate = new Date();
                const positionAndVelocity = SatelliteLib.propagate(satrec, nowDate);
                if (!positionAndVelocity.position) {
                    console.warn('Kunne ikke propagere position for:', sat.name);
                    continue;
                }
                if (!positionAndVelocity.velocity) {
                    console.warn('Kunne ikke propagere hastighed for:', sat.name);
                    continue;
                }
                const gmst = getSatelliteGmst(nowDate);
                const positionGd = SatelliteLib.eciToGeodetic(positionAndVelocity.position, gmst);
                const longitude = SatelliteLib.degreesLong(positionGd.longitude);
                const latitude = SatelliteLib.degreesLat(positionGd.latitude);
                const altitude = positionGd.height;
                const velocity = positionAndVelocity.velocity;
                const speedKmh = Math.sqrt(
                    velocity.x * velocity.x +
                    velocity.y * velocity.y +
                    velocity.z * velocity.z
                ) * 3600;
                if (!hasFiniteNumbers(longitude, latitude, altitude, speedKmh)) {
                    console.warn('Ugyldig TLE-position for:', sat.name, { longitude, latitude, altitude, speedKmh });
                    continue;
                }
                const position = CesiumLib.Cartesian3.fromDegrees(longitude, latitude, altitude * 1000);
                addSatelliteSample(sat, now, position, {
                    altitudeKm: altitude,
                    speedKmh,
                    latitude,
                    longitude
                });
            } else {
                const response = await fetch(`https://api.wheretheiss.at/v1/satellites/${sat.id}`);
                if (response.ok) {
                    const data = await response.json();
                    if (!hasFiniteNumbers(data.longitude, data.latitude, data.altitude, data.velocity)) {
                        console.warn('Ugyldig API-position for:', sat.name, data);
                        continue;
                    }
                    const position = CesiumLib.Cartesian3.fromDegrees(
                        parseFloat(data.longitude), 
                        parseFloat(data.latitude), 
                        data.altitude * 1000
                    );
                    addSatelliteSample(sat, now, position, {
                        altitudeKm: Number(data.altitude),
                        speedKmh: Number(data.velocity),
                        latitude: Number(data.latitude),
                        longitude: Number(data.longitude)
                    });
                }
            }
        } catch (e) {
            console.error("Fejl ved hentning af satellit: " + sat.name, e);
        }
    }
    refreshVisibleSideScope();
}

// 6. FUNKTION: JORDSKÆLV LAG
async function initEarthquakes() {
    try {
        const res = await fetch('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson');
        const data = await res.json();
        data.features.forEach(quake => {
            const coords = quake.geometry.coordinates;
            const mag = quake.properties.mag;
            if (!coords || !hasFiniteNumbers(coords[0], coords[1], mag)) {
                console.warn('Springer ugyldigt jordskælv over:', quake.properties.place, { coords, mag });
                return;
            }
            const radius = Math.max(Number(mag), 0.1) * 25000;
            const position = Cesium.Cartesian3.fromDegrees(Number(coords[0]), Number(coords[1]), 0);
            if (!hasValidCartesian(position)) {
                console.warn('Springer jordskælv med ugyldig Cesium-position over:', quake.properties.place, { coords, mag });
                return;
            }
            const ent = viewer.entities.add({
                name: quake.properties.place,
                position,
                ellipse: {
                    semiMinorAxis: radius,
                    semiMajorAxis: radius,
                    height: 0,
                    material: Cesium.Color.ORANGE.withAlpha(0.4),
                    outline: true, outlineColor: Cesium.Color.WHITE
                }
            });
            ent.description = `Jordskælv<br>Sted: ${quake.properties.place}<br>Magnitude: ${formatNumber(mag, 1)}`;
            quakeEntities.push(ent);
            registerSearchItem('Jordskælv', quake.properties.place, ent, `magnitude ${mag}`, ent.description, `quake:${quake.id || quake.properties.time || quake.properties.place}`);
        });
        refreshVisibleSideScope();
    } catch (e) { console.error("Quake fejl", e); }
}

function initWeatherLayer() {
    const bands = [
        { name: 'Jetstream Nordatlanten', west: -75, south: 42, east: 5, north: 62, color: Cesium.Color.CYAN.withAlpha(0.12) },
        { name: 'Tropisk fugtbælte', west: -180, south: -8, east: 180, north: 10, color: Cesium.Color.LIME.withAlpha(0.08) },
        { name: 'Indiske Ocean monsunzone', west: 45, south: -15, east: 105, north: 22, color: Cesium.Color.BLUE.withAlpha(0.10) },
        { name: 'Stillehav stormspor vest', west: 135, south: 28, east: 180, north: 55, color: Cesium.Color.CYAN.withAlpha(0.10) },
        { name: 'Stillehav stormspor øst', west: -180, south: 28, east: -125, north: 55, color: Cesium.Color.CYAN.withAlpha(0.10) }
    ];

    bands.forEach(band => {
        const entity = viewer.entities.add({
            name: band.name,
            show: false,
            rectangle: {
                coordinates: Cesium.Rectangle.fromDegrees(band.west, band.south, band.east, band.north),
                height: 0,
                material: band.color,
                outline: true,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.18)
            },
            description: `Vejrzone<br>${band.name}`
        });
        weatherEntities.push(entity);
        registerSearchItem('Vejr', band.name, entity, 'weather wind storm vejr', entity.description, `weather:${band.name}`);
    });
}

function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const nextChar = text[i + 1];

        if (char === '"') {
            if (inQuotes && nextChar === '"') {
                field += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === ',' && !inQuotes) {
            row.push(field);
            field = '';
            continue;
        }

        if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && nextChar === '\n') {
                i += 1;
            }
            row.push(field);
            if (row.some(value => value !== '')) {
                rows.push(row);
            }
            row = [];
            field = '';
            continue;
        }

        field += char;
    }

    row.push(field);
    if (row.some(value => value !== '')) {
        rows.push(row);
    }

    return rows;
}

function airportSortScore(airport) {
    const typeRank = AIRPORT_TYPE_RANK[airport.type] ?? 9;
    const scheduledRank = airport.scheduled_service === 'yes' ? 0 : 1;
    const iataRank = airport.iata_code ? 0 : 1;
    return typeRank * 100 + scheduledRank * 10 + iataRank;
}

async function initAirports() {
    try {
        setDataStatus('status-airports', 'warn', 'Henter');
        const response = await fetch('/api/airports');
        if (!response.ok) {
            setDataStatus('status-airports', 'error', `Fejl ${response.status}`);
            console.warn('Kunne ikke hente lufthavne:', response.status, response.statusText);
            return;
        }

        const csv = await response.text();
        const rows = parseCsvRows(csv);
        const headers = rows.shift();
        if (!headers) return;

        const airports = rows
            .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] || ''])))
            .filter(airport => AIRPORT_TYPE_RANK[airport.type] !== undefined)
            .filter(airport => airport.type !== 'closed' && hasFiniteNumbers(airport.longitude_deg, airport.latitude_deg))
            .sort((a, b) => {
                const scoreDiff = airportSortScore(a) - airportSortScore(b);
                if (scoreDiff !== 0) return scoreDiff;
                return a.name.localeCompare(b.name);
            })
            .slice(0, AIRPORT_MAX_RESULTS);

        airports.forEach(airport => {
            const lon = Number(airport.longitude_deg);
            const lat = Number(airport.latitude_deg);
            const elevationMeters = hasFiniteNumbers(airport.elevation_ft) ? Number(airport.elevation_ft) * 0.3048 : 0;
            const iata = airport.iata_code || airport.ident || '-';
            const municipality = airport.municipality || '-';
            const country = airport.iso_country || '-';
            const typeName = airport.type.replace('_', ' ');
            const position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(elevationMeters, 0) + 25);

            if (!hasValidCartesian(position)) return;

            const entity = viewer.entities.add({
                name: `${airport.name} (${iata})`,
                position,
                billboard: {
                    image: AIRPORT_ICON,
                    scale: airport.type === 'large_airport' ? 0.55 : 0.42,
                    disableDepthTestDistance: ALWAYS_SHOW_BILLBOARD_DISTANCE
                },
                label: {
                    text: iata,
                    font: '8pt sans-serif',
                    fillColor: Cesium.Color.WHITE,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 2,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    pixelOffset: new Cesium.Cartesian2(0, -18),
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 700000)
                },
                description: [
                    'Lufthavn',
                    `Navn: ${airport.name}`,
                    `Kode: ${iata}`,
                    `Type: ${typeName}`,
                    `By: ${municipality}`,
                    `Land: ${country}`,
                    `Højde: ${formatNumber(elevationMeters, 0)} m`
                ].join('<br>')
            });

            entity.airportType = airport.type;
            entity.baseScale = airport.type === 'large_airport' ? 0.55 : 0.42;
            entity.filterVisible = true;
            entity.zoomVisible = true;
            airportEntities.push(entity);
            registerSearchItem('Lufthavn', entity.name, entity, `${iata} ${airport.ident} ${municipality} ${country} ${airport.type}`, entity.description, `airport:${airport.ident}`);
        });

        refreshVisibleSideScope();
        setDataStatus('status-airports', 'ok', `${airportEntities.length} vist`);
    } catch (e) {
        setDataStatus('status-airports', 'error', 'Fejl');
        console.warn('Fejl ved hentning af lufthavne:', e);
    }
}

// 7. FUNKTION: MARITIME LAG (SKIBE & MILITÆR)
function initMaritimeLayers() {
    const civilSpots = [
        { name: "Port of Shanghai", pos: [121.49, 31.23] },
        { name: "Port of Singapore", pos: [103.75, 1.26] },
        { name: "Port of Ningbo-Zhoushan", pos: [122.10, 29.87] },
        { name: "Port of Shenzhen", pos: [114.27, 22.56] },
        { name: "Port of Guangzhou", pos: [113.45, 22.93] },
        { name: "Port of Qingdao", pos: [120.32, 36.06] },
        { name: "Port of Busan", pos: [129.08, 35.10] },
        { name: "Port of Tianjin", pos: [117.75, 39.00] },
        { name: "Port of Hong Kong", pos: [114.16, 22.29] },
        { name: "Port of Rotterdam", pos: [4.40, 51.90] },
        { name: "Port Klang", pos: [101.39, 3.00] },
        { name: "Port of Antwerp-Bruges", pos: [4.31, 51.26] },
        { name: "Port of Kaohsiung", pos: [120.29, 22.61] },
        { name: "Port of Xiamen", pos: [118.07, 24.45] },
        { name: "Port of Tanjung Pelepas", pos: [103.55, 1.36] },
        { name: "Port of Laem Chabang", pos: [100.88, 13.08] },
        { name: "Port of Los Angeles", pos: [-118.26, 33.74] },
        { name: "Port of Long Beach", pos: [-118.21, 33.76] },
        { name: "Port of Hamburg", pos: [9.99, 53.54] },
        { name: "Port of New York and New Jersey", pos: [-74.04, 40.67] },
        { name: "Port of Tanjung Priok", pos: [106.89, -6.10] },
        { name: "Port of Ho Chi Minh City", pos: [106.75, 10.75] },
        { name: "Port of Colombo", pos: [79.84, 6.95] },
        { name: "Port of Jebel Ali", pos: [55.03, 25.01] },
        { name: "Port of Jawaharlal Nehru", pos: [72.95, 18.95] },
        { name: "Port of Mundra", pos: [69.70, 22.74] },
        { name: "Port of Felixstowe", pos: [1.31, 51.95] },
        { name: "Port of Piraeus", pos: [23.63, 37.94] },
        { name: "Port of Valencia", pos: [-0.32, 39.45] },
        { name: "Port of Algeciras", pos: [-5.44, 36.13] },
        { name: "Port of Bremerhaven", pos: [8.58, 53.55] },
        { name: "Port of Le Havre", pos: [0.12, 49.49] },
        { name: "Port of Barcelona", pos: [2.16, 41.34] },
        { name: "Port of Genoa", pos: [8.92, 44.41] },
        { name: "Port of Gioia Tauro", pos: [15.90, 38.44] },
        { name: "Port of Marsaxlokk", pos: [14.54, 35.84] },
        { name: "Port Said", pos: [32.31, 31.27] },
        { name: "Suez Canal Container Terminal", pos: [32.34, 31.23] },
        { name: "Port of Tanger Med", pos: [-5.81, 35.89] },
        { name: "Port of Durban", pos: [31.02, -29.88] },
        { name: "Port of Mombasa", pos: [39.65, -4.04] },
        { name: "Port of Lagos", pos: [3.36, 6.44] },
        { name: "Port of Tema", pos: [0.01, 5.64] },
        { name: "Port of Abidjan", pos: [-4.02, 5.29] },
        { name: "Port of Dakar", pos: [-17.43, 14.68] },
        { name: "Port of Casablanca", pos: [-7.62, 33.61] },
        { name: "Port of Alexandria", pos: [29.88, 31.20] },
        { name: "Port of Damietta", pos: [31.77, 31.47] },
        { name: "Port of King Abdullah", pos: [39.10, 22.38] },
        { name: "Jeddah Islamic Port", pos: [39.15, 21.45] },
        { name: "Port of Salalah", pos: [54.01, 16.94] },
        { name: "Port Sultan Qaboos", pos: [58.57, 23.63] },
        { name: "Hamad Port", pos: [51.62, 24.80] },
        { name: "Port of Dammam", pos: [50.21, 26.50] },
        { name: "Port of Kuwait Shuwaikh", pos: [47.93, 29.36] },
        { name: "Port of Manama", pos: [50.61, 26.24] },
        { name: "Port of Umm Qasr", pos: [47.94, 30.04] },
        { name: "Port of Bandar Abbas", pos: [56.28, 27.14] },
        { name: "Port of Chabahar", pos: [60.61, 25.30] },
        { name: "Port of Karachi", pos: [66.98, 24.84] },
        { name: "Port Qasim", pos: [67.33, 24.78] },
        { name: "Port of Chittagong", pos: [91.81, 22.31] },
        { name: "Port of Yangon", pos: [96.16, 16.77] },
        { name: "Port of Manila", pos: [120.96, 14.59] },
        { name: "Port of Subic Bay", pos: [120.23, 14.82] },
        { name: "Port of Batangas", pos: [121.05, 13.75] },
        { name: "Port of Cebu", pos: [123.90, 10.30] },
        { name: "Port of Davao", pos: [125.61, 7.09] },
        { name: "Port of Tokyo", pos: [139.78, 35.61] },
        { name: "Port of Yokohama", pos: [139.65, 35.45] },
        { name: "Port of Nagoya", pos: [136.86, 35.08] },
        { name: "Port of Kobe", pos: [135.20, 34.68] },
        { name: "Port of Osaka", pos: [135.43, 34.65] },
        { name: "Port of Kitakyushu", pos: [130.88, 33.93] },
        { name: "Port of Incheon", pos: [126.59, 37.45] },
        { name: "Port of Gwangyang", pos: [127.73, 34.90] },
        { name: "Port of Ulsan", pos: [129.38, 35.50] },
        { name: "Port of Dalian", pos: [121.66, 38.92] },
        { name: "Port of Yingkou", pos: [122.23, 40.67] },
        { name: "Port of Lianyungang", pos: [119.45, 34.75] },
        { name: "Port of Suzhou", pos: [120.62, 31.34] },
        { name: "Port of Fuzhou", pos: [119.46, 26.02] },
        { name: "Port of Haiphong", pos: [106.68, 20.86] },
        { name: "Port of Cai Mep", pos: [107.03, 10.55] },
        { name: "Port of Bangkok", pos: [100.56, 13.70] },
        { name: "Port of Sihanoukville", pos: [103.51, 10.63] },
        { name: "Port of Sydney", pos: [151.21, -33.86] },
        { name: "Port Botany", pos: [151.22, -33.97] },
        { name: "Port of Melbourne", pos: [144.91, -37.84] },
        { name: "Port of Brisbane", pos: [153.17, -27.38] },
        { name: "Port of Fremantle", pos: [115.74, -32.05] },
        { name: "Port of Auckland", pos: [174.78, -36.84] },
        { name: "Port of Tauranga", pos: [176.18, -37.66] },
        { name: "Port of Vancouver", pos: [-123.11, 49.29] },
        { name: "Port of Prince Rupert", pos: [-130.32, 54.31] },
        { name: "Port of Seattle", pos: [-122.34, 47.60] },
        { name: "Port of Tacoma", pos: [-122.41, 47.27] },
        { name: "Port of Oakland", pos: [-122.32, 37.80] },
        { name: "Port of Savannah", pos: [-81.14, 32.08] },
        { name: "Port of Houston", pos: [-95.27, 29.73] }
    ];

    const militarySpots = [
        { name: "Naval Station Norfolk (USA)", pos: [-76.32, 36.95] },
        { name: "Naval Base San Diego (USA)", pos: [-117.13, 32.68] },
        { name: "Joint Base Pearl Harbor-Hickam (USA)", pos: [-157.94, 21.35] },
        { name: "Naval Base Kitsap (USA)", pos: [-122.71, 47.56] },
        { name: "Naval Station Mayport (USA)", pos: [-81.39, 30.39] },
        { name: "Naval Submarine Base Kings Bay (USA)", pos: [-81.56, 30.80] },
        { name: "Naval Submarine Base New London (USA)", pos: [-72.08, 41.39] },
        { name: "Naval Station Everett (USA)", pos: [-122.22, 47.99] },
        { name: "Naval Base Ventura County (USA)", pos: [-119.20, 34.17] },
        { name: "Naval Station Rota (Spain/USA)", pos: [-6.35, 36.62] },
        { name: "NSA Souda Bay (Greece/USA)", pos: [24.14, 35.49] },
        { name: "Naval Support Activity Bahrain", pos: [50.58, 26.20] },
        { name: "Camp Lemonnier Djibouti", pos: [43.15, 11.55] },
        { name: "Guantanamo Bay Naval Base", pos: [-75.14, 19.91] },
        { name: "Portsmouth Naval Base (UK)", pos: [-1.11, 50.81] },
        { name: "Devonport Naval Base (UK)", pos: [-4.18, 50.39] },
        { name: "HMNB Clyde Faslane (UK)", pos: [-4.82, 56.07] },
        { name: "Rosyth Dockyard (UK)", pos: [-3.45, 56.02] },
        { name: "Gibraltar Naval Base (UK)", pos: [-5.36, 36.14] },
        { name: "Brest Naval Base (France)", pos: [-4.49, 48.38] },
        { name: "Toulon Naval Base (France)", pos: [5.92, 43.12] },
        { name: "Cherbourg Naval Base (France)", pos: [-1.62, 49.64] },
        { name: "Lorient Naval Base (France)", pos: [-3.36, 47.74] },
        { name: "Kiel Naval Base (Germany)", pos: [10.15, 54.33] },
        { name: "Wilhelmshaven Naval Base (Germany)", pos: [8.15, 53.53] },
        { name: "Eckernforde Naval Base (Germany)", pos: [9.84, 54.48] },
        { name: "Den Helder Naval Base (Netherlands)", pos: [4.76, 52.96] },
        { name: "Zeebrugge Naval Base (Belgium)", pos: [3.19, 51.34] },
        { name: "Karlskrona Naval Base (Sweden)", pos: [15.59, 56.16] },
        { name: "Muskö Naval Base (Sweden)", pos: [18.12, 59.00] },
        { name: "Haakonsvern Naval Base (Norway)", pos: [5.22, 60.33] },
        { name: "Frederikshavn Naval Base (Denmark)", pos: [10.54, 57.44] },
        { name: "Korsoer Naval Station (Denmark)", pos: [11.14, 55.33] },
        { name: "Turku/Pansio Naval Base (Finland)", pos: [22.12, 60.44] },
        { name: "Upinniemi Naval Base (Finland)", pos: [24.34, 60.04] },
        { name: "Gdynia Naval Base (Poland)", pos: [18.55, 54.53] },
        { name: "Swietoujscie Naval Base (Poland)", pos: [14.25, 53.91] },
        { name: "La Spezia Naval Base (Italy)", pos: [9.83, 44.10] },
        { name: "Taranto Naval Base (Italy)", pos: [17.23, 40.47] },
        { name: "Augusta Naval Base (Italy)", pos: [15.22, 37.23] },
        { name: "Cartagena Naval Base (Spain)", pos: [-0.98, 37.60] },
        { name: "Ferrol Naval Base (Spain)", pos: [-8.24, 43.48] },
        { name: "Lisbon Naval Base (Portugal)", pos: [-9.12, 38.70] },
        { name: "Athens Salamis Naval Base (Greece)", pos: [23.49, 37.96] },
        { name: "Aksaz Naval Base (Turkey)", pos: [28.39, 36.84] },
        { name: "Golcuk Naval Base (Turkey)", pos: [29.82, 40.72] },
        { name: "Constanta Naval Base (Romania)", pos: [28.65, 44.17] },
        { name: "Varna Naval Base (Bulgaria)", pos: [27.91, 43.20] },
        { name: "Sevastopol Naval Base (Russia)", pos: [33.53, 44.62] },
        { name: "Novorossiysk Naval Base (Russia)", pos: [37.80, 44.72] },
        { name: "Baltiysk Naval Base (Russia)", pos: [19.91, 54.64] },
        { name: "Kronstadt Naval Base (Russia)", pos: [29.77, 59.99] },
        { name: "Severomorsk Naval Base (Russia)", pos: [33.42, 69.07] },
        { name: "Polyarny Naval Base (Russia)", pos: [33.45, 69.20] },
        { name: "Vladivostok Naval Base (Russia)", pos: [131.89, 43.10] },
        { name: "Vilyuchinsk Naval Base (Russia)", pos: [158.41, 52.91] },
        { name: "Tartus Naval Facility (Syria/Russia)", pos: [35.87, 34.89] },
        { name: "Alexandria Naval Base (Egypt)", pos: [29.88, 31.20] },
        { name: "Mers El Kebir Naval Base (Algeria)", pos: [-0.70, 35.73] },
        { name: "Casablanca Naval Base (Morocco)", pos: [-7.62, 33.61] },
        { name: "Simonstown Naval Base (South Africa)", pos: [18.43, -34.19] },
        { name: "Durban Naval Base (South Africa)", pos: [31.02, -29.88] },
        { name: "Lagos Naval Base (Nigeria)", pos: [3.36, 6.44] },
        { name: "Mombasa Naval Base (Kenya)", pos: [39.65, -4.04] },
        { name: "Jeddah Naval Base (Saudi Arabia)", pos: [39.15, 21.45] },
        { name: "Jubail Naval Base (Saudi Arabia)", pos: [49.66, 27.00] },
        { name: "Abu Dhabi Naval Base (UAE)", pos: [54.37, 24.48] },
        { name: "Jebel Ali Naval Facility (UAE)", pos: [55.03, 25.01] },
        { name: "Karachi Naval Dockyard (Pakistan)", pos: [66.98, 24.84] },
        { name: "Mumbai Naval Dockyard (India)", pos: [72.84, 18.93] },
        { name: "Visakhapatnam Naval Base (India)", pos: [83.29, 17.69] },
        { name: "Kochi Naval Base (India)", pos: [76.27, 9.97] },
        { name: "Karwar INS Kadamba (India)", pos: [74.09, 14.82] },
        { name: "Port Blair Naval Base (India)", pos: [92.75, 11.67] },
        { name: "Trincomalee Naval Base (Sri Lanka)", pos: [81.23, 8.56] },
        { name: "Chittagong Naval Base (Bangladesh)", pos: [91.81, 22.31] },
        { name: "Sattahip Naval Base (Thailand)", pos: [100.91, 12.66] },
        { name: "Ream Naval Base (Cambodia)", pos: [103.69, 10.51] },
        { name: "Cam Ranh Bay Naval Base (Vietnam)", pos: [109.20, 11.91] },
        { name: "Changi Naval Base (Singapore)", pos: [104.03, 1.32] },
        { name: "Lumut Naval Base (Malaysia)", pos: [100.61, 4.23] },
        { name: "Tanjung Priok Naval Base (Indonesia)", pos: [106.89, -6.10] },
        { name: "Surabaya Naval Base (Indonesia)", pos: [112.73, -7.21] },
        { name: "Subic Bay Naval Base (Philippines)", pos: [120.23, 14.82] },
        { name: "Sasebo Naval Base (Japan)", pos: [129.72, 33.16] },
        { name: "Yokosuka Naval Base (Japan)", pos: [139.67, 35.28] },
        { name: "Kure Naval Base (Japan)", pos: [132.55, 34.24] },
        { name: "Maizuru Naval Base (Japan)", pos: [135.39, 35.47] },
        { name: "Jinhae Naval Base (South Korea)", pos: [128.66, 35.14] },
        { name: "Busan Naval Base (South Korea)", pos: [129.08, 35.10] },
        { name: "Jeju Naval Base (South Korea)", pos: [126.49, 33.23] },
        { name: "Qingdao Naval Base (China)", pos: [120.32, 36.06] },
        { name: "Ningbo-Zhoushan Naval Base (China)", pos: [122.10, 29.87] },
        { name: "Sanya Yulin Naval Base (China)", pos: [109.50, 18.21] },
        { name: "Zhanjiang Naval Base (China)", pos: [110.40, 21.20] },
        { name: "Keelung Naval Base (Taiwan)", pos: [121.75, 25.13] },
        { name: "Kaohsiung Naval Base (Taiwan)", pos: [120.29, 22.61] },
        { name: "Fleet Base East Sydney (Australia)", pos: [151.23, -33.85] },
        { name: "Fleet Base West HMAS Stirling (Australia)", pos: [115.69, -32.24] },
        { name: "Devonport Naval Base (New Zealand)", pos: [174.81, -36.83] }
    ];

    civilSpots.forEach(s => {
        const ent = viewer.entities.add({
            name: s.name, position: Cesium.Cartesian3.fromDegrees(s.pos[0], s.pos[1]),
            billboard: {
                image: 'https://img.icons8.com/color/48/000000/cargo-ship.png',
                scale: 0.6,
                disableDepthTestDistance: ALWAYS_SHOW_BILLBOARD_DISTANCE
            }
        });
        ent.baseScale = 0.6;
        ent.filterVisible = true;
        ent.zoomVisible = true;
        ent.description = `Civil havn<br>${s.name}`;
        shipEntities.push(ent);
        registerSearchItem('Havn', s.name, ent, 'civil port havn', ent.description, `port:${s.name}`);
    });

    militarySpots.forEach(m => {
        const ent = viewer.entities.add({
            name: m.name, position: Cesium.Cartesian3.fromDegrees(m.pos[0], m.pos[1]),
            billboard: {
                image: 'https://img.icons8.com/color/48/000000/battleship.png',
                scale: 0.7,
                disableDepthTestDistance: ALWAYS_SHOW_BILLBOARD_DISTANCE
            }
        });
        ent.baseScale = 0.7;
        ent.filterVisible = true;
        ent.zoomVisible = true;
        ent.description = `Militær flådebase<br>${m.name}`;
        militaryEntities.push(ent);
        registerSearchItem('Flådebase', m.name, ent, 'military naval base', ent.description, `naval:${m.name}`);
    });
    refreshVisibleSideScope();
}

// 8. EVENT LISTENERS: TOGGLE LAYERS
const debouncedScopeRefresh = debounce(refreshVisibleSideScope, UI_INPUT_DEBOUNCE_MS);
const debouncedSearch = debounce(runSearch, UI_INPUT_DEBOUNCE_MS);
const layerGroups = [
    {
        parentId: 'toggle-space-air',
        children: [
            'toggle-sat',
            'toggle-all-satellites',
            ...Object.values(ALL_SATELLITE_CATEGORY_TOGGLES),
            'toggle-airports',
            'toggle-planes'
        ]
    },
    {
        parentId: 'toggle-water',
        children: ['toggle-ships', 'toggle-ship-traffic', 'toggle-ship-trails', 'toggle-military']
    },
    {
        parentId: 'toggle-nature-light',
        children: ['toggle-quakes', 'toggle-weather', 'toggle-daynight']
    }
];

function setCheckboxState(id, checked) {
    const element = document.getElementById(id);
    if (element) {
        element.checked = checked;
        element.indeterminate = false;
    }
}

function syncLayerGroupState(group) {
    const parent = document.getElementById(group.parentId);
    if (!parent) return;

    const children = group.children
        .map(id => document.getElementById(id))
        .filter(Boolean);
    const checkedCount = children.filter(child => child.checked).length;

    parent.checked = children.length > 0 && checkedCount === children.length;
    parent.indeterminate = checkedCount > 0 && checkedCount < children.length;
}

function syncLayerGroupStates() {
    layerGroups.forEach(syncLayerGroupState);
}

function applyLayerSideEffects() {
    refreshVisibleSideScope();
    setAllSatellitesVisible(isLayerChecked('toggle-all-satellites'));
    setWeatherVisible(isLayerChecked('toggle-weather'));
    setShipTrailsVisible(isLayerChecked('toggle-ship-trails'));
    viewer.scene.globe.enableLighting = isLayerChecked('toggle-daynight');
    refreshAllVisibleSatelliteTraces();
    updateSatelliteControlPanel();

    if (isLayerChecked('toggle-ship-traffic')) {
        connectAIS();
        sendAisSubscription(true);
    } else {
        closeAIS();
    }

    if (isLayerChecked('toggle-planes')) {
        scheduleFlightUpdate(0);
    }
}

function addLayerToggleListener(id, handler) {
    addOptionalEventListener(id, 'change', event => {
        handler(event);
        syncLayerGroupStates();
    });
}

layerGroups.forEach(group => {
    addOptionalEventListener(group.parentId, 'change', event => {
        group.children.forEach(id => setCheckboxState(id, event.target.checked));
        applyLayerSideEffects();
        syncLayerGroupStates();
    });
});

addLayerToggleListener('toggle-sat', event => {
    refreshVisibleSideScope();
    if (event.target.checked) {
        updateSatelliteData();
    }
});
addLayerToggleListener('toggle-all-satellites', event => {
    Object.values(ALL_SATELLITE_CATEGORY_TOGGLES).forEach(id => setCheckboxState(id, event.target.checked));
    setAllSatellitesVisible(event.target.checked);
    refreshAllVisibleSatelliteTraces();
    updateSatelliteControlPanel();
});
Object.values(ALL_SATELLITE_CATEGORY_TOGGLES).forEach(id => {
    addLayerToggleListener(id, event => {
        const enabledCategoryCount = Object.values(ALL_SATELLITE_CATEGORY_TOGGLES)
            .map(toggleId => document.getElementById(toggleId))
            .filter(Boolean)
            .filter(toggle => toggle.checked).length;

        setCheckboxState('toggle-all-satellites', enabledCategoryCount > 0);
        if (event.target.checked) {
            setAllSatellitesVisible(true);
        } else {
            updateAllSatelliteCategoryVisibility();
        }
        refreshAllVisibleSatelliteTraces();
    });
});
addLayerToggleListener('toggle-quakes', event => {
    if (event.target.checked && quakeEntities.length === 0) {
        initEarthquakes();
    }
    refreshVisibleSideScope();
});
addLayerToggleListener('toggle-ships', refreshVisibleSideScope);
addLayerToggleListener('toggle-ship-traffic', event => {
    refreshVisibleSideScope();
    if (event.target.checked) {
        connectAIS();
        sendAisSubscription(true);
    } else {
        closeAIS();
    }
});
addLayerToggleListener('toggle-ship-trails', () => {
    setShipTrailsVisible(isLayerChecked('toggle-ship-trails'));
});
addLayerToggleListener('toggle-planes', event => {
    refreshVisibleSideScope();
    if (event.target.checked) {
        scheduleFlightUpdate(0);
    }
});
addLayerToggleListener('toggle-airports', refreshVisibleSideScope);
addLayerToggleListener('toggle-military', refreshVisibleSideScope);
addLayerToggleListener('toggle-weather', event => {
    setWeatherVisible(event.target.checked);
});
addLayerToggleListener('toggle-daynight', event => {
    viewer.scene.globe.enableLighting = event.target.checked;
});
syncLayerGroupStates();

addLayerToggleListener('toggle-visible-satellite-traces', () => {
    updateTrackedSatelliteTraceVisibility();
    refreshAllVisibleSatelliteTraces();
    refreshAllSatelliteTrace();
    updateSatelliteControlPanel();
});
addOptionalEventListener('clear-satellite-trace', 'click', () => {
    clearAllSatelliteTrace();
    clearTrackedSatelliteOrbit();
});
addOptionalEventListener('close-satellite-info', 'click', hideSatelliteInfoPanel);
addOptionalEventListener('find-iss', 'click', () => flyToSat('iss'));
addOptionalEventListener('find-tiangong', 'click', () => flyToSat('tiangong'));

['filter-ship-speed', 'filter-ship-type', 'filter-plane-altitude', 'filter-airport-type'].forEach(id => {
    const element = document.getElementById(id);
    if (element) {
        element.addEventListener('input', debouncedScopeRefresh);
        element.addEventListener('change', refreshVisibleSideScope);
    }
});

addOptionalEventListener('search-box', 'input', debouncedSearch);
addOptionalEventListener('add-watchlist-item', 'click', () => {
    addWatchlistItem(getInputValue('watchlist-input'));
    const input = document.getElementById('watchlist-input');
    if (input) input.value = '';
});
addOptionalEventListener('close-detail-panel', 'click', hideDetailPanel);
addOptionalEventListener('detail-watch', 'click', () => {
    addWatchlistItem(selectedDetailItem);
});

viewer.camera.moveEnd.addEventListener(() => {
    refreshVisibleSideScope();
    updatePlaneBillboardRotations();
    refreshAllVisibleSatelliteTraces();
    scheduleFlightUpdate();
    scheduleAisSubscription();
});

// 9. HØJDEMÅLER LOGIK
viewer.scene.postRender.addEventListener(() => {
    const now = performance.now();
    if (now - lastAltitudeDisplayUpdateAt < ALTITUDE_DISPLAY_UPDATE_MS) return;

    const cameraHeight = viewer.camera.positionCartographic.height;
    const text = `Højde: ${(cameraHeight / 1000).toFixed(1)} km`;
    if (text === lastAltitudeDisplayText) return;

    const altitudeDisplay = document.getElementById('altitude-display');
    if (altitudeDisplay) {
        altitudeDisplay.innerText = text;
    }
    lastAltitudeDisplayText = text;
    lastAltitudeDisplayUpdateAt = now;
});

// KØR ALT VED START
initTabs();
loadWatchlist();
viewer.scene.globe.enableLighting = isLayerChecked('toggle-daynight');
initDetailPicking();
initSatellites();
if (isLayerChecked('toggle-quakes')) {
    initEarthquakes();
}
initWeatherLayer();
initMaritimeLayers();
initAirports();
restoreAisShipCache();
if (isLayerChecked('toggle-ship-traffic')) {
    connectAIS();
}
if (isLayerChecked('toggle-planes')) {
    scheduleFlightUpdate(0);
}
updateSatelliteData();
setInterval(updateSatelliteData, 5000);
setInterval(() => scheduleFlightUpdate(0), FLIGHT_UPDATE_INTERVAL_MS);





// 1. DIN CESIUM ION TOKEN
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI5NTBiY2Q0NS02ZDc4LTRkOWEtYmIzYS0yZDdmM2MzMGU3NmIiLCJpZCI6NDE5MDQwLCJpYXQiOjE3NzY3NzIzODR9.pGxmdND27nVBk6Wi2I4t_dUYq1ytFnbmYnwLH53Vnro';
const AIS_API_KEY = '1d99e78a9c489a3a0310b6c016af3bf4c2319e5c';
const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const AIS_RECONNECT_MS = 10000;
const AIS_SUBSCRIPTION_DEBOUNCE_MS = 2500;
const AIS_MIN_SUBSCRIPTION_GAP_MS = 5000;
const AIS_VIEW_PADDING_DEGREES = 0.75;
const AIS_MAX_LAT_SPAN_DEGREES = 18;
const AIS_MAX_LON_SPAN_DEGREES = 28;
const AIS_STALE_MS = 10 * 60 * 1000;
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
const PLANE_ICON_HEADING_OFFSET_RADIANS = Cesium.Math.PI_OVER_TWO;

// 2. INITIALISÉR VIEWERS (Rettet version uden createWorldTerrain-fejl)
const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(), // Den korrekte måde i nyere versioner
    baseLayerPicker: true,
    geocoder: false,
    homeButton: false,
    shouldAnimate: true
});

viewer.scene.globe.depthTestAgainstTerrain = true;

viewer.camera.setView({
    destination: PERSIAN_GULF_VIEW
});

// Lister til styring af lag (Layers)
const satelliteEntities = [];
const quakeEntities = [];
const shipEntities = [];
const militaryEntities = [];
const liveShipEntities = new Map();
const planeEntities = new Map();

// Konfiguration af satellitter
const satellites = {
    iss: { 
        id: '25544', 
        name: 'ISS (International)', 
        color: Cesium.Color.RED, 
        source: 'api',
        orbitPeriodMinutes: 93,
        facts: [
            'ISS er cirka pÃ¥ stÃ¸rrelse med en fodboldbane.',
            'Den har typisk 7 astronauter ombord.',
            'Den ser omkring 16 solopgange i dÃ¸gnet.'
        ],
        posProperty: new Cesium.SampledPositionProperty(),
        sampleCount: 0,
        telemetry: null,
        entity: null 
    },
    tiangong: { 
        id: '48274', 
        name: 'Tiangong (Kina)', 
        color: Cesium.Color.CYAN, 
        source: 'tle',
        tleName: 'CSS (TIANHE)',
        orbitPeriodMinutes: 92,
        facts: [
            'Tiangong betyder "Himmelsk Palads".',
            'Rumstationen bestÃ¥r af modulerne Tianhe, Wentian og Mengtian.',
            'Den kredser lavt om Jorden, ligesom ISS.'
        ],
        posProperty: new Cesium.SampledPositionProperty(),
        sampleCount: 0,
        telemetry: null,
        entity: null 
    }
};

const TLE_SOURCE_URL = 'https://celestrak.com/NORAD/elements/stations.txt';
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

function setMapEntitiesVisible(entities, visible) {
    entities.forEach(item => {
        const entity = item.entity || item;
        entity.show = visible;
    });
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
        entity.show = visible && isEntityOnVisibleSide(entity, occluder);
    });
}

function applyVisibleSideScope() {
    const occluder = new Cesium.EllipsoidalOccluder(
        viewer.scene.globe.ellipsoid,
        viewer.camera.positionWC
    );

    setScopedEntityVisibility(satelliteEntities, isLayerChecked('toggle-sat'), occluder);
    setScopedEntityVisibility(quakeEntities, isLayerChecked('toggle-quakes'), occluder);
    setScopedEntityVisibility(shipEntities, isLayerChecked('toggle-ships'), occluder);
    setScopedEntityVisibility(liveShipEntities, isLayerChecked('toggle-ship-traffic'), occluder);
    setScopedEntityVisibility(planeEntities, isLayerChecked('toggle-planes'), occluder);
    setScopedEntityVisibility(militaryEntities, isLayerChecked('toggle-military'), occluder);
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
    canvas.width = 48;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.translate(24, 24);
    ctx.fillStyle = '#1e9bff';
    ctx.strokeStyle = '#07345c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(13, -7);
    ctx.lineTo(10, 14);
    ctx.lineTo(0, 22);
    ctx.lineTo(-10, 14);
    ctx.lineTo(-13, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#d8f5ff';
    ctx.fillRect(-5, -4, 10, 12);
    ctx.strokeRect(-5, -4, 10, 12);
    return canvas.toDataURL();
}

const SHIP_ICON = createShipIcon();

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
const shipStaticByMmsi = new Map();

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
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

    let west = Cesium.Math.toDegrees(rectangle.west) - FLIGHT_VIEW_PADDING_DEGREES;
    let east = Cesium.Math.toDegrees(rectangle.east) + FLIGHT_VIEW_PADDING_DEGREES;
    let south = Cesium.Math.toDegrees(rectangle.south) - FLIGHT_VIEW_PADDING_DEGREES;
    let north = Cesium.Math.toDegrees(rectangle.north) + FLIGHT_VIEW_PADDING_DEGREES;

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
    west = Cesium.Math.negativePiToPi(Cesium.Math.toRadians(west));
    east = Cesium.Math.negativePiToPi(Cesium.Math.toRadians(east));
    west = Cesium.Math.toDegrees(west);
    east = Cesium.Math.toDegrees(east);

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

    let west = Cesium.Math.toDegrees(rectangle.west) - AIS_VIEW_PADDING_DEGREES;
    let east = Cesium.Math.toDegrees(rectangle.east) + AIS_VIEW_PADDING_DEGREES;
    let south = clamp(Cesium.Math.toDegrees(rectangle.south) - AIS_VIEW_PADDING_DEGREES, -90, 90);
    let north = clamp(Cesium.Math.toDegrees(rectangle.north) + AIS_VIEW_PADDING_DEGREES, -90, 90);

    let width = east - west;
    if (width < 0) width += 360;
    if (width >= 359) {
        const center = viewer.camera.positionCartographic;
        const centerLat = Cesium.Math.toDegrees(center.latitude);
        const centerLon = Cesium.Math.toDegrees(center.longitude);
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

    west = Cesium.Math.toDegrees(Cesium.Math.negativePiToPi(Cesium.Math.toRadians(west)));
    east = Cesium.Math.toDegrees(Cesium.Math.negativePiToPi(Cesium.Math.toRadians(east)));

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
        sat.entity.path.show = sat.sampleCount >= 3;
    }

    if (selectedSatelliteKey && satellites[selectedSatelliteKey] === sat) {
        updateSatelliteInfoPanel(selectedSatelliteKey);
    }
}

async function loadTLEData() {
    try {
        const res = await fetch(TLE_SOURCE_URL);
        if (!res.ok) {
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
    } catch (e) {
        console.error('Fejl ved indlæsning af TLE-data:', e);
    }
}

function getSatelliteGmst(date) {
    if (typeof satellite.gstimeFromDate === 'function') {
        return satellite.gstimeFromDate(date);
    }

    return satellite.gstime(date);
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

function formatNumber(value, digits) {
    if (!hasFiniteNumbers(value)) return '-';
    return Number(value).toLocaleString('da-DK', {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits
    });
}

function getPlaneAltitudeColor(altitudeMeters) {
    const altitude = clamp(Number(altitudeMeters), 0, FLIGHT_BLUE_ALTITUDE_M);

    if (altitude <= FLIGHT_GREEN_ALTITUDE_M) {
        const ratio = altitude / FLIGHT_GREEN_ALTITUDE_M;
        return new Cesium.Color(1 - ratio, ratio, 0, 1);
    }

    const ratio = (altitude - FLIGHT_GREEN_ALTITUDE_M) / (FLIGHT_BLUE_ALTITUDE_M - FLIGHT_GREEN_ALTITUDE_M);
    return new Cesium.Color(0, 1 - ratio, ratio, 1);
}

function getPlaneBillboardRotation(headingDegrees) {
    if (!hasFiniteNumbers(headingDegrees)) return 0;
    return Cesium.Math.toRadians(Number(headingDegrees)) - PLANE_ICON_HEADING_OFFSET_RADIANS;
}

function getBillboardRotationFromHeading(headingDegrees) {
    if (!hasFiniteNumbers(headingDegrees)) return 0;
    return Cesium.Math.toRadians(Number(headingDegrees));
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
    setText('sat-info-latitude', telemetry ? `${formatNumber(telemetry.latitude, 2)} deg` : 'Henter...');
    setText('sat-info-longitude', telemetry ? `${formatNumber(telemetry.longitude, 2)} deg` : 'Henter...');
    setText('sat-info-orbit', `ca. ${sat.orbitPeriodMinutes} min`);

    const factsElement = document.getElementById('sat-info-facts');
    if (factsElement) {
        factsElement.innerHTML = sat.facts.map(fact => `<div>${fact}</div>`).join('');
    }
}

function hideSatelliteInfoPanel() {
    selectedSatelliteKey = null;
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

function updateAisStaticData(mmsi, aisData) {
    if (!mmsi || !aisData.MetaData) return;

    const staticData = aisData.Message && (aisData.Message.ShipStaticData || aisData.Message.StaticDataReport || {});
    const existing = shipStaticByMmsi.get(mmsi) || {};
    const name = (aisData.MetaData.ShipName || staticData.Name || staticData.ShipName || existing.name || `Vessel ${mmsi}`).trim();
    const destination = (staticData.Destination || existing.destination || '').trim();
    const shipType = staticData.Type || staticData.ShipType || existing.shipType;

    shipStaticByMmsi.set(mmsi, {
        name,
        destination,
        shipType
    });
}

function upsertAisShip(aisData) {
    const report = getAisPositionReport(aisData.Message);
    if (!aisData.MetaData || !report) return;

    const mmsi = aisData.MetaData.MMSI;
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

    const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
    if (!hasValidCartesian(position)) return;

    const description = [
        'Live AIS',
        `MMSI: ${mmsi}`,
        `Fart: ${hasFiniteNumbers(speed) ? speed.toFixed(1) : '-'} kn`,
        `Kurs: ${hasFiniteNumbers(course) ? course.toFixed(0) : '-'} deg`,
        `Destination: ${staticData.destination || '-'}`,
        `Skibstype: ${staticData.shipType || '-'}`
    ].join('<br>');

    if (liveShipEntities.has(mmsi)) {
        const ship = liveShipEntities.get(mmsi);
        ship.entity.position = position;
        ship.entity.show = isLayerChecked('toggle-ship-traffic');
        ship.entity.name = name;
        ship.entity.description = description;
        ship.entity.label.text = name;
        ship.entity.billboard.rotation = getBillboardRotationFromHeading(course);
        ship.lastSeen = Date.now();
        return;
    }

    const entity = viewer.entities.add({
        name,
        position,
        billboard: {
            image: SHIP_ICON,
            scale: 0.55,
            rotation: getBillboardRotationFromHeading(course),
            alignedAxis: Cesium.Cartesian3.ZERO
        },
        label: {
            text: name,
            font: '9pt sans-serif',
            pixelOffset: new Cesium.Cartesian2(0, -14),
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000)
        },
        description
    });
    liveShipEntities.set(mmsi, { entity, lastSeen: Date.now() });
}

function cleanupStaleAisShips() {
    const now = Date.now();
    liveShipEntities.forEach((ship, mmsi) => {
        if (now - ship.lastSeen <= AIS_STALE_MS) return;
        viewer.entities.remove(ship.entity);
        liveShipEntities.delete(mmsi);
        shipStaticByMmsi.delete(mmsi);
    });
}

async function parseWebSocketJsonMessage(data) {
    const text = data instanceof Blob ? await data.text() : data;
    return JSON.parse(text);
}

function connectAIS() {
    if (!AIS_API_KEY) {
        console.warn('AIS API key mangler.');
        return;
    }

    window.clearTimeout(aisReconnectTimer);
    aisSocket = new WebSocket(AIS_STREAM_URL);

    aisSocket.addEventListener('open', () => {
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
            const mmsi = aisData.MetaData && aisData.MetaData.MMSI;
            updateAisStaticData(mmsi, aisData);
            upsertAisShip(aisData);
            cleanupStaleAisShips();
        } catch (e) {
            console.warn('AIS besked kunne ikke laeses:', e);
        }
    });

    aisSocket.addEventListener('close', () => {
        aisReconnectTimer = window.setTimeout(connectAIS, AIS_RECONNECT_MS);
    });

    aisSocket.addEventListener('error', error => {
        console.warn('AISStream fejl:', error);
    });
}

async function updateFlights() {
    if (!isLayerChecked('toggle-planes')) return;
    if (isUpdatingFlights) return;
    const nowMs = Date.now();
    if (nowMs < flightRateLimitedUntil) return;

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

    try {
        const data = await fetchFlightData();
        if (!Array.isArray(data.states)) return;
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

            const position = Cesium.Cartesian3.fromDegrees(lon, lat, Math.max(altitude, 0));
            if (!hasValidCartesian(position)) return;

            seenFlights.add(icao);
            const originCountry = (flight[2] || 'Ukendt').trim();
            const altitudeColor = getPlaneAltitudeColor(altitude);

            const description = [
                'Live flytrafik',
                `Callsign: ${callsign}`,
                `ICAO: ${icao}`,
                `Registreret land: ${originCountry}`,
                `Hoejde: ${formatNumber(altitude, 0)} m`,
                `Hastighed: ${hasFiniteNumbers(velocityMs) ? formatNumber(velocityMs * 3.6, 0) : '-'} km/t`,
                `Kurs: ${hasFiniteNumbers(heading) ? formatNumber(heading, 0) : '-'} deg`
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
                entity.path.show = plane.sampleCount >= 2;
                return;
            }

            const positionProperty = new Cesium.SampledPositionProperty();
            positionProperty.setInterpolationOptions({
                interpolationDegree: 1,
                interpolationAlgorithm: Cesium.LinearApproximation
            });
            positionProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
            positionProperty.forwardExtrapolationDuration = 20;
            positionProperty.addSample(now, position);

            const entity = viewer.entities.add({
                name: `Fly: ${callsign}`,
                position: positionProperty,
                billboard: {
                    image: PLANE_ICON,
                    scale: 0.45,
                    rotation: getPlaneBillboardRotation(heading),
                    alignedAxis: Cesium.Cartesian3.ZERO,
                    color: altitudeColor
                },
                label: {
                    text: callsign,
                    font: '9pt sans-serif',
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 900000)
                },
                path: {
                    show: false,
                    resolution: 1,
                    material: new Cesium.PolylineGlowMaterialProperty({
                        glowPower: 0.12,
                        color: Cesium.Color.YELLOW.withAlpha(0.72)
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
                lastSeen: Date.now()
            });
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
        }
    } finally {
        isUpdatingFlights = false;
    }
}

function initSatellites() {
    for (let key in satellites) {
        const sat = satellites[key];

        // Gør banen blød/buet
        sat.posProperty.setInterpolationOptions({
            interpolationDegree: 1,
            interpolationAlgorithm: Cesium.LinearApproximation
        });
        sat.posProperty.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
        sat.posProperty.forwardExtrapolationDuration = 30;

        sat.entity = viewer.entities.add({
            name: sat.name,
            satelliteKey: key,
            show: false,
            position: sat.posProperty,
            point: { pixelSize: 10, color: sat.color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { 
                text: sat.name, font: '12pt sans-serif', 
                pixelOffset: new Cesium.Cartesian2(0, -15)
            },
            path: {
                show: false,
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: sat.color }),
                width: 4,
                leadTime: 0,
                trailTime: 5400 // Viser ruten for de sidste 90 minutter
            }
        });
        satelliteEntities.push(sat.entity);
    }
}

// 4. FUNKTION: FLY-TO SATELLIT (KNAP LOGIK)
window.flyToSat = function(key) {
    const sat = satellites[key];
    if (sat && sat.entity) {
        viewer.trackedEntity = sat.entity; // Låser kameraet til satellitten
    }
};

// 5. FUNKTION: HENT LIVE SATELLIT DATA
async function updateSatelliteData() {
    const now = Cesium.JulianDate.now();
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
                const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
                const nowDate = new Date();
                const positionAndVelocity = satellite.propagate(satrec, nowDate);
                if (!positionAndVelocity.position) {
                    console.warn('Kunne ikke propagere position for:', sat.name);
                    continue;
                }
                if (!positionAndVelocity.velocity) {
                    console.warn('Kunne ikke propagere hastighed for:', sat.name);
                    continue;
                }
                const gmst = getSatelliteGmst(nowDate);
                const positionGd = satellite.eciToGeodetic(positionAndVelocity.position, gmst);
                const longitude = satellite.degreesLong(positionGd.longitude);
                const latitude = satellite.degreesLat(positionGd.latitude);
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
                const position = Cesium.Cartesian3.fromDegrees(longitude, latitude, altitude * 1000);
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
                    const position = Cesium.Cartesian3.fromDegrees(
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
                    material: Cesium.Color.ORANGE.withAlpha(0.4),
                    outline: true, outlineColor: Cesium.Color.WHITE
                }
            });
            quakeEntities.push(ent);
        });
    } catch (e) { console.error("Quake fejl", e); }
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
            billboard: { image: 'https://img.icons8.com/color/48/000000/cargo-ship.png', scale: 0.6 }
        });
        shipEntities.push(ent);
    });

    militarySpots.forEach(m => {
        const ent = viewer.entities.add({
            name: m.name, position: Cesium.Cartesian3.fromDegrees(m.pos[0], m.pos[1]),
            billboard: { image: 'https://img.icons8.com/color/48/000000/battleship.png', scale: 0.7 }
        });
        militaryEntities.push(ent);
    });
}

// 8. EVENT LISTENERS: TOGGLE LAYERS
document.getElementById('toggle-sat').addEventListener('change', e => {
    satelliteEntities.forEach(ent => ent.show = e.target.checked);
});
document.getElementById('toggle-quakes').addEventListener('change', e => {
    quakeEntities.forEach(ent => ent.show = e.target.checked);
});
document.getElementById('toggle-ships').addEventListener('change', e => {
    shipEntities.forEach(ent => ent.show = e.target.checked);
});
document.getElementById('toggle-ship-traffic').addEventListener('change', e => {
    setMapEntitiesVisible(liveShipEntities, e.target.checked);
    if (e.target.checked) {
        sendAisSubscription(true);
    }
});
document.getElementById('toggle-planes').addEventListener('change', e => {
    setMapEntitiesVisible(planeEntities, e.target.checked);
    if (e.target.checked) {
        scheduleFlightUpdate(0);
    }
});
document.getElementById('toggle-military').addEventListener('change', e => {
    militaryEntities.forEach(ent => ent.show = e.target.checked);
});

viewer.camera.moveEnd.addEventListener(() => {
    scheduleFlightUpdate();
    scheduleAisSubscription();
});

// 9. HØJDEMÅLER LOGIK
viewer.scene.postRender.addEventListener(() => {
    applyVisibleSideScope();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const heightInKm = (cameraHeight / 1000).toFixed(1);
    document.getElementById('altitude-display').innerText = `Højde: ${heightInKm} km`;
});

// KØR ALT VED START
initSatellites();
initEarthquakes();
initMaritimeLayers();
connectAIS();
scheduleFlightUpdate(0);
updateSatelliteData();
setInterval(updateSatelliteData, 5000);
setInterval(() => scheduleFlightUpdate(0), FLIGHT_UPDATE_INTERVAL_MS);

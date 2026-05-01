const CesiumLib = window.Cesium;
const SatelliteLib = window.satellite;
const viewer = createViewer('cesiumContainer');
const {
    AIS_API_KEY,
    AIS_STREAM_URL,
    AIS_RECONNECT_MS,
    AIS_SUBSCRIPTION_DEBOUNCE_MS,
    AIS_MIN_SUBSCRIPTION_GAP_MS,
    AIS_VIEW_PADDING_DEGREES,
    AIS_MAX_LAT_SPAN_DEGREES,
    AIS_MAX_LON_SPAN_DEGREES,
    AIS_STALE_MS,
    AIS_CACHE_KEY,
    AIS_CACHE_MAX_AGE_MS,
    AIS_CACHE_WRITE_DEBOUNCE_MS,
    AIS_CACHE_MAX_SHIPS,
    LOCAL_PROXY_ORIGIN,
    FLIGHT_UPDATE_INTERVAL_MS,
    FLIGHT_STALE_MS,
    FLIGHT_MAX_RESULTS,
    FLIGHT_VIEW_PADDING_DEGREES,
    FLIGHT_MIN_SCOPE_DEGREES,
    FLIGHT_TRAIL_SECONDS,
    FLIGHT_SCOPE_GRID_DEGREES,
    FLIGHT_CAMERA_DEBOUNCE_MS,
    FLIGHT_MIN_REQUEST_GAP_MS,
    FLIGHT_RATE_LIMIT_BACKOFF_MS,
    FLIGHT_GREEN_ALTITUDE_M,
    FLIGHT_BLUE_ALTITUDE_M,
    PLANE_ICON_HEADING_OFFSET_RADIANS,
    SHIP_MARKER_HEIGHT_METERS,
    ALWAYS_SHOW_OVER_TERRAIN,
    PLANE_ICON,
    SHIP_ICON
} = window;

// Lister til styring af lag (Layers)
const satelliteEntities = [];
const quakeEntities = [];
const shipEntities = [];
const airportEntities = [];
const militaryEntities = [];
const liveShipEntities = new Map();
const planeEntities = new Map();

// Konfiguration af satellitter
const satellites = {
    iss: { 
        id: '25544', 
        name: 'ISS (International)', 
        color: CesiumLib.Color.RED, 
        source: 'api',
        orbitPeriodMinutes: 93,
        facts: [
            'ISS er cirka pÃƒÂ¥ stÃƒÂ¸rrelse med en fodboldbane.',
            'Den har typisk 7 astronauter ombord.',
            'Den ser omkring 16 solopgange i dÃƒÂ¸gnet.'
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
            'Rumstationen bestÃƒÂ¥r af modulerne Tianhe, Wentian og Mengtian.',
            'Den kredser lavt om Jorden, ligesom ISS.'
        ],
        posProperty: new CesiumLib.SampledPositionProperty(),
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
        console.error('Fejl ved indlÃ¦sning af TLE-data:', e);
    }
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
        return new CesiumLib.Color(1 - ratio, ratio, 0, 1);
    }

    const ratio = (altitude - FLIGHT_GREEN_ALTITUDE_M) / (FLIGHT_BLUE_ALTITUDE_M - FLIGHT_GREEN_ALTITUDE_M);
    return new CesiumLib.Color(0, 1 - ratio, ratio, 1);
}

function getPlaneBillboardRotation(headingDegrees) {
    if (!hasFiniteNumbers(headingDegrees)) return 0;
    return CesiumLib.Math.toRadians(Number(headingDegrees)) - PLANE_ICON_HEADING_OFFSET_RADIANS;
}

function getNorthAlignedAxis(lon, lat) {
    const position = CesiumLib.Cartesian3.fromDegrees(lon, lat, SHIP_MARKER_HEIGHT_METERS);
    const frame = CesiumLib.Transforms.eastNorthUpToFixedFrame(position);
    const north = CesiumLib.Matrix4.getColumn(frame, 1, new CesiumLib.Cartesian3());
    return CesiumLib.Cartesian3.normalize(north, north);
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
            rotation: 0,
            alignedAxis: getNorthAlignedAxis(lon, lat),
            disableDepthTestDistance: ALWAYS_SHOW_OVER_TERRAIN
        },
        label: {
            text: name,
            font: '9pt sans-serif',
            pixelOffset: new CesiumLib.Cartesian2(0, -14),
            disableDepthTestDistance: ALWAYS_SHOW_OVER_TERRAIN,
            distanceDisplayCondition: new CesiumLib.DistanceDisplayCondition(0, 800000)
        },
        description
    });

    liveShipEntities.set(mmsi, {
        entity,
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

// 3. FUNKTION: INITIALISÃ‰R SATELLITTER
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

    const description = buildAisDescription(mmsi, speed, course, staticData);

    if (liveShipEntities.has(mmsi)) {
        const ship = liveShipEntities.get(mmsi);
        ship.entity.position = position;
        ship.entity.show = isLayerChecked('toggle-ship-traffic');
        ship.entity.name = name;
        ship.entity.description = description;
        ship.entity.label.text = name;
        ship.entity.billboard.rotation = 0;
        ship.entity.billboard.alignedAxis = getNorthAlignedAxis(lon, lat);
        ship.lastSeen = Date.now();
        ship.lat = lat;
        ship.lon = lon;
        ship.course = course;
        ship.speed = speed;
        ship.name = name;
        ship.description = description;
        scheduleAisCacheWrite();
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
    scheduleAisCacheWrite();
}

function cleanupStaleAisShips() {
    const now = Date.now();
    let removedAny = false;
    liveShipEntities.forEach((ship, mmsi) => {
        if (now - ship.lastSeen <= AIS_STALE_MS) return;
        viewer.entities.remove(ship.entity);
        liveShipEntities.delete(mmsi);
        shipStaticByMmsi.delete(mmsi);
        removedAny = true;
    });
    if (removedAny) {
        scheduleAisCacheWrite();
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

            if (ship.staticData) {
                shipStaticByMmsi.set(ship.mmsi, ship.staticData);
                refreshAisShipDescription(ship.mmsi);
            }
        });
    } catch (e) {
        console.warn('Kunne ikke laese AIS-cache:', e);
    }
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
            const mmsi = getAisMmsi(aisData);
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
        const now = CesiumLib.JulianDate.now();
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

        // GÃ¸r banen blÃ¸d/buet
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
    }
}

// 4. FUNKTION: FLY-TO SATELLIT (KNAP LOGIK)
window.flyToSat = function(key) {
    const sat = satellites[key];
    if (sat && sat.entity) {
        viewer.trackedEntity = sat.entity; // LÃ¥ser kameraet til satellitten
    }
};

// 5. FUNKTION: HENT LIVE SATELLIT DATA
async function updateSatelliteData() {
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
}

// 6. FUNKTION: JORDSKÃ†LV LAG
// 7. FUNKTION: MARITIME LAG (SKIBE & MILITAER)
// 8. FUNKTION: LUFTHAVNE

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
document.getElementById('toggle-airports').addEventListener('change', e => {
    airportEntities.forEach(ent => ent.show = e.target.checked);
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

// 9. HÃ˜JDEMÃ…LER LOGIK
viewer.scene.postRender.addEventListener(() => {
    applyVisibleSideScope();
    const cameraHeight = viewer.camera.positionCartographic.height;
    const heightInKm = (cameraHeight / 1000).toFixed(1);
    document.getElementById('altitude-display').innerText = `HÃ¸jde: ${heightInKm} km`;
});

// KÃ˜R ALT VED START
initSatellites();
initEarthquakes({ viewer, quakeEntities, hasFiniteNumbers, hasValidCartesian });
initMaritimeLayers({ viewer, shipEntities, militaryEntities, SHIP_MARKER_HEIGHT_METERS, ALWAYS_SHOW_OVER_TERRAIN, getNorthAlignedAxis });
initAirports({ viewer, airportEntities, SHIP_MARKER_HEIGHT_METERS, ALWAYS_SHOW_OVER_TERRAIN });
restoreAisShipCache();
connectAIS();
scheduleFlightUpdate(0);
updateSatelliteData();
setInterval(updateSatelliteData, 5000);
setInterval(() => scheduleFlightUpdate(0), FLIGHT_UPDATE_INTERVAL_MS);





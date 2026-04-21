// 1. DIN CESIUM ION TOKEN
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4YWE4MjRkYy0wYTRjLTQ0N2MtYTUyNC1kNGNlY2RkNTFjMjgiLCJpZCI6NDE5MDQwLCJpYXQiOjE3NzYzMzI0Njh9.8ZT0_Y4I8w8TVhMqanhTsZXWoL-iZBx0hiS8Q0nhFFc';
const AIS_API_KEY = '1d99e78a9c489a3a0310b6c016af3bf4c2319e5c';
const AIS_STREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const FLIGHT_BOUNDS_QUERY = 'lamin=45.0&lomin=-10.0&lamax=60.0&lomax=20.0';
const FLIGHT_DATA_PATH = `/api/flights?${FLIGHT_BOUNDS_QUERY}`;
const FLIGHT_DATA_URLS = [
    FLIGHT_DATA_PATH,
    `http://127.0.0.1:5600${FLIGHT_DATA_PATH}`
];

// 2. INITIALISÉR VIEWERS (Rettet version uden createWorldTerrain-fejl)
const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(), // Den korrekte måde i nyere versioner
    baseLayerPicker: true,
    geocoder: false,
    homeButton: false,
    shouldAnimate: true
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
    entities.forEach(entity => {
        entity.show = visible;
    });
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

let selectedSatelliteKey = null;

async function fetchFlightData() {
    const urls = [...new Set(FLIGHT_DATA_URLS)];

    for (const url of urls) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.warn('Kunne ikke hente flydata:', response.status, response.statusText, url);
                continue;
            }
            return await response.json();
        } catch (e) {
            console.warn('Flydata-kilde fejlede:', url, e);
        }
    }

    throw new Error('Ingen flydata-kilder svarede. Start proxyen med: node server.js');
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
function connectAIS() {
    if (!AIS_API_KEY) {
        console.warn('AIS API key mangler.');
        return;
    }

    const socket = new WebSocket(AIS_STREAM_URL);

    socket.addEventListener('open', () => {
        socket.send(JSON.stringify({
            APIKey: AIS_API_KEY,
            BoundingBoxes: [[[-15.0, 45.0], [25.0, 65.0]]],
            FilterMessageTypes: ['PositionReport'],
            FiltersShipTypes: [1, 36, 37, 70, 71, 72, 73, 74, 80]
        }));
    });

    socket.addEventListener('message', event => {
        if (!isLayerChecked('toggle-ships')) return;

        try {
            const aisData = JSON.parse(event.data);
            const report = aisData.Message && aisData.Message.PositionReport;
            if (!aisData.MetaData || !report) return;

            const mmsi = aisData.MetaData.MMSI;
            const name = (aisData.MetaData.ShipName || `Vessel ${mmsi}`).trim();
            const lat = Number(report.Latitude);
            const lon = Number(report.Longitude);
            const speed = Number(report.Sog);

            if (!mmsi || !hasFiniteNumbers(lat, lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
                return;
            }

            const position = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
            if (!hasValidCartesian(position)) return;

            const description = `Live AIS<br>MMSI: ${mmsi}<br>Fart: ${hasFiniteNumbers(speed) ? speed.toFixed(1) : '-'} kn`;

            if (liveShipEntities.has(mmsi)) {
                const entity = liveShipEntities.get(mmsi);
                entity.position = position;
                entity.show = true;
                entity.description = description;
                return;
            }

            const entity = viewer.entities.add({
                name,
                position,
                point: {
                    pixelSize: 8,
                    color: Cesium.Color.DODGERBLUE,
                    outlineColor: Cesium.Color.WHITE,
                    outlineWidth: 1
                },
                label: {
                    text: name,
                    font: '9pt sans-serif',
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000)
                },
                description
            });
            liveShipEntities.set(mmsi, entity);
        } catch (e) {
            console.warn('AIS besked kunne ikke laeses:', e);
        }
    });

    socket.addEventListener('close', () => {
        setTimeout(connectAIS, 10000);
    });

    socket.addEventListener('error', error => {
        console.warn('AISStream fejl:', error);
    });
}

async function updateFlights() {
    if (!isLayerChecked('toggle-planes')) return;

    try {
        const data = await fetchFlightData();
        if (!Array.isArray(data.states)) return;

        data.states.slice(0, 80).forEach(flight => {
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

            const description = [
                'Live flytrafik',
                `Callsign: ${callsign}`,
                `ICAO: ${icao}`,
                `Hoejde: ${formatNumber(altitude, 0)} m`,
                `Hastighed: ${hasFiniteNumbers(velocityMs) ? formatNumber(velocityMs * 3.6, 0) : '-'} km/t`,
                `Kurs: ${hasFiniteNumbers(heading) ? formatNumber(heading, 0) : '-'} deg`
            ].join('<br>');

            if (planeEntities.has(icao)) {
                const entity = planeEntities.get(icao);
                entity.position = position;
                entity.show = true;
                entity.description = description;
                entity.label.text = callsign;
                entity.billboard.rotation = hasFiniteNumbers(heading) ? Cesium.Math.toRadians(heading) : 0;
                return;
            }

            const entity = viewer.entities.add({
                name: `Fly: ${callsign}`,
                position,
                billboard: {
                    image: PLANE_ICON,
                    scale: 0.45,
                    rotation: hasFiniteNumbers(heading) ? Cesium.Math.toRadians(heading) : 0,
                    alignedAxis: Cesium.Cartesian3.ZERO,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                },
                label: {
                    text: callsign,
                    font: '9pt sans-serif',
                    pixelOffset: new Cesium.Cartesian2(0, -14),
                    distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 900000)
                },
                description
            });
            planeEntities.set(icao, entity);
        });
    } catch (e) {
        console.warn('Fejl ved hentning af flytrafik:', e);
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
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY 
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
        { name: "Port of Shanghai", pos: [121.7, 31.2] },
        { name: "Port of Rotterdam", pos: [4.4, 51.9] },
        { name: "Singapore Strait", pos: [103.8, 1.2] }
    ];

    const militarySpots = [
        { name: "Pearl Harbor (USA)", pos: [-157.9, 21.3] },
        { name: "Naval Base Norfolk (USA)", pos: [-76.3, 36.9] },
        { name: "Sevastopol Naval Base (RU)", pos: [33.5, 44.6] },
        { name: "Portsmouth Naval Base (UK)", pos: [-1.1, 50.8] }
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
    setMapEntitiesVisible(liveShipEntities, e.target.checked);
});
document.getElementById('toggle-planes').addEventListener('change', e => {
    setMapEntitiesVisible(planeEntities, e.target.checked);
});
document.getElementById('toggle-military').addEventListener('change', e => {
    militaryEntities.forEach(ent => ent.show = e.target.checked);
});

// 9. HØJDEMÅLER LOGIK
viewer.scene.postRender.addEventListener(() => {
    const cameraHeight = viewer.camera.positionCartographic.height;
    const heightInKm = (cameraHeight / 1000).toFixed(1);
    document.getElementById('altitude-display').innerText = `Højde: ${heightInKm} km`;
});

// KØR ALT VED START
initSatellites();
initEarthquakes();
initMaritimeLayers();
connectAIS();
updateFlights();
updateSatelliteData();
setInterval(updateSatelliteData, 5000);
setInterval(updateFlights, 15000);

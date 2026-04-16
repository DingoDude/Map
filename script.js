// 1. TOKENS & KONFIGURATION
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4YWE4MjRkYy0wYTRjLTQ0N2MtYTUyNC1kNGNlY2RkNTFjMjgiLCJpZCI6NDE5MDQwLCJpYXQiOjE3NzYzMzI0Njh9.8ZT0_Y4I8w8TVhMqanhTsZXWoL-iZBx0hiS8Q0nhFFc';
const AIS_API_KEY = "1d99e78a9c489a3a0310b6c016af3bf4c2319e5c";

const viewer = new Cesium.Viewer('cesiumContainer', {
    terrain: Cesium.Terrain.fromWorldTerrain(),
    baseLayerPicker: true,
    geocoder: false,
    homeButton: false,
    shouldAnimate: true
});

// Lag-beholdere
const satelliteEntities = [];
const shipEntities = new Map();  // MMSI -> Entity
const planeEntities = new Map(); // ICAO -> Entity

const satellites = {
    iss: { id: '25544', name: 'ISS', color: Cesium.Color.RED, posProperty: new Cesium.SampledPositionProperty(), entity: null },
    tiangong: { id: '48274', name: 'Tiangong', color: Cesium.Color.CYAN, posProperty: new Cesium.SampledPositionProperty(), entity: null }
};

// 2. LIVE SKIBSTRAFIK (AISSTREAM WEBSOCKET)
function connectAIS() {
    const socket = new WebSocket("wss://stream.aisstream.io/v0/stream");

    socket.onopen = function () {
        console.log("AISStream forbindelse åben!");
        const subscriptionMessage = {
            APIKey: AIS_API_KEY,
            BoundingBoxes: [[[-15.0, 45.0], [25.0, 65.0]]], // Nordsøen / Europa
            FiltersShipTypes: [1, 36, 37, 80] 
        };
        socket.send(JSON.stringify(subscriptionMessage));
    };

    socket.onmessage = function (event) {
        if (!document.getElementById('toggle-ships').checked) return;
        const aisData = JSON.parse(event.data);
        if (!aisData.MetaData || !aisData.Message.PositionReport) return;

        const mmsi = aisData.MetaData.MMSI;
        const name = aisData.MetaData.ShipName || "Vessel " + mmsi;
        const lat = aisData.Message.PositionReport.Latitude;
        const lon = aisData.Message.PositionReport.Longitude;
        const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);

        if (shipEntities.has(mmsi)) {
            shipEntities.get(mmsi).position = pos;
        } else {
            const ent = viewer.entities.add({
                name: name, position: pos,
                billboard: { image: 'https://img.icons8.com/color/48/000000/cargo-ship.png', scale: 0.4 },
                label: { text: name, font: '8pt sans-serif', pixelOffset: new Cesium.Cartesian2(0, -10), distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 300000) }
            });
            shipEntities.set(mmsi, ent);
        }
    };
    socket.onclose = () => setTimeout(connectAIS, 10000);
}

// 3. LIVE FLYTRAFIK (OPENSKY)
async function updateFlights() {
    if (!document.getElementById('toggle-planes').checked) return;
    try {
        const res = await fetch('https://opensky-network.org/api/states/all?lamin=45.0&lomin=-10.0&lamax=60.0&lomax=20.0');
        const data = await res.json();
        data.states.slice(0, 50).forEach(f => {
            const icao = f[0], callsign = f[1].trim(), lon = f[5], lat = f[6], alt = f[7] || 10000;
            const pos = Cesium.Cartesian3.fromDegrees(lon, lat, alt);
            if (planeEntities.has(icao)) {
                planeEntities.get(icao).position = pos;
            } else {
                const ent = viewer.entities.add({
                    name: "Fly: " + callsign, position: pos,
                    model: { uri: 'https://assets.cesium.com/0/0/0/models/Cesium_Air.glb', minimumPixelSize: 25 },
                    label: { text: callsign, font: '9pt sans-serif', pixelOffset: new Cesium.Cartesian2(0, -20) }
                });
                planeEntities.set(icao, ent);
            }
        });
    } catch (e) {}
}

// 4. SATELLIT TRACKING
function initSatellites() {
    for (let key in satellites) {
        const sat = satellites[key];
        sat.posProperty.setInterpolationOptions({ interpolationDegree: 2, interpolationAlgorithm: Cesium.HermitePolynomialApproximation });
        sat.entity = viewer.entities.add({
            name: sat.name, position: sat.posProperty,
            point: { pixelSize: 10, color: sat.color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { text: sat.name, font: '12pt sans-serif', pixelOffset: new Cesium.Cartesian2(0, -15) },
            path: { width: 3, material: sat.color, trailTime: 5400 }
        });
        satelliteEntities.push(sat.entity);
    }
}

async function updateSats() {
    const now = Cesium.JulianDate.now();
    for (let key in satellites) {
        const sat = satellites[key];
        try {
            const res = await fetch(`https://api.wheretheiss.at/v1/satellites/${sat.id}`);
            const data = await res.json();
            const pos = Cesium.Cartesian3.fromDegrees(data.longitude, data.latitude, data.altitude * 1000);
            sat.posProperty.addSample(now, pos);
        } catch (e) {}
    }
}

// 5. UI & SYSTEM KONTROL
window.flyToSat = (key) => { if (satellites[key].entity) viewer.trackedEntity = satellites[key].entity; };

document.getElementById('toggle-sat').addEventListener('change', e => satelliteEntities.forEach(ent => ent.show = e.target.checked));
document.getElementById('toggle-planes').addEventListener('change', e => planeEntities.forEach(ent => ent.show = e.target.checked));
document.getElementById('toggle-ships').addEventListener('change', e => shipEntities.forEach(ent => ent.show = e.target.checked));

viewer.scene.postRender.addEventListener(() => {
    const height = viewer.camera.positionCartographic.height;
    document.getElementById('altitude-display').innerText = `Højde: ${(height / 1000).toFixed(1)} km`;
});

// START
initSatellites();
connectAIS();
setInterval(updateSats, 5000);
setInterval(updateFlights, 10000);
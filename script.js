// 1. DIN CESIUM ION TOKEN
Cesium.Ion.defaultAccessToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI4YWE4MjRkYy0wYTRjLTQ0N2MtYTUyNC1kNGNlY2RkNTFjMjgiLCJpZCI6NDE5MDQwLCJpYXQiOjE3NzYzMzI0Njh9.8ZT0_Y4I8w8TVhMqanhTsZXWoL-iZBx0hiS8Q0nhFFc';

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

// Konfiguration af satellitter
const satellites = {
    iss: { 
        id: '25544', 
        name: 'ISS (International)', 
        color: Cesium.Color.RED, 
        posProperty: new Cesium.SampledPositionProperty(),
        entity: null 
    },
    tiangong: { 
        id: '48274', 
        name: 'Tiangong (Kina)', 
        color: Cesium.Color.CYAN, 
        posProperty: new Cesium.SampledPositionProperty(),
        entity: null 
    }
};

// 3. FUNKTION: INITIALISÉR SATELLITTER
function initSatellites() {
    for (let key in satellites) {
        const sat = satellites[key];

        // Gør banen blød/buet
        sat.posProperty.setInterpolationOptions({
            interpolationDegree: 2,
            interpolationAlgorithm: Cesium.HermitePolynomialApproximation
        });

        sat.entity = viewer.entities.add({
            name: sat.name,
            position: sat.posProperty,
            point: { pixelSize: 10, color: sat.color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { 
                text: sat.name, font: '12pt sans-serif', 
                pixelOffset: new Cesium.Cartesian2(0, -15),
                disableDepthTestDistance: Number.POSITIVE_INFINITY 
            },
            path: {
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
            const response = await fetch(`https://api.wheretheiss.at/v1/satellites/${sat.id}`);
            if (response.ok) {
                const data = await response.json();
                const position = Cesium.Cartesian3.fromDegrees(
                    parseFloat(data.longitude), 
                    parseFloat(data.latitude), 
                    data.altitude * 1000
                );
                sat.posProperty.addSample(now, position);
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
            const ent = viewer.entities.add({
                name: quake.properties.place,
                position: Cesium.Cartesian3.fromDegrees(coords[0], coords[1]),
                ellipse: {
                    semiMinorAxis: mag * 25000,
                    semiMajorAxis: mag * 25000,
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
updateSatelliteData();
setInterval(updateSatelliteData, 5000);
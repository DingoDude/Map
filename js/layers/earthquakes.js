async function initEarthquakes({ viewer, quakeEntities, hasFiniteNumbers, hasValidCartesian }) {
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
            const position = window.Cesium.Cartesian3.fromDegrees(Number(coords[0]), Number(coords[1]), 0);
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
                    material: window.Cesium.Color.ORANGE.withAlpha(0.4),
                    outline: true, outlineColor: window.Cesium.Color.WHITE
                }
            });
            quakeEntities.push(ent);
        });
    } catch (e) { console.error("Quake fejl", e); }
}


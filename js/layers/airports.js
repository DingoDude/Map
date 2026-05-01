function initAirports({ viewer, airportEntities, SHIP_MARKER_HEIGHT_METERS, ALWAYS_SHOW_OVER_TERRAIN }) {
    const airports = [
        { name: "Copenhagen Airport (CPH)", pos: [12.65, 55.62] },
        { name: "Billund Airport (BLL)", pos: [9.15, 55.74] },
        { name: "Aalborg Airport (AAL)", pos: [9.85, 57.09] },
        { name: "Oslo Gardermoen (OSL)", pos: [11.10, 60.19] },
        { name: "Stockholm Arlanda (ARN)", pos: [17.92, 59.65] },
        { name: "Helsinki Airport (HEL)", pos: [24.96, 60.32] },
        { name: "Amsterdam Schiphol (AMS)", pos: [4.76, 52.31] },
        { name: "London Heathrow (LHR)", pos: [-0.45, 51.47] },
        { name: "Paris Charles de Gaulle (CDG)", pos: [2.55, 49.01] },
        { name: "Frankfurt Airport (FRA)", pos: [8.57, 50.04] },
        { name: "Munich Airport (MUC)", pos: [11.79, 48.35] },
        { name: "Zurich Airport (ZRH)", pos: [8.55, 47.46] },
        { name: "Madrid Barajas (MAD)", pos: [-3.57, 40.49] },
        { name: "Barcelona El Prat (BCN)", pos: [2.08, 41.30] },
        { name: "Rome Fiumicino (FCO)", pos: [12.25, 41.80] },
        { name: "Istanbul Airport (IST)", pos: [28.75, 41.28] },
        { name: "Dubai International (DXB)", pos: [55.36, 25.25] },
        { name: "Doha Hamad (DOH)", pos: [51.61, 25.27] },
        { name: "Singapore Changi (SIN)", pos: [103.99, 1.36] },
        { name: "Hong Kong International (HKG)", pos: [113.91, 22.31] },
        { name: "Tokyo Haneda (HND)", pos: [139.78, 35.55] },
        { name: "Seoul Incheon (ICN)", pos: [126.45, 37.46] },
        { name: "Beijing Capital (PEK)", pos: [116.59, 40.08] },
        { name: "Shanghai Pudong (PVG)", pos: [121.80, 31.14] },
        { name: "Sydney Airport (SYD)", pos: [151.18, -33.95] },
        { name: "New York JFK (JFK)", pos: [-73.78, 40.64] },
        { name: "Newark Liberty (EWR)", pos: [-74.17, 40.69] },
        { name: "Chicago O'Hare (ORD)", pos: [-87.91, 41.98] },
        { name: "Atlanta Hartsfield-Jackson (ATL)", pos: [-84.43, 33.64] },
        { name: "Dallas/Fort Worth (DFW)", pos: [-97.04, 32.90] },
        { name: "Los Angeles International (LAX)", pos: [-118.41, 33.94] },
        { name: "San Francisco International (SFO)", pos: [-122.38, 37.62] },
        { name: "Toronto Pearson (YYZ)", pos: [-79.63, 43.68] },
        { name: "Sao Paulo Guarulhos (GRU)", pos: [-46.47, -23.44] }
    ];

    airports.forEach(airport => {
        const ent = viewer.entities.add({
            name: airport.name,
            position: window.Cesium.Cartesian3.fromDegrees(airport.pos[0], airport.pos[1], SHIP_MARKER_HEIGHT_METERS),
            billboard: {
                image: 'https://img.icons8.com/color/48/000000/airport.png',
                scale: 0.58,
                disableDepthTestDistance: ALWAYS_SHOW_OVER_TERRAIN
            }
        });
        airportEntities.push(ent);
    });
}


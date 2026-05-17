(function(window){
    if (!window.Cesium) return;
    let cityLightsLayer = null;

    function initCityLights(viewer) {
        if (!viewer || cityLightsLayer) return;

        const provider = new Cesium.SingleTileImageryProvider({
            url: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57730/earth_night_lights_2012_lrg.jpg',
            rectangle: Cesium.Rectangle.fromDegrees(-180, -90, 180, 90)
        });

        cityLightsLayer = viewer.imageryLayers.addImageryProvider(provider);
        cityLightsLayer.alpha = 0.9;
        cityLightsLayer.show = false;
    }

    function setCityLightsVisible(visible) {
        if (!cityLightsLayer) return;
        cityLightsLayer.show = !!visible;
    }

    window.initCityLights = initCityLights;
    window.setCityLightsVisible = setCityLightsVisible;
})(window);

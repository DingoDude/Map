function createViewer(containerId = 'cesiumContainer') {
    if (!window.Cesium) {
        throw new Error('Cesium er ikke indlaest endnu.');
    }

    window.Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;

    const viewer = new window.Cesium.Viewer(containerId, {
        terrain: window.Cesium.Terrain.fromWorldTerrain(),
        baseLayerPicker: true,
        geocoder: false,
        homeButton: false,
        shouldAnimate: true
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;

    viewer.camera.setView({
        destination: window.Cesium.Rectangle.fromDegrees(...window.PERSIAN_GULF_VIEW_DEGREES)
    });

    return viewer;
}

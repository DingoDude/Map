function createViewer(containerId = 'cesiumContainer') {
    if (!window.Cesium) {
        throw new Error('Cesium er ikke indlaest endnu.');
    }

    window.Cesium.Ion.defaultAccessToken = window.CESIUM_ION_TOKEN;

    const baseLayer = window.Cesium.ImageryLayer.fromProviderAsync(
        window.Cesium.ArcGisMapServerImageryProvider.fromUrl(
            'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
        )
    );

    const viewer = new window.Cesium.Viewer(containerId, {
        baseLayer,
        terrainProvider: new window.Cesium.EllipsoidTerrainProvider(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        selectionIndicator: false,
        shouldAnimate: true
    });

    viewer.scene.globe.depthTestAgainstTerrain = false;

    viewer.camera.setView({
        destination: window.Cesium.Rectangle.fromDegrees(...window.PERSIAN_GULF_VIEW_DEGREES)
    });

    return viewer;
}

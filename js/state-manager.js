/**
 * STATE-MANAGER.JS - localStorage-baseret state management
 * Gem bruger-præferencer, watchlist og scene-positioner
 */

class StateManager {
  constructor() {
    this.prefix = 'space-control-';
    this.listeners = [];
    this.state = this.loadState();
  }

  /**
   * Initialisér state med defaults
   */
  loadState() {
    return {
      // Aktiverede layers
      layers: {
        satellites: this.getItem('layers.satellites', true),
        allSatellites: this.getItem('layers.allSatellites', false),
        flights: this.getItem('layers.flights', true),
        ships: this.getItem('layers.ships', true),
        airports: this.getItem('layers.airports', true),
        earthquakes: this.getItem('layers.earthquakes', false),
        wind: this.getItem('layers.wind', false),
        liveCameras: this.getItem('layers.liveCameras', true)
      },

      // Watchlist
      watchlist: this.getItem('watchlist', []),

      // Senest kamera-position
      cameraPosition: this.getItem('cameraPosition', null),

      // UI-præferencer
      ui: {
        activeTab: this.getItem('ui.activeTab', 'layers'),
        panelExpanded: this.getItem('ui.panelExpanded', true),
        panelPosX: this.getItem('ui.panelPosX', 12),
        panelPosY: this.getItem('ui.panelPosY', 12)
      },

      // Filter-indstillinger
      filters: {
        minShipSpeed: this.getItem('filters.minShipSpeed', 0),
        minFlightAltitude: this.getItem('filters.minFlightAltitude', 0),
        showMaritimeOnly: this.getItem('filters.showMaritimeOnly', false)
      },

      // Scene snapshots
      snapshots: this.getItem('snapshots', [])
    };
  }

  /**
   * Hent værdi fra localStorage med prefix
   */
  getItem(key, defaultValue = null) {
    const fullKey = this.prefix + key;
    const stored = localStorage.getItem(fullKey);
    if (stored === null) return defaultValue;
    try {
      return JSON.parse(stored);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Gem værdi til localStorage
   */
  setItem(key, value) {
    const fullKey = this.prefix + key;
    try {
      localStorage.setItem(fullKey, JSON.stringify(value));
      this.notifyListeners(key, value);
    } catch (e) {
      console.error('Failed to save to localStorage:', e);
    }
  }

  /**
   * Get state værdi med dot-notation
   */
  get(path, defaultValue = undefined) {
    const parts = path.split('.');
    let obj = this.state;
    for (const part of parts) {
      obj = obj?.[part];
      if (obj === undefined) return defaultValue;
    }
    return obj;
  }

  /**
   * Set state værdi med dot-notation
   */
  set(path, value) {
    const parts = path.split('.');
    const lastPart = parts.pop();
    let obj = this.state;

    for (const part of parts) {
      if (!obj[part]) obj[part] = {};
      obj = obj[part];
    }

    obj[lastPart] = value;
    this.setItem(path, value);
  }

  /**
   * Gem current camera position
   */
  saveCameraPosition(camera) {
    if (!camera) return;
    const pos = {
      lng: camera.positionCartographic?.longitude,
      lat: camera.positionCartographic?.latitude,
      height: camera.positionCartographic?.height,
      timestamp: Date.now()
    };
    this.set('cameraPosition', pos);
  }

  /**
   * Gem snapshot af current scene
   */
  saveSnapshot(name, camera, activeLayers) {
    const snapshot = {
      id: Date.now(),
      name: name || `Snapshot ${this.state.snapshots.length + 1}`,
      timestamp: new Date().toISOString(),
      camera: {
        lng: camera?.positionCartographic?.longitude,
        lat: camera?.positionCartographic?.latitude,
        height: camera?.positionCartographic?.height
      },
      layers: activeLayers,
      shareCode: Math.random().toString(36).substr(2, 9)
    };

    const snapshots = this.get('snapshots', []);
    snapshots.push(snapshot);
    this.set('snapshots', snapshots);
    return snapshot;
  }

  /**
   * Hent snapshot ved ID
   */
  getSnapshot(id) {
    return this.get('snapshots', []).find(s => s.id === id);
  }

  /**
   * Slet snapshot
   */
  deleteSnapshot(id) {
    const snapshots = this.get('snapshots', []).filter(s => s.id !== id);
    this.set('snapshots', snapshots);
  }

  /**
   * Eksporter alle snapshots
   */
  exportSnapshots() {
    return JSON.stringify(this.get('snapshots', []), null, 2);
  }

  /**
   * Tilføj til watchlist
   */
  addToWatchlist(item) {
    const watchlist = this.get('watchlist', []);
    if (!watchlist.find(w => w.name === item.name)) {
      watchlist.push(item);
      this.set('watchlist', watchlist);
    }
  }

  /**
   * Fjern fra watchlist
   */
  removeFromWatchlist(name) {
    const watchlist = this.get('watchlist', []).filter(w => w.name !== name);
    this.set('watchlist', watchlist);
  }

  /**
   * Subscribe til state changes
   */
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  /**
   * Notifiser alle listeners
   */
  notifyListeners(key, value) {
    this.listeners.forEach(listener => {
      try {
        listener(key, value);
      } catch (e) {
        console.error('Error in state listener:', e);
      }
    });
  }

  /**
   * Slet alt (factory reset)
   */
  clearAll() {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(this.prefix)) {
        localStorage.removeItem(key);
      }
    });
    this.state = this.loadState();
    this.listeners = [];
  }

  /**
   * Eksporter hele state som JSON
   */
  export() {
    return JSON.stringify(this.state, null, 2);
  }

  /**
   * Importer state fra JSON
   */
  import(json) {
    try {
      const imported = JSON.parse(json);
      Object.keys(imported).forEach(key => {
        if (imported[key]) {
          this.setItem(key, imported[key]);
        }
      });
      this.state = this.loadState();
    } catch (e) {
      console.error('Failed to import state:', e);
    }
  }
}

// Globalt instance
const stateManager = new StateManager();

export default stateManager;

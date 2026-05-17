# Contributing to Space & Earth Control Center

Velkommen! Dette dokument forklarer hvordan du kan bidrage til projektet.

## Setup til Development

```bash
# 1. Clone og install
git clone <repo>
cd Map
npm install

# 2. Opret .env fra template
cp .env.example .env

# 3. Udfyld API-nøgler i .env
# - CESIUM_ION_TOKEN: https://cesium.com/ion
# - AIS_API_KEY: https://www.aisstream.io

# 4. Start development server
npm start
# eller
.\start-map.bat

# 5. Åbn i browser
# http://localhost:5600
```

## Projektstruktur

```
Map/
├── js/
│   ├── config.js              # Centraliseret konfiguration
│   ├── error-handler.js       # Global fejlhåndtering
│   ├── state-manager.js       # localStorage state
│   ├── help-dialog.js         # Hjælp-UI
│   ├── draggable-panels.js    # Flytbare paneler
│   ├── icons.js               # Icon definitions
│   ├── viewer.js              # Cesium setup
│   ├── layers/
│   │   ├── airports.js        # Lufthavn layer
│   │   ├── earthquakes.js     # Jordskælv layer
│   │   └── maritime.js        # Skibstrafik layer
│   └── ...
├── map.html                   # Main HTML
├── script.js                  # Main app (STOR - bør modulariseres)
├── style.css                  # Styling
├── server.js                  # Node.js proxy server
└── .env                       # Secrets (ikke commit)
```

## Feature Development

### Tilføj Nyt Layer

1. **Opret modul** i `js/layers/my-layer.js`:

```javascript
/**
 * my-layer.js - Eksempel på nyt layer
 */

class MyLayer {
  constructor(viewer, config) {
    this.viewer = viewer;
    this.config = config;
    this.isVisible = false;
    this.entities = [];
  }

  async load() {
    // Hent data
    const data = await this.fetchData();
    
    // Opret entities i Cesium
    data.forEach(item => {
      const entity = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat),
        point: { pixelSize: 8, color: Cesium.Color.RED }
      });
      this.entities.push(entity);
    });
  }

  async fetchData() {
    // Hent fra server proxy
    const response = await fetch(`${this.config.server.proxyOrigin}/api/my-data`);
    return response.json();
  }

  setVisible(visible) {
    this.isVisible = visible;
    this.entities.forEach(e => e.show = visible);
  }

  clear() {
    this.entities.forEach(e => this.viewer.entities.remove(e));
    this.entities = [];
  }
}

export default MyLayer;
```

2. **Integrer i script.js**:

```javascript
import MyLayer from './layers/my-layer.js';

const myLayer = new MyLayer(viewer, CONFIG);

// Tilknyt til toggle-knap
document.getElementById('toggle-my-layer').addEventListener('change', (e) => {
  if (e.target.checked) {
    myLayer.load();
  } else {
    myLayer.setVisible(false);
  }
});
```

### Tilføj Server Endpoint

I `server.js`, tilføj ny route:

```javascript
// Hent custom data
app.get('/api/my-data', async (req, res) => {
  try {
    // Hent fra ekstern API eller cache
    const data = await fetchMyData();
    res.json(data);
  } catch (error) {
    errorHandler.handle(error, 'GET /api/my-data');
    res.status(500).json({ error: error.message });
  }
});
```

### Opdater UI

I `map.html`, tilføj toggle i layer-gruppen:

```html
<div class="layer-group">
  <div class="layer-list">
    <label class="layer-item layer-parent">
      <span>Min Gruppe</span>
      <input type="checkbox" id="toggle-my-group">
    </label>
    <label class="layer-item layer-child">
      <span>Mit Layer</span>
      <input type="checkbox" id="toggle-my-layer">
    </label>
  </div>
</div>
```

## Code Style

Projektet bruger **vanilla JavaScript** (uden frameworks). Follow disse regler:

### Navngivning
- Konstanter: `SCREAMING_SNAKE_CASE`
- Klasser: `PascalCase`
- Funktioner/variabler: `camelCase`
- Private metoder: `_leadingUnderscore`

### Error Handling
Brug global `errorHandler`:

```javascript
import errorHandler from './js/error-handler.js';

try {
  // code
} catch (error) {
  errorHandler.handle(error, 'Feature Name');
}
```

### State Management
Brug `stateManager` for persistent data:

```javascript
import stateManager from './js/state-manager.js';

// Gem
stateManager.set('myFeature.setting', value);

// Hent
const value = stateManager.get('myFeature.setting');

// Subscribe
stateManager.subscribe((key, value) => {
  console.log(`${key} changed to`, value);
});
```

### Dokumentation
Alle moduler skal have JSDoc kommentarer:

```javascript
/**
 * MyFunction - Kort beskrivelse
 * @param {string} param1 - Beskrivelse
 * @returns {Promise<Object>} Hvad returneres
 * @throws {Error} Hvornår fejler det
 */
export async function myFunction(param1) {
  // implementation
}
```

## Testing

Vi bruger **Jest** for unit tests.

```bash
# Kør tests
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

Eksempel test:

```javascript
// my-feature.test.js
import { myFunction } from './my-feature.js';

describe('MyFeature', () => {
  test('should do something', () => {
    const result = myFunction('input');
    expect(result).toBe('expected output');
  });
});
```

## Performance

- **Lazy load** data når features bliver aktive
- **Cache** ekstern API-svar lokalt
- **Use Web Workers** for tunge beregninger
- **Debounce** event handlers
- **Monitor** performance med Chrome DevTools

## Debugging

Sæt `DEBUG=true` i `.env` for verbose logging:

```
DEBUG=true
```

Eller i browser:
```javascript
window.DEBUG = 'true';
```

Se console for detaljerede logs:
- API calls
- Cache operations
- Performance metrics
- Error stack traces

## Commit Messages

Følg [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new feature
fix: fix a bug
docs: documentation updates
refactor: code refactoring
perf: performance improvements
test: add tests
chore: maintenance
```

Eksempler:
```
feat: add wind layer with live data
fix: prevent satellite trace memory leak
docs: update API documentation
```

## Pull Requests

1. Fork repoen
2. Opret feature branch: `git checkout -b feature/my-feature`
3. Commit ændringer: `git commit -m 'feat: my feature'`
4. Push: `git push origin feature/my-feature`
5. Åbn PR med beskrivelse af ændringer

## Reporting Issues

Brug GitHub Issues med:
- **Titel**: Kort og præcis
- **Description**: Hvad er problemet?
- **Steps to reproduce**: Hvordan reproduceres det?
- **Expected behavior**: Hvad skulle ske?
- **Actual behavior**: Hvad skete der?
- **Screenshots**: Hvis relevant
- **Environment**: Browser, OS, Node version

## Performance Benchmarks

Targets:
- **First load**: < 3 sekunder
- **Layer toggle**: < 100ms
- **Search**: < 200ms
- **Camera pan**: 60 FPS
- **Memory**: < 200MB base

Monitor med:
```javascript
window.DEBUG = 'true';
// Se performance metrics i console
```

---

Tak for at bidrage! 🚀


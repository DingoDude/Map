/**
 * DRAGGABLE-PANELS.JS - Gør UI-paneler flytbare
 */

class DraggablePanel {
  constructor(panelId, headerSelector = 'h3') {
    this.panel = document.getElementById(panelId);
    this.panelId = panelId;
    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.startLeft = 0;
    this.startTop = 0;

    if (!this.panel) return;

    this.header = this.panel.querySelector(headerSelector);
    if (!this.header) {
      this.header = this.panel.firstElementChild;
    }

    this.init();
  }

  init() {
    if (!this.header) return;

    this.header.style.cursor = 'grab';
    this.header.addEventListener('mousedown', (e) => this.start(e));
    document.addEventListener('mousemove', (e) => this.drag(e));
    document.addEventListener('mouseup', () => this.end());

    // Hent tidligere position fra localStorage
    const savedPos = localStorage.getItem(`panel-pos-${this.panelId}`);
    if (savedPos) {
      try {
        const { x, y } = JSON.parse(savedPos);
        this.panel.style.left = x + 'px';
        this.panel.style.top = y + 'px';
        this.panel.style.right = 'auto';
        this.panel.style.bottom = 'auto';
      } catch (e) {
        // Ignore parse errors
      }
    }
  }

  start(e) {
    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startLeft = this.panel.offsetLeft;
    this.startTop = this.panel.offsetTop;
    this.header.style.cursor = 'grabbing';
  }

  drag(e) {
    if (!this.isDragging) return;

    const deltaX = e.clientX - this.startX;
    const deltaY = e.clientY - this.startY;

    const newLeft = this.startLeft + deltaX;
    const newTop = this.startTop + deltaY;

    // Begræns til viewport
    const maxX = window.innerWidth - this.panel.offsetWidth;
    const maxY = window.innerHeight - this.panel.offsetHeight;

    this.panel.style.left = Math.max(0, Math.min(newLeft, maxX)) + 'px';
    this.panel.style.top = Math.max(0, Math.min(newTop, maxY)) + 'px';
    this.panel.style.right = 'auto';
    this.panel.style.bottom = 'auto';
  }

  end() {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.header.style.cursor = 'grab';

    // Gem position
    localStorage.setItem(`panel-pos-${this.panelId}`, JSON.stringify({
      x: this.panel.offsetLeft,
      y: this.panel.offsetTop
    }));
  }
}

// Initialiser draggable paneler
export function initDraggablePanels() {
  const draggablePanelIds = [
    'ui-panel',
    'satellite-info',
    'satellite-control-panel',
    'detail-panel',
    'live-camera-panel'
  ];

  draggablePanelIds.forEach(id => {
    new DraggablePanel(id);
  });
}

export default DraggablePanel;

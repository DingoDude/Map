/**
 * HELP-DIALOG.JS - Tastatur-genveje og help-system
 */

class HelpDialog {
  constructor() {
    this.isOpen = false;
    this.shortcuts = [
      { key: 'W/A/S/D', action: 'Pan kamera omkring' },
      { key: 'Pil op/ned/venstre/højre', action: 'Pan kamera (alternativ)' },
      { key: 'Q', action: 'Zoom ind' },
      { key: 'E', action: 'Zoom ud' },
      { key: 'Shift', action: 'Hold for hurtigere bevægelse' },
      { key: 'Klik på objekt', action: 'Vis detaljer' },
      { key: 'Dobbeltklik', action: 'Fokuser på objekt' },
      { key: 'Shift + ?', action: 'Denne hjælpedialog' },
      { key: 'Ctrl + S', action: 'Gem scene snapshot' },
      { key: 'H', action: 'Hjem (nulstil kamera)' },
      { key: 'F', action: 'Søg efter objekt' },
      { key: 'W', action: 'Tilføj til watchlist' }
    ];
  }

  initialize() {
    document.addEventListener('keydown', (e) => {
      if (e.shiftKey && e.key === '?') {
        e.preventDefault();
        this.toggle();
      }
    });

    // Lyt efter eksisterende help-knap hvis den findes
    const helpBtn = document.getElementById('help-button');
    if (helpBtn) {
      helpBtn.addEventListener('click', () => this.toggle());
    }
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    let dialog = document.getElementById('help-dialog');
    if (!dialog) {
      dialog = this.create();
      document.body.appendChild(dialog);
    }
    dialog.style.display = 'grid';
    this.isOpen = true;
  }

  close() {
    const dialog = document.getElementById('help-dialog');
    if (dialog) dialog.style.display = 'none';
    this.isOpen = false;
  }

  create() {
    const dialog = document.createElement('div');
    dialog.id = 'help-dialog';
    dialog.innerHTML = `
      <div class="help-backdrop"></div>
      <div class="help-content">
        <div class="help-header">
          <h2>🚀 Tastatur Genveje</h2>
          <button class="help-close" aria-label="Luk hjælp">×</button>
        </div>
        <div class="help-shortcuts">
          ${this.shortcuts.map(s => `
            <div class="shortcut-item">
              <kbd>${s.key}</kbd>
              <span>${s.action}</span>
            </div>
          `).join('')}
        </div>
        <div class="help-footer">
          <small>💡 Tryk <kbd>Shift+?</kbd> for at åbne denne dialog når som helst</small>
        </div>
      </div>
    `;

    dialog.querySelector('.help-close').addEventListener('click', () => this.close());
    dialog.querySelector('.help-backdrop').addEventListener('click', () => this.close());

    return dialog;
  }
}

const helpDialog = new HelpDialog();
export default helpDialog;

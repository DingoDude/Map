/**
 * ERROR-HANDLER.JS - Robust fejlhåndtering for hele appen
 * Centraliseret exception handling med recovery-strategier
 */

class AppErrorHandler {
  constructor() {
    this.errors = [];
    this.errorCallbacks = [];
    this.maxErrors = 50;
  }

  /**
   * Registrer error callback for at reagere på nye fejl
   */
  onError(callback) {
    this.errorCallbacks.push(callback);
  }

  /**
   * Catch async errors i promises
   */
  handleAsync(promise, context = 'Unknown') {
    return promise.catch(error => {
      this.handle(error, context);
      throw error; // Re-throw for videre håndtering hvis nødvendigt
    });
  }

  /**
   * Wrap async funktion med error handling
   */
  wrapAsync(fn, context = 'Async Operation') {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        this.handle(error, context);
        throw error;
      }
    };
  }

  /**
   * Wrap sync funktion med error handling
   */
  wrapSync(fn, context = 'Sync Operation') {
    return (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        this.handle(error, context);
        throw error;
      }
    };
  }

  /**
   * Hovedfejlhåndter
   */
  handle(error, context = 'Unknown') {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      context,
      message: error?.message || String(error),
      stack: error?.stack || '',
      type: error?.name || 'Error',
      url: window.location.href
    };

    // Begræns antal gemte fejl
    this.errors.push(errorInfo);
    if (this.errors.length > this.maxErrors) {
      this.errors.shift();
    }

    // Log til konsol i dev mode
    if (window.DEBUG === 'true') {
      console.error(`🔴 [${context}]`, error);
    }

    // Notifiser listeners
    this.errorCallbacks.forEach(cb => {
      try {
        cb(errorInfo);
      } catch (e) {
        console.error('Error in error callback:', e);
      }
    });

    // Vis fejl i UI
    this.displayError(errorInfo);
  }

  /**
   * Vis fejl i UI-panel
   */
  displayError(errorInfo) {
    const errorBox = document.getElementById('app-error');
    if (!errorBox) return;

    errorBox.style.display = 'block';
    errorBox.style.whiteSpace = 'pre-wrap';
    errorBox.style.wordWrap = 'break-word';
    errorBox.style.maxHeight = '200px';
    errorBox.style.overflowY = 'auto';
    errorBox.style.fontSize = '11px';
    errorBox.style.lineHeight = '1.4';

    const lines = [
      `🔴 ${errorInfo.type}: ${errorInfo.message}`,
      `📍 Kontekst: ${errorInfo.context}`,
      `⏰ ${errorInfo.timestamp}`
    ];

    if (window.DEBUG === 'true' && errorInfo.stack) {
      lines.push('', '📋 Stack trace:');
      lines.push(errorInfo.stack.split('\n').slice(0, 5).join('\n'));
    }

    errorBox.textContent = lines.join('\n');

    // Auto-hide efter 8 sekunder hvis det ikke er kritisk
    if (errorInfo.type !== 'Error') {
      setTimeout(() => {
        if (errorBox.style.display === 'block') {
          errorBox.style.display = 'none';
        }
      }, 8000);
    }
  }

  /**
   * Hent alle fejl
   */
  getErrors() {
    return [...this.errors];
  }

  /**
   * Slet fejlhistorik
   */
  clearErrors() {
    this.errors = [];
  }

  /**
   * Rapport af fejl (til debugging)
   */
  generateReport() {
    return {
      totalErrors: this.errors.length,
      errors: this.errors.map(e => ({
        time: e.timestamp,
        context: e.context,
        type: e.type,
        message: e.message
      }))
    };
  }
}

// Globalt error handler instance
const errorHandler = new AppErrorHandler();

// Setup globale event listeners
window.addEventListener('error', (event) => {
  errorHandler.handle(
    new Error(event.message),
    `JavaScript Error at ${event.filename}:${event.lineno}`
  );
});

window.addEventListener('unhandledrejection', (event) => {
  errorHandler.handle(
    event.reason || new Error('Unhandled Promise Rejection'),
    'Unhandled Promise Rejection'
  );
});

// Eksporter for brug i andre moduler
export default errorHandler;

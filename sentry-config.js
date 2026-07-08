// ========== SENTRY: Monitoring + Error Tracking ==========
// Cole seu DSN do Sentry e execute isto

// Configuração Sentry
const SENTRY_DSN = 'https://YOUR_SENTRY_DSN@sentry.io/YOUR_PROJECT_ID';

// Inicializar Sentry
(function initSentry() {
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@sentry/browser@7.91.0/build/bundle.min.js';
  script.onload = function() {
    window.Sentry.init({
      dsn: SENTRY_DSN,
      environment: window.location.hostname.includes('localhost') ? 'development' : 'production',
      tracesSampleRate: 0.5, // Capturar 50% das traces em prod
      debug: false,

      // Release tracking
      release: '1.0.0',

      // User context (se autenticado)
      beforeSend(event, hint) {
        // Não capturar erros de rede menores
        if (event.exception) {
          const error = hint.originalException;
          if (error.name === 'NetworkError') {
            return null; // Ignorar
          }
        }
        return event;
      },

      // Integrations
      integrations: [
        new window.Sentry.Replay({
          maskAllText: true,
          blockAllMedia: true
        })
      ],

      // Session Replay
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0
    });

    // Capturar user context se autenticado
    captureUserContext();

    // Setup global error handling
    setupGlobalErrorHandling();
  };
  document.head.appendChild(script);
})();

// Capturar contexto do usuário
async function captureUserContext() {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      window.Sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.email?.split('@')[0]
      });

      // Tags extras
      window.Sentry.setTag('auth_method', user.app_metadata?.provider || 'unknown');
    }
  } catch (err) {
    console.log('User context capture failed');
  }
}

// Setup global error handling
function setupGlobalErrorHandling() {
  // Uncaught exceptions
  window.addEventListener('error', (event) => {
    window.Sentry.captureException(event.error, {
      tags: { category: 'uncaught_exception' }
    });
  });

  // Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    window.Sentry.captureException(event.reason, {
      tags: { category: 'unhandled_rejection' }
    });
  });

  // Supabase errors
  if (window.supabase) {
    const originalFrom = window.supabase.from;
    window.supabase.from = function(...args) {
      const table = originalFrom.apply(this, args);

      // Wrap query methods
      const methods = ['select', 'insert', 'update', 'delete', 'upsert', 'rpc'];
      methods.forEach(method => {
        const original = table[method];
        table[method] = function(...methodArgs) {
          const result = original.apply(this, methodArgs);

          if (result.then) {
            result.catch(err => {
              window.Sentry.captureException(err, {
                tags: {
                  category: 'supabase_error',
                  table: args[0],
                  method: method
                }
              });
            });
          }

          return result;
        };
      });

      return table;
    };
  }
}

// Capture performance metrics
function capturePerformanceMetrics() {
  if (window.performance && window.performance.getEntriesByType) {
    const navigationTiming = window.performance.getEntriesByType('navigation')[0];

    if (navigationTiming) {
      window.Sentry.captureMessage('Performance Metrics', 'info', {
        contexts: {
          performance: {
            dns_lookup: navigationTiming.domainLookupEnd - navigationTiming.domainLookupStart,
            tcp_connection: navigationTiming.connectEnd - navigationTiming.connectStart,
            ttfb: navigationTiming.responseStart - navigationTiming.requestStart,
            dom_interactive: navigationTiming.domInteractive - navigationTiming.fetchStart,
            dom_complete: navigationTiming.domComplete - navigationTiming.fetchStart,
            page_load: navigationTiming.loadEventEnd - navigationTiming.fetchStart
          }
        }
      });
    }
  }
}

// Executar após página carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', capturePerformanceMetrics);
} else {
  capturePerformanceMetrics();
}

// Export para uso global
window.SentryErrorLog = {
  error: (message, context) => {
    window.Sentry.captureMessage(message, 'error', { extra: context });
  },
  warning: (message, context) => {
    window.Sentry.captureMessage(message, 'warning', { extra: context });
  },
  info: (message, context) => {
    window.Sentry.captureMessage(message, 'info', { extra: context });
  }
};

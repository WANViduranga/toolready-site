/* ============================================
   PWA.JS
   Registers the service worker so the site becomes installable
   and works offline. Uses an absolute path ('/sw.js') deliberately -
   a relative path here would resolve differently depending on how
   deep the current page is (e.g. /calculators/x.html), which would
   incorrectly scope the worker. This only does anything over a real
   HTTPS deployment - browsers require a secure context for service
   workers, so this is a silent no-op when testing locally via
   file://, which is expected and fine.
   ============================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Silent - most likely just running locally over file://, not an error worth surfacing.
    });
  });
}

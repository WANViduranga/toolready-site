/* ============================================
   TRACKING.JS
   Fires one GA4 event ("tool_used") the first time a visitor
   interacts with any input on the page - i.e. actually starts
   using the calculator, not just landing on it (page views are
   already tracked automatically by the GA tag).

   Deliberately generic: it derives which tool was used from the
   URL path, so it works identically on every page with zero
   per-page configuration - nothing here needs editing when new
   calculators are added, and it can't interfere with any
   calculator's own logic since it's entirely separate code
   listening at the document level.
   ============================================ */
(function () {
  let fired = false;

  function trackToolUse() {
    if (fired) return;
    fired = true;
    if (typeof gtag !== 'function') return;

    const segments = location.pathname.split('/').filter(Boolean);
    const toolName = segments.length ? segments[segments.length - 1].replace(/\.html$/, '') : 'home';
    const toolCategory = segments.length > 1 ? segments[0] : 'home';

    gtag('event', 'tool_used', {
      tool_name: toolName,
      tool_category: toolCategory
    });
  }

  // Capture phase + document-level listener means this works even
  // though it's attached before the page's own inputs exist yet.
  document.addEventListener('input', trackToolUse, { capture: true, once: true });
  document.addEventListener('change', trackToolUse, { capture: true, once: true });
})();

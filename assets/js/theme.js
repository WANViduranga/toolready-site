/* ============================================
   THEME.JS
   Injects a light/dark toggle button into the header on every
   page, and handles switching + persisting the choice.

   The actual *initial* theme is set by a tiny inline script in
   each page's <head> (before this file loads) so there's no
   flash of the wrong theme on page load - this file only handles
   the toggle button and subsequent switches.
   ============================================ */
(function () {
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyIcon(button) {
    button.textContent = currentTheme() === 'dark' ? '☀' : '☾';
    button.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  }

  function toggleTheme(button) {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('toolready-theme', next); } catch (e) {}
    applyIcon(button);
  }

  function injectButton() {
    const nav = document.querySelector('.main-nav');
    if (!nav) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme-toggle';
    applyIcon(button);
    button.addEventListener('click', () => toggleTheme(button));
    nav.parentElement.insertBefore(button, nav.nextSibling);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectButton);
  } else {
    injectButton();
  }
})();

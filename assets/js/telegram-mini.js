/* ============================================
   TELEGRAM-MINI.JS
   Runs ONLY when the site is opened inside Telegram as a Mini App.
   Does nothing on a normal browser visit - isTgMiniApp() returns
   false there, so this whole file becomes a no-op.

   What this handles:
   1. Applying Telegram's live theme colors (light/dark) to our
      existing CSS variables, so the site matches the user's
      Telegram app instead of always using the web palette.
   2. Calling ready()/expand() so the Mini App opens full-height
      instead of a half-sheet.
   3. Wiring the Back Button on calculator/tool pages so it
      navigates to the home page, like a native back gesture.
   4. Loading the Monetag Mini App SDK (zone 11831987) and
      triggering their In-App Interstitial format, which shows
      automatically on its own schedule - separate from, and never
      conflicting with, the web zone (11828923).
   ============================================ */

(function () {
  if (!window.isTgMiniApp || !window.isTgMiniApp()) return; // not in Telegram - do nothing

  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();

  /* ---- 1. Theme sync ----
     Telegram gives us hex colors (no '#') for the user's current
     theme. We map them onto the SAME variable names style.css
     already uses, but only inside html.tg-mode, so the normal
     site look is completely untouched. See the .tg-mode block
     added to style.css for the CSS side of this. */
  function applyTheme() {
    const p = tg.themeParams || {};
    const root = document.documentElement.style;
    const set = (cssVar, value) => { if (value) root.setProperty(cssVar, '#' + value.replace('#', '')); };

    set('--tg-bg', p.bg_color);
    set('--tg-secondary-bg', p.secondary_bg_color);
    set('--tg-text', p.text_color);
    set('--tg-hint', p.hint_color);
    set('--tg-link', p.link_color);
    set('--tg-button', p.button_color);
    set('--tg-button-text', p.button_text_color);

    // Telegram also exposes light/dark as colorScheme - handy if you
    // want to branch logic in JS later (not needed for pure CSS vars).
    document.documentElement.dataset.tgColorScheme = tg.colorScheme || 'light';
  }
  applyTheme();
  tg.onEvent('themeChanged', applyTheme);

  /* ---- 2. Back Button ----
     Home page (index.html): no back button, nothing to go back to.
     Every calculator/tool page: show it, and send the user home. */
  const isHome = /\/(index\.html)?$/.test(location.pathname);
  if (!isHome) {
    tg.BackButton.show();
    tg.BackButton.onClick(function () {
      // both calculators/ and tools/ pages are one level deep
      window.location.href = '../index.html';
    });
  } else {
    tg.BackButton.hide();
  }

  /* ---- 3. Mini App ad zone ----
     The web version's Monetag script (zone 11828923) is skipped
     inside Telegram - see the inline guard added near the top of
     each page's <head>. This is the SEPARATE Monetag zone created
     specifically for the Telegram Mini App (zone 11831987), using
     their In-App Interstitial format: it shows automatically on
     its own schedule, no click or reward action needed from us.

     Loaded dynamically (same pattern as the web zone's script) so
     it only ever runs inside Telegram - never on the plain website. */
  const tgAdScript = document.createElement('script');
  tgAdScript.src = '//libtl.com/sdk.js';
  tgAdScript.setAttribute('data-zone', '11831987');
  tgAdScript.setAttribute('data-sdk', 'show_11831987');
  tgAdScript.onload = function () {
    if (typeof window.show_11831987 !== 'function') return;
    window.show_11831987({
      type: 'inApp',
      inAppSettings: {
        frequency: 2,   // show up to 2 ads automatically...
        capping: 0.1,   // ...within a 0.1 hour (6 min) window...
        interval: 30,   // ...at least 30s apart...
        timeout: 5,     // ...with a 5s delay before the first one
        everyPage: false // keep counting across page navigations, not resetting each page
      }
    });
  };
  document.head.appendChild(tgAdScript);
})();

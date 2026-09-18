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
   4. Loading the Telegram-specific Monetag ad zone into the same
      .ad-slot containers the web version uses - see the TODO
      below once you have that zone ID from Monetag.
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
     each page's <head>. Once you create a Telegram Mini App zone
     in the Monetag dashboard, drop its zone ID below and this will
     load it into the same .ad-slot containers automatically.

     TODO: replace 'YOUR_TG_ZONE_ID' once you have it from Monetag,
     then remove the early "return" line below this comment. */
  return; // <-- remove this line once TG_ZONE_ID is set

  // eslint-disable-next-line no-unreachable
  const TG_ZONE_ID = 'YOUR_TG_ZONE_ID';
  (function (s) {
    s.dataset.zone = TG_ZONE_ID;
    s.src = 'https://n6wxm.com/vignette.min.js'; // confirm this is the correct TG Mini App script URL in Monetag's dashboard - it may differ from the web snippet
  })([document.documentElement, document.body].filter(Boolean).pop().appendChild(document.createElement('script')));
})();

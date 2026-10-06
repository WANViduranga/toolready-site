/* Sets the saved/OS theme before first paint. External file (not inline)
   so pages with a strict Content-Security-Policy can use it. */
(function () {
  try {
    var t = localStorage.getItem('toolready-theme');
    if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();

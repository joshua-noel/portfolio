// Runs in <head> of every page (the main site, the blog and Learn) before first paint,
// as a classic script, so there is no flash: the theme the reader last chose. It is a
// file, not an inline script, so the learn host's Content-Security-Policy can say
// `script-src 'self'` and nothing more.
//
// The choice is read from, in this order: the `theme` cookie shared by the site's
// hostnames (only the exact values `dark` and `light`; anything else is ignored),
// then this host's localStorage, then the default (dark, set in the markup).
// The server never reads that cookie. theme.js writes it.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var theme = null;
  try {
    var match = /(?:^|;\s*)theme=([^;]*)/.exec(document.cookie);
    if (match && (match[1] === "light" || match[1] === "dark")) theme = match[1];
  } catch (error) {}
  if (theme === null) {
    try {
      theme = localStorage.getItem("learn-theme");
    } catch (error) {}
  }
  if (theme === "light" || theme === "dark") root.dataset.theme = theme;
})();

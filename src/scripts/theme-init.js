// Runs in <head> of every page (the main site, the blog and Learn) before first paint,
// as a classic script, so there is no flash:
// the theme the reader last chose. It is a file, not an inline script, so the
// learn host's Content-Security-Policy can say `script-src 'self'` and nothing
// more.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var theme = localStorage.getItem("learn-theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
  } catch (error) {}
})();

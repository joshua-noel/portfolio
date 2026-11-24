// Runs in <head> before first paint, as a classic script, so there is no flash:
// the theme, and the depth the reader last chose when the URL does not name
// one. It is a file, not an inline script, so the learn host's
// Content-Security-Policy can say `script-src 'self'` and nothing more.
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  try {
    var theme = localStorage.getItem("learn-theme");
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    if (root.dataset.depth) {
      var asked = /[?&]depth=(tip|waterline|deep|abyss)(?:&|$)/.exec(location.search);
      var depth = asked ? asked[1] : localStorage.getItem("learn-depth");
      if (/^(tip|waterline|deep|abyss)$/.test(depth)) root.dataset.depth = depth;
    }
  } catch (error) {}
})();

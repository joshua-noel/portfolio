// Which way a navigation inside Learn goes, for the page transitions in learn.css
// (cross-document view transitions). A classic script in <head>, a file rather than
// inline so the Content-Security-Policy (`script-src 'self'`) is untouched; it runs
// before the new page's first paint, when `pagereveal` fires. It does nothing in a
// browser without view transitions, and nothing is measured or animated here: it
// only names the direction. The rest is CSS.
//
//   rise     the shelf or a course page  ->  a lecture
//   descend  a lecture                   ->  the shelf or a course page (and the Back button)
//   fade     anything else (a lecture to the next, search, sign-in): the quiet cross-fade
(function () {
  if (!("onpagereveal" in window) || typeof navigation === "undefined") return;

  // Routes with one segment that are not a course.
  var other = { search: 1, signin: 1, signout: 1, covers: 1, media: 1 };
  function kind(url) {
    var parts = new URL(url).pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "shelf";
    if (parts.length === 1) return other[parts[0]] ? "other" : "course";
    return parts[0] === "covers" || parts[0] === "media" ? "other" : "lecture";
  }

  window.addEventListener("pagereveal", function (event) {
    var transition = event.viewTransition;
    var activation = navigation.activation;
    if (!transition || !activation || !activation.from) return;
    var from = kind(activation.from.url);
    var to = kind(activation.entry.url);
    if (from === "other" || to === "other") transition.types.add("fade");
    else if (to === "lecture" && from !== "lecture") transition.types.add("rise");
    else if (from === "lecture" && to !== "lecture") transition.types.add("descend");
    else transition.types.add("fade");
  });
})();

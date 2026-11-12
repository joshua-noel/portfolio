// One panel per scroll on the homepage.
//
// CSS scroll snapping alone cannot do this with a mouse wheel: each turn of
// the wheel moves the page a little, and the snap pulls it straight back, so
// the page never leaves the first panel. This script turns a wheel movement or
// a key press into "go to the next panel".
//
// It switches itself on (the `snap` class on <html>, which also enables the CSS
// snapping for touch and the scrollbar) only when every panel fits in the
// window. On a small window, or when the visitor asks for less motion, the
// page scrolls normally.

const root = document.documentElement;
const header = document.querySelector(".site-header");
const panels = [...document.querySelectorAll("main.site > section")];
const lessMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** Scroll positions to stop at: the top of each panel, then the very bottom. */
function stops() {
  const tops = panels.map((p) => Math.round(p.offsetTop - header.offsetHeight));
  const bottom = root.scrollHeight - innerHeight;
  return bottom - tops.at(-1) > 4 ? [...tops, bottom] : tops;
}

function fits() {
  const room = innerHeight - header.offsetHeight + 2;
  return (
    innerWidth >= 900 &&
    !lessMotion.matches &&
    panels.every((p) => p.offsetHeight <= room)
  );
}

function update() {
  root.classList.toggle("snap", panels.length > 0 && fits());
}

let busy = false; // moving, or the wheel that started the move is still turning
let quiet; // timer: the wheel has stopped

function go(direction) {
  const at = stops();
  const here = at.reduce(
    (best, y, i) => (Math.abs(y - scrollY) < Math.abs(at[best] - scrollY) ? i : best),
    0,
  );
  const next = Math.min(at.length - 1, Math.max(0, here + direction));
  if (next === here && Math.abs(at[here] - scrollY) < 2) return;
  busy = true;
  scrollTo({ top: at[next], behavior: "smooth" });
  release(700);
}

function release(ms) {
  clearTimeout(quiet);
  quiet = setTimeout(() => (busy = false), ms);
}

addEventListener(
  "wheel",
  (event) => {
    if (!root.classList.contains("snap") || event.ctrlKey) return; // ctrl+wheel is zoom
    event.preventDefault();
    // A trackpad keeps sending movement after the fingers lift; wait for it to
    // stop so that one swipe is one panel.
    if (busy) return release(250);
    if (Math.abs(event.deltaY) >= 4) go(Math.sign(event.deltaY));
  },
  { passive: false },
);

const KEYS = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 };

addEventListener("keydown", (event) => {
  if (!root.classList.contains("snap") || event.altKey || event.ctrlKey || event.metaKey)
    return;
  // Space on a link or button presses it; leave that alone.
  if (
    event.key === " " &&
    event.target instanceof Element &&
    event.target.closest("a, button")
  )
    return;
  const direction = event.key === " " && event.shiftKey ? -1 : KEYS[event.key];
  if (!direction) return;
  event.preventDefault();
  if (!busy) go(direction);
});

addEventListener("resize", update);
lessMotion.addEventListener("change", update);
update();

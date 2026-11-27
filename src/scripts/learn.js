// Everything the learn site does in the browser. Plain DOM, no framework.
// Each feature starts from server-rendered markup that already works without
// this file; the script only makes it quicker.

const root = document.documentElement;
const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Private mode or storage disabled: the choice lasts until the page closes.
    }
  },
};

// ---------------------------------------------------------------- drawer

const nav = document.querySelector("[data-sidenav]");
const navToggle = document.querySelector("[data-nav-toggle]");
const scrim = document.querySelector("[data-scrim]");

function setNav(open) {
  if (!nav || !navToggle || !scrim) return;
  nav.classList.toggle("is-open", open);
  navToggle.setAttribute("aria-expanded", String(open));
  scrim.hidden = !open;
}
navToggle?.addEventListener("click", () => setNav(!nav.classList.contains("is-open")));
scrim?.addEventListener("click", () => setNav(false));
nav?.addEventListener("click", (event) => {
  if (event.target instanceof Element && event.target.closest("a")) setNav(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") setNav(false);
});

// ---------------------------------------------------------------- headings

const lecture = document.querySelector("[data-lecture]");

function headings() {
  return [...document.querySelectorAll(".prose :is(h2, h3, h4)")];
}

// ---------------------------------------------------------------- wide maths

/** The width of the line a formula sits in. */
function room(formula) {
  const box = formula.parentElement?.closest("p, li, summary, dd, dt, blockquote, h2, h3, h4, div");
  if (!box) return Infinity;
  const style = getComputedStyle(box);
  return box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

/**
 * Marks the inline formulas that are wider than their line, so the style gives
 * them a box that scrolls (see `.wide-math`), and does not touch the others:
 * a box with an overflow sits on its bottom edge, not on the baseline. Boxes
 * that scroll (a wide formula, code, a table, a display formula, a diagram) can
 * be reached from the keyboard, or their far end could not be read.
 */
function fitMath() {
  for (const formula of document.querySelectorAll(
    ".prose .nobr, .prose .katex:not(.nobr .katex)",
  )) {
    if (formula.closest("td, th, .math-block")) continue; // these scroll in their own box
    let wide;
    if (formula.classList.contains("wide-math")) {
      wide = formula.scrollWidth > formula.clientWidth + 1;
    } else {
      const space = room(formula);
      wide = [...formula.getClientRects()].some((rect) => rect.width > space + 1);
    }
    formula.classList.toggle("wide-math", wide);
    if (wide) {
      formula.tabIndex = 0;
      formula.setAttribute("role", "group");
      formula.setAttribute("aria-label", "Formula, scrolls sideways");
    } else if (formula.getAttribute("role") === "group") {
      formula.removeAttribute("tabindex");
      formula.removeAttribute("role");
      formula.removeAttribute("aria-label");
    }
  }
  for (const box of document.querySelectorAll(
    ".prose pre, .table-wrap, .math-block, .diagram-body",
  )) {
    const scrolls = box.scrollWidth > box.clientWidth + 1;
    if (scrolls && !box.hasAttribute("tabindex")) {
      box.tabIndex = 0;
      box.dataset.scrolls = "";
    } else if (!scrolls && box.hasAttribute("data-scrolls")) {
      box.removeAttribute("tabindex");
      delete box.dataset.scrolls;
    }
  }
}

if (document.querySelector(".prose")) {
  let queued = false;
  const refit = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      fitMath();
    });
  };
  addEventListener("resize", refit);
  // The maths fonts arrive after the text, and are wider than the fallback.
  document.fonts?.ready.then(refit);
  fitMath();
}

// ---------------------------------------------------------------- on this page

const toc = document.querySelector("[data-toc]");
let ticking = false;

/** Marks the last heading that has scrolled past the top bar. */
function spy() {
  ticking = false;
  if (!toc) return;
  const line = parseFloat(getComputedStyle(root).getPropertyValue("--topbar")) * 16 + 24;
  let current;
  for (const heading of headings()) {
    if (heading.getBoundingClientRect().top <= line) current = heading;
    else break;
  }
  const atEnd =
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (atEnd)
    current =
      headings()
        .filter((h) => h.tagName === "H2")
        .at(-1) ?? current;
  for (const link of toc.querySelectorAll("a")) {
    const active = current && link.getAttribute("href") === `#${current.id}`;
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}
if (toc) {
  addEventListener(
    "scroll",
    () => {
      if (!ticking) requestAnimationFrame(spy);
      ticking = true;
    },
    { passive: true },
  );
  addEventListener("resize", spy);
  spy();
}

// ---------------------------------------------------------------- progress

function readProgress() {
  try {
    return JSON.parse(store.get("learn-progress") ?? "{}");
  } catch {
    return {};
  }
}

function paintProgress() {
  const progress = readProgress();
  for (const mark of document.querySelectorAll("[data-mark]")) {
    const state = progress[mark.dataset.mark];
    if (state) mark.dataset.state = state;
    else delete mark.dataset.state;
    const label =
      state === "done" ? "Read" : state === "started" ? "Started" : "Not started";
    mark.setAttribute("title", label);
  }
  const button = document.querySelector("[data-mark-toggle]");
  if (button) {
    const done = progress[button.dataset.markToggle] === "done";
    button.setAttribute("aria-pressed", String(done));
    button.querySelector("[data-mark-label]").textContent = done
      ? "Read"
      : "Mark as read";
  }
}

if (lecture) {
  const slug = lecture.dataset.lecture;
  const progress = readProgress();
  if (!progress[slug]) {
    progress[slug] = "started";
    store.set("learn-progress", JSON.stringify(progress));
  }
  document.querySelector("[data-mark-toggle]")?.addEventListener("click", () => {
    const now = readProgress();
    now[slug] = now[slug] === "done" ? "started" : "done";
    store.set("learn-progress", JSON.stringify(now));
    paintProgress();
  });
}
paintProgress();

// ---------------------------------------------------------------- search

const input = document.querySelector("[data-search]");
const results = document.querySelector("#search-results");

if (input && results) {
  let timer;
  let selected = -1;
  let latest = 0;

  const close = () => {
    results.hidden = true;
    selected = -1;
  };
  const options = () => [...results.querySelectorAll("a")];
  const select = (index) => {
    const items = options();
    if (items.length === 0) return;
    selected = (index + items.length) % items.length;
    items.forEach((item, i) =>
      item.setAttribute("aria-selected", String(i === selected)),
    );
    items[selected].scrollIntoView({ block: "nearest" });
  };

  function show(hits) {
    results.replaceChildren();
    if (hits.length === 0) {
      const none = document.createElement("li");
      none.className = "none";
      none.textContent = "Nothing matches.";
      results.append(none);
    }
    for (const hit of hits) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = hit.url;
      link.setAttribute("role", "option");
      const title = document.createElement("span");
      title.className = "hit-title";
      title.textContent = hit.title;
      link.append(title);
      if (hit.snippet) {
        const snippet = document.createElement("span");
        snippet.className = "hit-snippet";
        snippet.textContent = hit.snippet;
        link.append(snippet);
      }
      item.append(link);
      results.append(item);
    }
    selected = -1;
    results.hidden = false;
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    const query = input.value.trim();
    if (query.length < 2) return close();
    timer = setTimeout(async () => {
      const ticket = ++latest;
      try {
        const response = await fetch(`/search.json?q=${encodeURIComponent(query)}`);
        if (response.ok && ticket === latest) show(await response.json());
      } catch {
        // Offline: Enter still submits the form to the results page.
      }
    }, 120);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      select(selected + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      select(selected - 1);
    } else if (event.key === "Enter" && selected >= 0) {
      event.preventDefault();
      options()[selected].click();
    } else if (event.key === "Escape") {
      close();
      input.blur();
    }
  });
  document.addEventListener("click", (event) => {
    if (!(event.target instanceof Element) || !event.target.closest(".search")) close();
  });
  document.addEventListener("keydown", (event) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(
      document.activeElement?.tagName ?? "",
    );
    if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      input.focus();
    }
  });
}

// ---------------------------------------------------------------- diagrams

// An interactive diagram is plain SVG that works as a picture; its module,
// in ./learn-diagrams/<name>.js, is fetched only when the figure is near.
// `controls.js` is the modules' shared helper, not a diagram: leave it out, so
// `data-interactive="controls"` finds nothing instead of throwing.
const diagrams = import.meta.glob(["./learn-diagrams/*.js", "!./learn-diagrams/controls.js"]);
const figures = document.querySelectorAll("figure[data-interactive]");

if (figures.length > 0) {
  const watch = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        watch.unobserve(entry.target);
        const load = diagrams[`./learn-diagrams/${entry.target.dataset.interactive}.js`];
        load?.().then((module) => module.default(entry.target));
      }
    },
    { rootMargin: "300px" },
  );
  figures.forEach((figure) => watch.observe(figure));
}

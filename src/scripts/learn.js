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

// ---------------------------------------------------------------- theme

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  store.set("learn-theme", next);
});

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

// ---------------------------------------------------------------- depth

const DEPTHS = ["tip", "waterline", "deep", "abyss"];
const lecture = document.querySelector("[data-lecture]");

/** Links to other lectures carry the chosen depth, so it follows the reader. */
function carryDepth(depth) {
  for (const link of document.querySelectorAll("[data-lecture-link]")) {
    const url = new URL(link.getAttribute("href"), location.href);
    url.searchParams.set("depth", depth);
    link.setAttribute("href", url.pathname + url.search);
  }
}

function visibleHeadings() {
  return [...document.querySelectorAll(".prose :is(h2, h3, h4)")].filter(
    (heading) => heading.offsetParent !== null,
  );
}

function setDepth(depth) {
  if (!DEPTHS.includes(depth) || root.dataset.depth === depth) return;

  // Keep what the reader is looking at where it is while the page above it
  // grows or shrinks.
  const anchor = visibleHeadings().find(
    (heading) => heading.getBoundingClientRect().top >= 0,
  );
  const before = anchor?.getBoundingClientRect().top;

  root.dataset.depth = depth;
  store.set("learn-depth", depth);
  const url = new URL(location.href);
  url.searchParams.set("depth", depth);
  history.replaceState(history.state, "", url);
  carryDepth(depth);

  if (anchor && before !== undefined && anchor.offsetParent !== null) {
    window.scrollBy({
      top: anchor.getBoundingClientRect().top - before,
      behavior: "instant",
    });
  } else {
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  spy();
}

if (lecture) {
  // The head script already applied the remembered depth; the URL follows it,
  // so a copied address names what is on screen.
  const shown = root.dataset.depth;
  if (shown && !new URL(location.href).searchParams.has("depth")) {
    const url = new URL(location.href);
    url.searchParams.set("depth", shown);
    history.replaceState(history.state, "", url);
    carryDepth(shown);
  }

  const group = document.querySelector("[data-depth-switch]");
  group?.addEventListener("click", (event) => {
    const link = event.target instanceof Element && event.target.closest("a[data-depth]");
    if (!link) return;
    event.preventDefault();
    setDepth(link.dataset.depth);
  });
  group?.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const links = [...group.querySelectorAll("a[data-depth]")];
    const next = links[links.indexOf(document.activeElement) + step];
    if (next) {
      event.preventDefault();
      next.focus();
      setDepth(next.dataset.depth);
    }
  });
  document.querySelector("[data-depth-link]")?.addEventListener("click", (event) => {
    event.preventDefault();
    setDepth(event.currentTarget.dataset.depthLink);
  });
}

// ---------------------------------------------------------------- on this page

const toc = document.querySelector("[data-toc]");
const tocToggle = document.querySelector("[data-toc-toggle]");
tocToggle?.addEventListener("click", () => {
  tocToggle.setAttribute(
    "aria-expanded",
    String(tocToggle.getAttribute("aria-expanded") !== "true"),
  );
});

let ticking = false;

/** Marks the last heading that has scrolled past the top bar. */
function spy() {
  ticking = false;
  if (!toc) return;
  const line = parseFloat(getComputedStyle(root).getPropertyValue("--topbar")) * 16 + 24;
  let current;
  for (const heading of visibleHeadings()) {
    if (heading.getBoundingClientRect().top <= line) current = heading;
    else break;
  }
  const atEnd =
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (atEnd)
    current =
      visibleHeadings()
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
const diagrams = import.meta.glob("./learn-diagrams/*.js");
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

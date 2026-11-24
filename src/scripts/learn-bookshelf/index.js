// The landing page's bookshelf. The markup works without this file (a grid of
// course cards); this turns each cover into a book that stands on a shelf,
// moves a card's text into a panel when the book is opened, and adds the
// filter pills. Plain DOM, no framework, nothing fetched.
import { filterFromKey, matchesFilter } from "../../lib/learn/bookshelf-filter.ts";

const root = document.documentElement;
const shelf = document.querySelector("[data-bookshelf]");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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
      // Storage disabled: the choice lasts until the page closes.
    }
  },
};

// ---------------------------------------------------------------- depth

// The same four links as a lecture's switch; here they set the depth the
// reading times show, and which one the next lecture opens at.
document.querySelector("[data-depth-switch]")?.addEventListener("click", (event) => {
  const link = event.target instanceof Element && event.target.closest("a[data-depth]");
  if (!link) return;
  event.preventDefault();
  const depth = link.dataset.depth;
  root.dataset.depth = depth;
  store.set("learn-depth", depth);
  const url = new URL(location.href);
  url.searchParams.set("depth", depth);
  history.replaceState(history.state, "", url);
});

// ---------------------------------------------------------------- resume

// Reading progress is kept by learn.js as { "course/lecture": "started" | "done" },
// in the order the lectures were first opened: the last one still "started"
// is where the reader left off.
(function resume() {
  const target = document.querySelector("[data-resume]");
  if (!target) return;
  let progress;
  try {
    progress = JSON.parse(store.get("learn-progress") ?? "{}");
  } catch {
    return;
  }
  for (const key of Object.keys(progress).reverse()) {
    if (progress[key] !== "started") continue;
    const link = document.querySelector(`a[data-lecture-key="${CSS.escape(key)}"]`);
    if (!link) continue;
    const course = link.closest("[data-book]")?.querySelector(".d-title")?.textContent;
    const text = document.createElement("a");
    text.href = link.getAttribute("href");
    text.textContent = link.querySelector(".t")?.firstChild?.textContent?.trim() ?? key;
    target.replaceChildren("Continue where you left off: ", text);
    if (course) target.append(` (${course})`);
    target.hidden = false;
    return;
  }
})();

if (shelf) {
  const panel = shelf.querySelector("[data-panel]");
  const body = shelf.querySelector("[data-panel-body]");
  const status = shelf.querySelector("[data-status]");
  const rows = [...shelf.querySelectorAll("[data-row]")];
  const sections = [...shelf.querySelectorAll("[data-shelf-section]")];
  let open; // the <li> of the open book

  // ------------------------------------------------------------ books

  // Each cover becomes a button: one element to focus, to press and to name.
  for (const book of shelf.querySelectorAll("[data-book]")) {
    const vol = book.querySelector(".vol");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hit";
    button.setAttribute("aria-label", vol.dataset.label);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panel.id);
    button.tabIndex = -1;
    button.append(vol);
    book.prepend(button);
  }
  const hitOf = (book) => book.querySelector(".hit");
  const visibleBooks = (row) => [...row.querySelectorAll("[data-book]:not([hidden])")];

  /** One tab stop per shelf; the arrow keys move along it. */
  function rove(row, to) {
    const books = visibleBooks(row);
    const current = to ?? books.find((b) => hitOf(b).tabIndex === 0) ?? books[0];
    for (const book of row.querySelectorAll("[data-book]")) {
      hitOf(book).tabIndex = book === current ? 0 : -1;
    }
  }
  rows.forEach((row) => rove(row));

  shelf.addEventListener("focusin", (event) => {
    const book = event.target.closest?.("[data-book]");
    if (book && event.target.classList.contains("hit")) rove(book.parentElement, book);
  });

  shelf.addEventListener("keydown", (event) => {
    const hit = event.target;
    if (!(hit instanceof Element) || !hit.classList.contains("hit")) return;
    const book = hit.closest("[data-book]");
    const row = book.parentElement;
    const books = visibleBooks(row);
    const at = books.indexOf(book);
    let next;
    switch (event.key) {
      case "ArrowRight":
        next = books[at + 1];
        break;
      case "ArrowLeft":
        next = books[at - 1];
        break;
      case "Home":
        next = books[0];
        break;
      case "End":
        next = books.at(-1);
        break;
      case "ArrowDown":
      case "ArrowUp": {
        const shown = rows.filter((r) => visibleBooks(r).length > 0);
        const other = shown[shown.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)];
        if (other) {
          const there = visibleBooks(other);
          next = there[Math.min(at, there.length - 1)];
        }
        break;
      }
      default:
        return;
    }
    event.preventDefault();
    if (next) {
      hitOf(next).focus();
      hitOf(next).scrollIntoView({
        inline: "center",
        block: "nearest",
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    }
  });

  // ------------------------------------------------------------ panel

  const THEME = ["--b-color", "--b-accent", "--b-ink", "--b-soft", "--b-mark"];

  function fill(book) {
    const copy = book.querySelector("[data-detail]").cloneNode(true);
    const list = copy.querySelector(".d-list");
    const main = document.createElement("div");
    main.className = "panel-main";
    for (const node of [...copy.children]) if (node !== list) main.append(node);
    const cover = document.createElement("div");
    cover.className = "panel-cover";
    cover.setAttribute("aria-hidden", "true");
    cover.append(book.querySelector(".cover").cloneNode(true));
    const side = document.createElement("div");
    side.className = "panel-side";
    side.append(cover, main);
    body.replaceChildren(side, list);
    panel.setAttribute("aria-label", main.querySelector(".d-title").textContent);
    for (const name of THEME) {
      panel.style.setProperty(name, book.style.getPropertyValue(name));
    }
  }

  /** Brings the book along its row and the panel into view, once the panel has its height. */
  function reveal(book) {
    const behavior = reducedMotion.matches ? "auto" : "smooth";
    if (book.parentElement.hasAttribute("data-scroll")) {
      hitOf(book).scrollIntoView({ inline: "center", block: "nearest", behavior });
    }
    const show = () => panel.scrollIntoView({ block: "nearest", behavior });
    if (reducedMotion.matches) show();
    else setTimeout(show, 450);
  }

  /** The last case on the same row of the wall as this book's: the panel opens after it. */
  function anchorOf(book) {
    const section = book.closest("section");
    const top = Math.round(section.getBoundingClientRect().top);
    return sections
      .filter((s) => !s.hidden && Math.round(s.getBoundingClientRect().top) === top)
      .at(-1);
  }

  /** After the wall reflows (a resize, a filter) the open book's row may have changed: follow it. */
  function placePanel() {
    if (!open || panel.hidden) return;
    const anchor = anchorOf(open);
    if (panel.previousElementSibling === anchor) return;
    const focused =
      panel.contains(document.activeElement) || document.activeElement === panel;
    anchor.after(panel);
    if (focused) panel.focus({ preventScroll: true });
  }

  function openBook(book) {
    if (open === book) return;
    const anchor = anchorOf(book);
    const sameShelf = open && panel.previousElementSibling === anchor && !panel.hidden;
    if (open) markClosed(open);
    if (!sameShelf) {
      panel.classList.remove("is-open");
      panel.hidden = true;
    }
    open = book;
    shelf.classList.add("has-open");
    book.classList.add("is-open");
    hitOf(book).setAttribute("aria-expanded", "true");
    fill(book);
    if (!sameShelf) {
      anchor.after(panel);
      panel.hidden = false;
      // One frame with the panel at height 0, so opening has something to grow from.
      void panel.offsetHeight;
      panel.classList.add("is-open");
    }
    panel.focus({ preventScroll: true });
    reveal(book);
  }

  function markClosed(book) {
    book.classList.remove("is-open");
    hitOf(book).setAttribute("aria-expanded", "false");
  }

  function closeBook(returnFocus) {
    if (!open) return;
    const book = open;
    open = undefined;
    markClosed(book);
    shelf.classList.remove("has-open");
    panel.classList.remove("is-open");
    if (reducedMotion.matches) panel.hidden = true;
    else {
      const done = () => {
        if (!open) panel.hidden = true;
      };
      panel.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 480);
    }
    if (returnFocus) hitOf(book).focus();
  }

  shelf.addEventListener("click", (event) => {
    const hit = event.target instanceof Element && event.target.closest(".hit");
    if (!hit) return;
    const book = hit.closest("[data-book]");
    if (open === book) closeBook(false);
    else openBook(book);
  });
  shelf
    .querySelector("[data-panel-close]")
    .addEventListener("click", () => closeBook(true));

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !open) return;
    const at = document.activeElement;
    if (at === document.body || panel.contains(at) || at === hitOf(open)) {
      event.preventDefault();
      closeBook(true);
    }
  });
  // Clicking away closes it; clicking a book, the panel or a pill does not.
  document.addEventListener("click", (event) => {
    if (!open || !(event.target instanceof Element)) return;
    if (!event.target.closest("[data-panel], .hit, [data-filters], .topbar"))
      closeBook(false);
  });

  // ------------------------------------------------------------ filters

  const pills = [...shelf.querySelectorAll("[data-filter]")];

  function applyFilter(key) {
    const filter = filterFromKey(key);
    let shown = 0;
    for (const section of sections) {
      let here = 0;
      for (const book of section.querySelectorAll("[data-book]")) {
        const match = matchesFilter(
          { shelf: book.dataset.shelf, videos: Number(book.dataset.videos) },
          filter,
        );
        if (match && book.hidden && !reducedMotion.matches) {
          book.classList.add("is-in");
          book.addEventListener("animationend", () => book.classList.remove("is-in"), {
            once: true,
          });
        }
        book.hidden = !match;
        if (match) here += 1;
      }
      section.hidden = here === 0;
      section.querySelector(".shelf-count").textContent =
        `${here} course${here === 1 ? "" : "s"}`;
      shown += here;
    }
    if (open?.hidden) closeBook(false);
    rows.forEach((row) => {
      rove(row);
      row.scrollTo({ left: 0 });
    });
    measure();
    placePanel();
    if (status) status.textContent = `Showing ${shown} course${shown === 1 ? "" : "s"}.`;
  }

  for (const pill of pills) {
    pill.addEventListener("click", () => {
      for (const other of pills) {
        other.setAttribute("aria-pressed", String(other === pill));
      }
      applyFilter(pill.dataset.filter);
    });
  }

  // ------------------------------------------------------------ scroll arrows

  const pairs = sections.map((section) => ({
    row: section.querySelector("[data-row]"),
    arrows: section.querySelector("[data-arrows]"),
  }));

  function measure() {
    for (const { row, arrows } of pairs) {
      // Is there room for the books with only a little padding? If not, scroll.
      row.removeAttribute("data-scroll");
      const overflows = row.scrollWidth > row.clientWidth + 4;
      if (overflows) row.setAttribute("data-scroll", "");
      arrows.hidden = !overflows;
      if (!overflows) continue;
      const [left, right] = arrows.querySelectorAll("button");
      left.disabled = row.scrollLeft <= 2;
      right.disabled = row.scrollLeft + row.clientWidth >= row.scrollWidth - 2;
    }
  }
  for (const { row, arrows } of pairs) {
    arrows.addEventListener("click", (event) => {
      const button =
        event.target instanceof Element && event.target.closest("[data-scroll]");
      if (!button) return;
      row.scrollBy({
        left: Number(button.dataset.scroll) * row.clientWidth * 0.8,
        behavior: reducedMotion.matches ? "auto" : "smooth",
      });
    });
  }
  let queued = false;
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      measure();
      placePanel();
    });
  };
  for (const { row } of pairs) row.addEventListener("scroll", queue, { passive: true });
  new ResizeObserver(queue).observe(shelf);
  measure();
}

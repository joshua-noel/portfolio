// The landing page's bookshelf. The markup works without this file (a grid of
// course cards); this turns each cover into a book that stands on a shelf,
// moves a card's text into a panel when the book is opened, and adds the
// filter row. Plain DOM, no framework, nothing fetched.
import { filterFromKey, matchesFilter } from "../../lib/learn/bookshelf-filter.ts";

const shelf = document.querySelector("[data-bookshelf]");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

/** What a book is called to a screen reader: its title, its lectures, its reading time, and whether it is locked. */
function nameBooks() {
  for (const book of document.querySelectorAll("[data-book]")) {
    const hit = book.querySelector(".hit");
    if (!hit) continue;
    const minutes = book.dataset.minutes;
    const time = minutes ? `, about ${minutes} minutes` : "";
    const locked = book.hasAttribute("data-locked") ? ". Locked" : "";
    hit.setAttribute(
      "aria-label",
      `${book.querySelector(".vol").dataset.label}${time}${locked}`,
    );
  }
}

const store = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
};

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
  const cases = [...shelf.querySelectorAll(".bookcase")];
  const books = [...shelf.querySelectorAll("[data-book]")];
  let open; // the <li> of the open book
  let pulled; // the <li> of the book pulled out by the pointer or by keyboard focus
  let focused; // the <li> whose button has keyboard focus

  /** Whether the shelves are packed into bookcases, as on a wide screen, or each is a case of its own. */
  const packed = () => matchMedia("(min-width: 76rem)").matches;

  /**
   * Pulling a book out (or opening it) makes room: the books on either side of
   * it step aside, those before it one way and those after it the other, within
   * the case it stands in. The styles do the moving; this only says who is where.
   */
  function layout() {
    const lead = open ?? pulled;
    const scope = lead
      ? [
          ...(packed() ? lead.closest(".bookcase") : lead.parentElement).querySelectorAll(
            "[data-book]:not([hidden])",
          ),
        ]
      : [];
    const at = scope.indexOf(lead);
    for (const book of books) {
      const i = scope.indexOf(book);
      const side = i < 0 || i === at ? "" : i < at ? "before" : "after";
      if (side) book.dataset.side = side;
      else delete book.dataset.side;
      book.classList.toggle("is-pulled", book === lead && book !== open);
      book.classList.toggle("is-focus", book === focused);
    }
  }

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
  nameBooks();
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
    if (!book || !event.target.classList.contains("hit")) return;
    rove(book.parentElement, book);
    if (event.target.matches(":focus-visible")) {
      focused = pulled = book;
      layout();
    }
  });
  shelf.addEventListener("focusout", (event) => {
    const book = event.target.closest?.("[data-book]");
    if (book && book === focused) {
      focused = undefined;
      if (pulled === book) pulled = undefined;
      layout();
    }
  });

  // The pointer: a mouse pulls a book out; a finger only opens it. A book that
  // has stepped aside to make room is not pulled in its turn: it would slide
  // out from under the pointer, and the click aimed at it would land on a gap.
  // It stays where it is, under the pointer, until it is pressed, or until the
  // pointer leaves the books altogether.
  shelf.addEventListener("pointerover", (event) => {
    if (event.pointerType === "touch" || open) return;
    const book = event.target.closest?.("[data-book]");
    if (!book || !event.target.closest(".hit") || pulled === book || book.dataset.side) return;
    pulled = book;
    layout();
  });
  shelf.addEventListener("pointerout", (event) => {
    const to = event.relatedTarget instanceof Element ? event.relatedTarget : null;
    if (to?.closest("[data-book]")) return; // the book it moves onto decides
    if (!event.target.closest?.("[data-book]")) return;
    if (pulled && pulled !== focused) {
      pulled = undefined;
      layout();
    }
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
    if (book.parentElement.scrollWidth > book.parentElement.clientWidth + 4) {
      hitOf(book).scrollIntoView({ inline: "center", block: "nearest", behavior });
    }
    const show = () => panel.scrollIntoView({ block: "nearest", behavior });
    if (reducedMotion.matches) show();
    else setTimeout(show, 450);
  }

  /** The last case on the same row of the wall as this book's: the panel opens after it. */
  function anchorOf(book) {
    if (packed()) return book.closest(".bookcase");
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
    pulled = undefined;
    shelf.classList.add("has-open");
    book.classList.add("is-open");
    layout();
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
    layout();
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

  // A book may slide while it is pressed (its neighbours step aside as the
  // pointer arrives). Press and release then land on different elements, and the
  // browser sends the click to their common parent, not to the book. A click
  // that ends close to where it began still belongs to the book that was pressed.
  let pressed;
  shelf.addEventListener("pointerdown", (event) => {
    const hit = event.target instanceof Element && event.target.closest(".hit");
    pressed = hit ? { hit, x: event.clientX, y: event.clientY } : undefined;
  });
  /** The click events already acted on, so the click-away rule below skips them. */
  const handled = new WeakSet();
  shelf.addEventListener("click", (event) => {
    let hit = event.target instanceof Element && event.target.closest(".hit");
    if (!hit && pressed && Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < 24) {
      hit = pressed.hit;
    }
    pressed = undefined;
    if (!hit) return;
    handled.add(event);
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
    if (!open || handled.has(event) || !(event.target instanceof Element)) return;
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
    for (const bookcase of cases) {
      bookcase.hidden = [...bookcase.querySelectorAll("[data-shelf-section]")].every(
        (s) => s.hidden,
      );
    }
    if (open?.hidden) closeBook(false);
    rows.forEach((row) => {
      rove(row);
      row.scrollTo({ left: 0 });
    });
    measure();
    layout();
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
      const overflows = row.scrollWidth > row.clientWidth + 4;
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
      layout();
      placePanel();
    });
  };
  for (const { row } of pairs) row.addEventListener("scroll", queue, { passive: true });
  new ResizeObserver(queue).observe(shelf);
  measure();
}

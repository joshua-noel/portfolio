// The landing page's shelf. The markup works without this file (a grid of
// course cards); this stands the books on a tape that wraps around the page,
// turns the book in front to show its cover, moves a card's text into a panel
// when the book is opened, and wires the capsule, the two round buttons, the
// keyboard, the wheel and a drag. Plain DOM, no framework, nothing fetched.
//
// Every query is scoped to the shelf and to the element it expects, so
// nothing a cover's illustration contains can be mistaken for part of the page.
import { litPill } from "../../lib/learn/bookshelf-filter.ts";

const shelf = document.querySelector("[data-bookshelf]");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

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
  if (!target || !shelf) return;
  let progress;
  try {
    progress = JSON.parse(store.get("learn-progress") ?? "{}");
  } catch {
    return;
  }
  for (const key of Object.keys(progress).reverse()) {
    if (progress[key] !== "started") continue;
    const link = [...shelf.querySelectorAll("ol.d-list a[data-lecture-key]")].find(
      (a) => a.dataset.lectureKey === key,
    );
    if (!link) continue;
    const course = link.closest("li[data-book]")?.querySelector(".d-title")?.textContent;
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
  const stage = shelf.querySelector(":scope > [data-stage]");
  const row = stage?.querySelector(":scope > [data-row]");
  const items = row ? [...row.querySelectorAll(":scope > li[data-book]")] : [];
  const panel = shelf.querySelector(":scope > [data-panel]");
  const body = panel?.querySelector("[data-panel-body]");
  const status = shelf.querySelector(":scope > [data-status]");
  const arrows = shelf.querySelector(":scope > [data-arrows]");
  const pills = [...shelf.querySelectorAll(":scope > [data-filters] > button[data-filter]")];
  if (stage && items.length > 0 && panel && body) start();

  function start() {
    const n = items.length;
    const spines = items.map((li) => parseFloat(li.style.getPropertyValue("--t")) || 0.15);
    const pillList = pills.map((p) => ({ key: p.dataset.filter, first: Number(p.dataset.first) }));

    // The geometry, as fractions of a book's height: how wide a cover is, the
    // space the neighbours of the book in front leave, and between spines.
    const COVER = 0.75;
    const FIRST = 0.054;
    const GAP = 0.03;
    const PITCH = 0.18;
    /** The book in front: a little up, forward, tilted, turned to show its cover (the same functions as a spine's, so it moves in one go). */
    const FRONT = "translate3d(0, calc(var(--H) * -0.025), calc(var(--H) * 0.2)) rotateZ(-4.5deg) rotateY(-90deg)";

    const mod = (a, m) => ((a % m) + m) % m;
    const heightPx = () => stage.offsetHeight / 1.3;

    // ---------------------------------------------------------- the tape

    const tape = document.createElement("div");
    tape.className = "tape";
    // Pictures only: what is read is the list of names below.
    tape.setAttribute("aria-hidden", "true");

    const copyStyle = (from, to) => {
      for (const name of from.style) to.style.setProperty(name, from.style.getPropertyValue(name));
    };
    const labelOf = (li) => {
      const minutes = li.dataset.minutes;
      const time = minutes ? `, about ${minutes} minutes` : "";
      const locked = li.hasAttribute("data-locked") ? ". Locked" : "";
      return `${li.querySelector(":scope > .vol").dataset.label}${time}${locked}`;
    };

    /**
     * What a screen reader and the keyboard meet: one button per book, in a list
     * that is not drawn. The books on the tape are pictures of them, so which
     * slot is in front never decides what can be focused or read.
     */
    // The book in front is turned edge-on to its own plane, which no browser can hit-test:
    // a flat, invisible target stands over its cover, and a press on it opens the book.
    const front = document.createElement("div");
    front.className = "front";
    front.setAttribute("aria-hidden", "true");

    const names = document.createElement("ul");
    names.className = "names visually-hidden";
    names.setAttribute("role", "list");
    names.setAttribute("aria-label", "Courses");
    const buttons = items.map((li, i) => {
      const item = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.index = String(i);
      button.setAttribute("aria-label", labelOf(li));
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", panel.id);
      button.tabIndex = -1;
      item.append(button);
      names.append(item);
      return button;
    });

    /** The tape: a picture of each book at every slot, the faces moved out of the card for the first. */
    let copies = 0;
    let slots = []; // the elements, by slot
    const faces = items.map((li) => [...li.querySelector(":scope > .vol").children]);
    const copiesNeeded = () =>
      Math.max(1, Math.ceil((stage.clientWidth / (PITCH * heightPx()) + 4) / n));

    function build() {
      copies = copiesNeeded();
      for (const el of slots.slice(n)) el.remove();
      slots = slots.slice(0, n);
      for (let c = 0; c < copies; c++) {
        for (let i = 0; i < n; i++) {
          const s = c * n + i;
          if (slots[s]) continue;
          const book = document.createElement("span");
          book.className = "tb";
          book.setAttribute("aria-hidden", "true");
          copyStyle(items[i], book);
          // The first copy takes the card's own faces; the rest are drawn alike.
          for (const face of faces[i]) book.append(c === 0 ? face : face.cloneNode(true));
          slots[s] = book;
        }
      }
      slots.forEach((el, s) => {
        el.dataset.slot = String(s);
        tape.append(el);
      });
    }

    // ------------------------------------------------------ positions

    let pos = 0; // the slot in front
    let first = true;
    const N = () => slots.length;

    /** The x of the book at offset d from the one in front (d from -N/2), in book heights, and a table of them. */
    function placeAll() {
      const total = N();
      const half = Math.floor(total / 2);
      const t = (d) => spines[mod(pos + d, total) % n];
      const xs = new Map([[0, 0]]);
      let x = COVER / 2 + FIRST + t(1) / 2;
      for (let d = 1; d <= total - 1 - half; d++) {
        if (d > 1) x += t(d - 1) / 2 + GAP + t(d) / 2;
        xs.set(d, x);
      }
      x = -(COVER / 2 + FIRST + t(-1) / 2);
      for (let d = -1; d >= -half; d--) {
        if (d < -1) x -= t(d + 1) / 2 + GAP + t(d) / 2;
        xs.set(d, x);
      }
      return { total, half, xs };
    }

    function layout() {
      const { total, half, xs } = placeAll();
      const hpx = heightPx();
      const reach = stage.clientWidth / 2 + hpx * 0.8;
      for (let s = 0; s < total; s++) {
        const el = slots[s];
        const d = mod(s - pos + half, total) - half;
        const x = xs.get(d) ?? 0;
        const jumped = el._d !== undefined && Math.abs(d - el._d) > total / 2;
        if (jumped || first) {
          // Off the screen at both ends of its move: it only changes sides.
          el.classList.add("is-still");
          requestAnimationFrame(() => el.classList.remove("is-still"));
        }
        el.classList.toggle("is-selected", d === 0);
        el.classList.toggle(
          "is-gone",
          Math.abs(x * hpx) > reach && (el._x === undefined || Math.abs(el._x * hpx) > reach),
        );
        // The whole transform is set on the element itself, not through a custom property:
        // a custom property inherits, so changing one makes the browser recalculate the style
        // of every element inside the book, hundreds of them, for each book at each step.
        el.style.transform = d === 0 ? FRONT : `translate3d(calc(var(--H) * ${x.toFixed(4)}), 0, 0) rotateZ(0deg) rotateY(0deg)`;
        el.style.zIndex = String(d === 0 ? 100 : Math.max(1, 96 - 4 * (Math.abs(d) - 1)));
        el._d = d;
        el._x = x;
      }
      first = false;
      const at = mod(pos, n);
      buttons.forEach((b, i) => {
        b.tabIndex = i === at ? 0 : -1;
        if (i === at) b.setAttribute("aria-current", "true");
        else b.removeAttribute("aria-current");
      });
      const lit = litPill(pillList, at);
      for (const pill of pills) {
        if (pill.dataset.filter === lit) pill.setAttribute("aria-current", "true");
        else pill.removeAttribute("aria-current");
      }
    }

    /** The slot of book `i` nearest to the one in front. */
    function nearest(i) {
      let best = i;
      for (let c = 0; c < copies; c++) {
        const s = c * n + i;
        const dist = (a) => Math.min(mod(a - pos, N()), mod(pos - a, N()));
        if (dist(s) < dist(best)) best = s;
      }
      return best;
    }

    let focusAfter = false;
    function select(slot) {
      const next = mod(slot, N());
      if (next === pos) return;
      const was = mod(pos, n);
      pos = next;
      if (open && mod(pos, n) !== was) close(false);
      layout();
      const at = mod(pos, n);
      if (status) status.textContent = `${items[at].dataset.index * 1 + 1} of ${n}: ${items[at].querySelector(".d-title")?.textContent ?? ""}`;
      if (focusAfter) buttons[at].focus({ preventScroll: true });
    }
    const step = (by) => select(pos + by);

    // ----------------------------------------------------- the panel

    let open; // the button of the open book

    function fill(li) {
      const copy = li.querySelector(":scope > [data-detail]").cloneNode(true);
      const list = copy.querySelector(".d-list");
      const main = document.createElement("div");
      main.className = "panel-main";
      for (const node of [...copy.children]) if (node !== list) main.append(node);
      const side = document.createElement("div");
      side.className = "panel-side";
      side.append(main);
      body.replaceChildren(side, list);
      panel.setAttribute("aria-label", main.querySelector(".d-title").textContent);
    }

    function openBook() {
      const at = mod(pos, n);
      if (open === buttons[at]) return;
      if (open) open.setAttribute("aria-expanded", "false");
      open = buttons[at];
      open.setAttribute("aria-expanded", "true");
      fill(items[at]);
      panel.hidden = false;
      // The animation runs again each time it is shown.
      panel.style.animation = "none";
      void panel.offsetHeight;
      panel.style.animation = "";
      panel.focus({ preventScroll: true });
      panel.scrollIntoView({ block: "nearest", behavior: reduced.matches ? "auto" : "smooth" });
    }

    function close(returnFocus) {
      if (!open) return;
      const book = open;
      open = undefined;
      book.setAttribute("aria-expanded", "false");
      panel.hidden = true;
      if (returnFocus) book.focus();
    }

    shelf
      .querySelector("[data-panel-close]")
      ?.addEventListener("click", () => close(true));
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !open) return;
      const at = document.activeElement;
      if (at === document.body || panel.contains(at) || at === open) {
        event.preventDefault();
        close(true);
      }
    });

    // ----------------------------------------------------- the stage

    let dragged = false;
    stage.addEventListener("click", (event) => {
      if (dragged) {
        dragged = false;
        return;
      }
      if (!(event.target instanceof Element)) return;
      if (event.target.closest(".front")) return pressBook(pos);
      const target = event.target.closest(".tb");
      if (!target || !tape.contains(target)) return;
      pressBook(Number(target.dataset.slot));
    });

    /** A press on a book: the one in front opens (or closes); any other comes to the front. */
    function pressBook(slot) {
      if (slot === pos) {
        if (open === buttons[mod(pos, n)]) close(false);
        else openBook();
      } else select(slot);
    }

    // The names are buttons too: a screen reader or the keyboard presses them.
    names.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button[data-index]") : null;
      if (button) pressBook(nearest(Number(button.dataset.index)));
    });
    // The front book is ringed when the keyboard has its name.
    names.addEventListener("focusin", (event) => {
      stage.classList.toggle("is-keyboard", event.target.matches(":focus-visible"));
    });
    names.addEventListener("focusout", () => stage.classList.remove("is-keyboard"));

    // A drag along the row moves it a book at a time; a touch has no hover, only this and taps.
    let drag;
    stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX };
    });
    stage.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      if (Math.abs(dx) > heightPx() * 0.14) {
        dragged = true;
        step(dx < 0 ? 1 : -1);
        drag.x = event.clientX;
      }
    });
    const endDrag = () => {
      drag = undefined;
      // A click that follows the drag is not a press on a book.
      if (dragged) setTimeout(() => (dragged = false), 0);
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", endDrag);

    // A sideways wheel or trackpad swipe, a book at a time; the page's own scroll is left alone.
    let wheel = 0;
    let lastWheel = 0;
    stage.addEventListener(
      "wheel",
      (event) => {
        if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
        event.preventDefault();
        wheel += event.deltaX;
        if (Math.abs(wheel) > 60 && event.timeStamp - lastWheel > 260) {
          lastWheel = event.timeStamp;
          step(wheel > 0 ? 1 : -1);
          wheel = 0;
        }
      },
      { passive: false },
    );

    names.addEventListener("keydown", (event) => {
      let to;
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          to = pos + 1;
          break;
        case "ArrowLeft":
        case "ArrowUp":
          to = pos - 1;
          break;
        case "Home":
          to = nearest(0);
          break;
        case "End":
          to = nearest(n - 1);
          break;
        default:
          return;
      }
      event.preventDefault();
      focusAfter = true;
      select(to);
      focusAfter = false;
    });

    arrows?.addEventListener("click", (event) => {
      const button = event.target instanceof Element ? event.target.closest("button[data-step]") : null;
      if (button) step(Number(button.dataset.step));
    });
    if (arrows) arrows.hidden = false;

    for (const pill of pills) {
      pill.addEventListener("click", () => select(nearest(Number(pill.dataset.first))));
    }

    // ------------------------------------------------- the ring

    // Over the books the pointer is a ring; over the book in front it says "Open".
    if (matchMedia("(hover: hover) and (pointer: fine)").matches && !reduced.matches) {
      const ring = document.createElement("div");
      ring.className = "ring";
      ring.setAttribute("aria-hidden", "true");
      document.body.append(ring);
      document.documentElement.classList.add("has-ring");
      let at;
      let queued = 0;
      const draw = () => {
        queued = 0;
        if (at) ring.style.transform = `translate(${at.x}px, ${at.y}px)`;
      };
      stage.addEventListener("pointermove", (event) => {
        if (event.pointerType !== "mouse") return;
        at = { x: event.clientX, y: event.clientY };
        ring.classList.add("is-over");
        ring.classList.toggle("is-open", event.target instanceof Element && Boolean(event.target.closest(".front")));
        if (!queued) queued = requestAnimationFrame(draw);
      });
      stage.addEventListener("pointerleave", () => ring.classList.remove("is-over", "is-open"));
    }

    // ------------------------------------------------- start

    build();
    layout();
    let observed = stage.clientWidth;
    new ResizeObserver(() => {
      const needed = copiesNeeded();
      if (needed !== copies) {
        const front = mod(pos, n);
        build();
        pos = front;
        first = true;
      }
      if (stage.clientWidth !== observed || needed !== copies) {
        observed = stage.clientWidth;
        layout();
      }
    }).observe(stage);
    stage.append(tape, front, names);
  }
}

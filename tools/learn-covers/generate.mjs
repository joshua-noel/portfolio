#!/usr/bin/env node
// The cover illustrations of the bookshelf: one `cover.svg` beside each
// course's `course.md`, drawn from the course's own `cover` colours.
//
//   node tools/learn-covers/generate.mjs <content-dir> [--check]
//
// Without `--check` it (re)writes `<content-dir>/<course>/cover.svg` for every
// course it has a drawing of. With `--check` it writes nothing and exits 1 if
// a file is missing or differs, so a stale cover is found.
//
// One hand for every course: a 240 x 320 canvas, a 2.5 unit round stroke,
// squares with 3 to 5 unit corners, circles, straight lines, and three
// colours: the ink of the cover, a middle tone between ink and cover colour,
// and the accent. The cover is a full-bleed layer, so only the band between
// y 112 and 222 is used: the title stands above it and the promise below.
// The file has no text, no ids and no references, so the loader's checks pass
// and it may stand on a page several times.
//
// A drawing marks the shapes that make its spine mark with `m` (they get
// class="m") and names the box they fill in `data-mark="x y w h"`: the page
// shows only those shapes, cropped to that box, on the spine.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { contrast, mix } from "../../src/lib/learn/cover.ts";

const PAPER = "#fbfaf7";
const SW = 2.5;
/** The drawings are laid out on a band from y 112; the cover's own text leaves the band from y 102. */
const RISE = 12;

const n = (v) => String(Math.round(v * 100) / 100);

/** The colours of one cover. */
function palette(cover) {
  const bg = cover.color.toLowerCase();
  const accent = cover.accent.toLowerCase();
  const ink = mix(PAPER, bg, 0.92);
  return {
    bg,
    ink,
    mid: mix(PAPER, bg, 0.5),
    soft: mix(PAPER, bg, 0.13),
    // The accent, unless it cannot be seen on the cover colour.
    hot: contrast(accent, bg) >= 3 ? accent : ink,
  };
}

/** A drawing is a list of shapes; each helper returns one string. */
function toolbox(c) {
  const at = (m) => (m ? ' class="m"' : "");
  const paint = (o = {}) => {
    const fill = o.fill ?? "none";
    const stroke = o.w === 0 ? "none" : (o.stroke ?? c.ink);
    const dash = o.dash ? ` stroke-dasharray="${o.dash}"` : "";
    const width = o.w ? ` stroke-width="${o.w}"` : "";
    return ` fill="${fill}" stroke="${stroke}"${dash}${width}`;
  };
  return {
    rect: (x, y, w, h, o = {}) =>
      `<rect${at(o.m)} x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${o.rx ?? 3}"${paint(o)}/>`,
    circle: (x, y, r, o = {}) =>
      `<circle${at(o.m)} cx="${n(x)}" cy="${n(y)}" r="${n(r)}"${paint(o)}/>`,
    path: (d, o = {}) => `<path${at(o.m)} d="${d}"${paint(o)}/>`,
    line: (x1, y1, x2, y2, o = {}) =>
      `<line${at(o.m)} x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${paint(o)}/>`,
    /** A chevron at (x, y) pointing along (dx, dy). */
    head: (x, y, dx, dy, o = {}) => {
      const len = Math.hypot(dx, dy);
      const [ux, uy] = [dx / len, dy / len];
      const s = o.size ?? 5;
      const p = (a) => {
        const k = (a * Math.PI) / 180;
        const [cs, sn] = [Math.cos(k), Math.sin(k)];
        return `${n(x - s * (ux * cs - uy * sn))} ${n(y - s * (ux * sn + uy * cs))}`;
      };
      return `<path${at(o.m)} d="M${p(32)}L${n(x)} ${n(y)}L${p(-32)}"${paint(o)}/>`;
    },
  };
}

// ---------------------------------------------------------------------------
// The nine drawings. Each returns { shapes, mark: [x, y, w, h] }.

const DRAWINGS = {
  // A row of tokens enters a stack of blocks; attention arcs join positions;
  // a next-token distribution comes out.
  "how-language-models-work": (c, t) => {
    const s = [];
    // Tokens, the last one the position to predict.
    const centres = [33, 57.5, 82, 106.5, 131];
    centres.forEach((x, i) =>
      s.push(
        t.rect(x - 9, 206, 18, 14, {
          stroke: i === 4 ? c.hot : c.ink,
          dash: i === 4 ? "3 3" : undefined,
        }),
      ),
    );
    // Attention arcs from the last position back to earlier ones, and one between two others.
    const arc = (a, b, o) => {
      const [x1, x2] = [centres[a], centres[b]];
      const lift = Math.min(40, Math.abs(x1 - x2) * 0.38);
      return t.path(`M${x1} 203Q${n((x1 + x2) / 2)} ${n(203 - lift)} ${x2} 203`, o);
    };
    s.push(arc(4, 0, { stroke: c.mid }), arc(2, 1, { stroke: c.mid }));
    s.push(arc(4, 2, { stroke: c.hot }), arc(4, 3, { stroke: c.hot }));
    // The stack: three blocks of the same width.
    [120, 138, 156].forEach((y) => s.push(t.rect(24, y, 116, 13, { fill: c.soft, stroke: c.mid })));
    s.push(t.line(82, 199, 82, 172, { stroke: c.mid }), t.head(82, 172, 0, -1, { stroke: c.mid, size: 4 }));
    // The output: bars, the likeliest one in the accent.
    s.push(t.line(140, 145, 160, 145, { stroke: c.mid }), t.head(160, 145, 1, 0, { stroke: c.mid, size: 4 }));
    const bars = [10, 20, 40, 12, 26];
    bars.forEach((h, i) =>
      s.push(
        t.rect(168 + i * 11, 190 - h, 6, h, {
          m: true,
          rx: 1.5,
          fill: i === 2 ? c.hot : c.soft,
          stroke: i === 2 ? c.hot : c.ink,
        }),
      ),
    );
    s.push(t.line(164, 190, 220, 190, { m: true, stroke: c.mid }));
    return { shapes: s, mark: [160, 142, 64, 52] };
  },

  // Clients, a load balancer, replicated services, a data store.
  "system-design": (c, t) => {
    const s = [];
    const rows = [130, 166, 202];
    rows.forEach((y) => {
      s.push(t.rect(24, y - 6, 16, 12, { stroke: c.ink }));
      s.push(t.line(40, y, 64, 166 + (y - 166) * 0.35, { stroke: c.mid }));
    });
    s.push(t.rect(64, 138, 26, 56, { m: true, fill: c.soft, stroke: c.hot }));
    s.push(t.line(70, 160, 84, 160, { m: true, stroke: c.hot }), t.line(70, 172, 84, 172, { m: true, stroke: c.hot }));
    rows.forEach((y) => {
      s.push(t.line(90, 166 + (y - 166) * 0.35, 116, y, { m: true, stroke: c.mid }));
      s.push(t.rect(116, y - 11, 36, 22, { m: true, fill: c.soft, stroke: c.ink }));
      s.push(t.line(124, y, 144, y, { m: true, stroke: c.mid }));
      s.push(t.line(152, y, 180, 166 + (y - 166) * 0.3, { stroke: c.mid }));
    });
    // A data store.
    s.push(
      t.path("M180 150a15 5.5 0 0 1 30 0a15 5.5 0 0 1-30 0V186a15 5.5 0 0 0 30 0V150", { fill: c.soft, stroke: c.ink }),
      t.path("M180 168a15 5.5 0 0 0 30 0", { stroke: c.mid }),
    );
    return { shapes: s, mark: [60, 114, 98, 106] };
  },

  // A loss curve down by gradient steps; a small adapter beside a large frozen block.
  "training-and-fine-tuning": (c, t) => {
    const s = [];
    // Axes, then the curve: y = 206 - 86 e^(-u/26).
    s.push(t.path("M28 114V210H126", { stroke: c.mid }));
    const at = (u) => `${n(32 + u)} ${n(206 - 86 * Math.exp(-u / 26))}`;
    let d = `M${at(0)}`;
    for (let u = 2; u <= 92; u += 2) d += `L${at(u)}`;
    s.push(t.path(d, { stroke: c.ink }));
    [0, 12, 26, 44, 68, 92].forEach((u) => {
      const [x, y] = at(u).split(" ");
      s.push(t.circle(x, y, 3.2, { fill: c.ink, stroke: c.ink, w: 0 }));
    });
    // A large block of frozen weights, a grid of dots.
    s.push(t.rect(142, 120, 46, 92, { m: true, rx: 4, fill: c.soft, stroke: c.mid }));
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 6; j++)
        s.push(t.circle(155 + i * 10, 136 + j * 14, 1.8, { m: true, fill: c.mid, stroke: c.mid, w: 0 }));
    // The adapter, small, in the accent, joined to the block.
    s.push(t.line(188, 168, 196, 168, { m: true, stroke: c.hot }));
    s.push(t.rect(196, 154, 20, 28, { m: true, fill: c.hot, stroke: c.hot, rx: 4 }));
    return { shapes: s, mark: [138, 114, 82, 104] };
  },

  // A key-value cache that grows a token at a time; requests batched through one model.
  "inference-and-serving": (c, t) => {
    const s = [];
    const lanes = [122, 136, 150];
    // Requests in, tokens out.
    lanes.forEach((y, i) => {
      s.push(t.line(24, y, 98, y, { stroke: c.mid }), t.line(142, y, 216, y, { stroke: c.mid }));
      s.push(t.rect(34 + i * 14, y - 3, 10, 6, { rx: 1.5, fill: c.ink, stroke: c.ink, w: 0 }));
      s.push(t.rect(58 + ((i * 17) % 28), y - 3, 10, 6, { rx: 1.5, fill: c.ink, stroke: c.ink, w: 0 }));
      s.push(t.rect(160 + i * 14, y - 3, 10, 6, { rx: 1.5, fill: c.hot, stroke: c.hot, w: 0 }));
    });
    s.push(t.rect(100, 112, 40, 48, { rx: 4, fill: c.soft, stroke: c.ink }));
    s.push(t.line(110, 128, 130, 128, { stroke: c.mid }), t.line(110, 144, 130, 144, { stroke: c.mid }));
    // The cache: one more cell each step.
    const x0 = 83;
    for (let col = 0; col < 5; col++)
      for (let k = 0; k <= col; k++) {
        const newest = col === 4 && k === col;
        s.push(
          t.rect(x0 + col * 16, 214 - (k + 1) * 10 + 2, 10, 8, {
            m: true,
            rx: 1.5,
            fill: newest ? c.hot : c.soft,
            stroke: newest ? c.hot : c.mid,
          }),
        );
      }
    return { shapes: s, mark: [78, 166, 84, 52] };
  },

  // The loop: model, tool call, result, back to the model; a boundary round what the code controls.
  "agent-systems": (c, t) => {
    const s = [];
    s.push(t.rect(98, 114, 118, 108, { m: true, rx: 9, dash: "4 5", stroke: c.mid }));
    // The model, outside it.
    s.push(t.circle(56, 168, 19, { fill: c.soft, stroke: c.hot }), t.circle(56, 168, 5, { fill: c.hot, stroke: c.hot, w: 0 }));
    // Tool call and result, inside.
    s.push(t.rect(132, 124, 56, 24, { m: true, fill: c.soft, stroke: c.ink }));
    s.push(t.line(141, 136, 165, 136, { m: true, stroke: c.mid }));
    s.push(t.rect(132, 188, 56, 24, { m: true, fill: c.soft, stroke: c.ink }));
    s.push(t.line(141, 200, 179, 200, { m: true, stroke: c.mid }));
    // The loop.
    s.push(t.path("M72 158C100 156 108 136 132 136", { stroke: c.hot }), t.head(132, 136, 1, 0, { stroke: c.hot }));
    s.push(t.line(160, 148, 160, 188, { m: true, stroke: c.ink }), t.head(160, 188, 0, 1, { m: true, stroke: c.ink }));
    s.push(t.path("M132 200C104 200 98 182 75 177", { stroke: c.hot }), t.head(75, 177, -1, -0.25, { stroke: c.hot }));
    return { shapes: s, mark: [94, 110, 126, 116] };
  },

  // Nodes with a replicated log; one leader, messages in flight, one node cut off.
  "distributed-systems": (c, t) => {
    const s = [];
    const L = [120, 168];
    const nodes = [
      { p: [60, 134], log: [60, 113, 3] },
      { p: [180, 134], log: [180, 113, 3] },
      { p: [60, 204], log: [60, 218, 3] },
      { p: [180, 204], log: [180, 218, 2], cut: true },
    ];
    nodes.forEach(({ p, cut }) => {
      const [dx, dy] = [p[0] - L[0], p[1] - L[1]];
      const len = Math.hypot(dx, dy);
      const a = [L[0] + (dx / len) * 13, L[1] + (dy / len) * 13];
      const b = [p[0] - (dx / len) * 11, p[1] - (dy / len) * 11];
      if (cut) {
        s.push(t.line(a[0], a[1], a[0] + dx * 0.3, a[1] + dy * 0.3, { m: true, stroke: c.mid, dash: "3 4" }));
        s.push(t.line(b[0] - dx * 0.12, b[1] - dy * 0.12, b[0], b[1], { m: true, stroke: c.mid, dash: "3 4" }));
      } else {
        s.push(t.line(a[0], a[1], b[0], b[1], { m: true, stroke: c.mid }));
        // A message on its way.
        s.push(t.circle(a[0] + (b[0] - a[0]) * 0.5, a[1] + (b[1] - a[1]) * 0.5, 3, { m: true, fill: c.ink, stroke: c.ink, w: 0 }));
      }
      s.push(t.circle(p[0], p[1], 10, { m: true, fill: c.soft, stroke: cut ? c.mid : c.ink, dash: cut ? "3 3" : undefined }));
    });
    s.push(t.circle(L[0], L[1], 13, { m: true, fill: c.hot, stroke: c.hot }));
    // Logs: a row of entries by each node; the cut-off one has fallen behind.
    const log = (x, y, count, total = 3) => {
      for (let i = 0; i < total; i++)
        s.push(
          t.rect(x - 13 + i * 9.5, y - 3.5, 7, 7, {
            rx: 1.5,
            fill: i < count ? c.ink : "none",
            stroke: i < count ? c.ink : c.mid,
            w: i < count ? 0 : 1.5,
          }),
        );
    };
    nodes.forEach(({ log: l }) => log(l[0], l[1], l[2]));
    log(120, 192, 3);
    return { shapes: s, mark: [44, 120, 152, 100] };
  },

  // Nested trust boundaries round an asset; one checked crossing.
  "security-foundations": (c, t) => {
    const s = [];
    const y = 167;
    // Three rings, each open where the one crossing goes through.
    const ring = (x, top, w, h, r, o) => {
      const [x2, bottom] = [x + w, top + h];
      return t.path(
        `M${x} ${y - 7}V${top + r}Q${x} ${top} ${x + r} ${top}H${x2 - r}Q${x2} ${top} ${x2} ${top + r}V${bottom - r}Q${x2} ${bottom} ${x2 - r} ${bottom}H${x + r}Q${x} ${bottom} ${x} ${bottom - r}V${y + 7}`,
        o,
      );
    };
    s.push(ring(26, 112, 188, 110, 10, { dash: "4 5", stroke: c.mid }));
    s.push(ring(52, 128, 136, 78, 8, { m: true, dash: "4 5", stroke: c.mid }));
    s.push(ring(78, 144, 84, 46, 6, { m: true, stroke: c.ink }));
    // The asset.
    s.push(t.rect(112, 159, 16, 16, { m: true, rx: 3, fill: c.hot, stroke: c.hot }));
    // The crossing, with its check at the outer gate.
    s.push(t.line(12, y, 105, y, { m: true, stroke: c.ink }), t.head(108, y, 1, 0, { m: true, stroke: c.ink, size: 4 }));
    s.push(t.circle(26, y, 8.5, { fill: c.bg, stroke: c.hot }));
    s.push(t.path("M22 167.5l3 3 6-6.5", { stroke: c.hot }));
    return { shapes: s, mark: [46, 122, 150, 90] };
  },

  // A B-tree over rows, with one lookup followed down it.
  "database-systems": (c, t) => {
    const s = [];
    const node = (x, y, o = {}) => {
      const out = [t.rect(x, y, 48, 14, { m: o.m, rx: 3, fill: c.soft, stroke: c.ink })];
      out.push(t.line(x + 16, y + 2, x + 16, y + 12, { m: o.m, stroke: c.mid, w: 1.5 }));
      out.push(t.line(x + 32, y + 2, x + 32, y + 12, { m: o.m, stroke: c.mid, w: 1.5 }));
      return out;
    };
    // Lines first, so the nodes sit on them.
    s.push(t.line(104, 126, 48, 148, { stroke: c.mid }), t.line(136, 126, 192, 148, { stroke: c.mid }));
    s.push(t.line(120, 126, 120, 148, { m: true, stroke: c.hot }));
    [48, 120, 192].forEach((cx) => s.push(t.line(cx, 162, cx, 184, { m: cx === 120, stroke: cx === 120 ? c.hot : c.mid })));
    s.push(...node(96, 112, { m: true }), ...node(24, 148), ...node(96, 148, { m: true }), ...node(168, 148));
    // Rows, in pages under each leaf; the one found is in the accent.
    [48, 120, 192].forEach((cx) => {
      for (let i = 0; i < 3; i++) {
        const found = cx === 120 && i === 1;
        s.push(
          t.rect(cx - 25 + i * 18, 184, 14, 12, {
            m: cx === 120,
            rx: 2,
            fill: found ? c.hot : c.soft,
            stroke: found ? c.hot : c.mid,
          }),
        );
      }
      for (let i = 0; i < 3; i++) s.push(t.rect(cx - 25 + i * 18, 200, 14, 12, { m: cx === 120, rx: 2, fill: c.soft, stroke: c.mid }));
    });
    return { shapes: s, mark: [90, 108, 60, 108] };
  },

  // One block applied again and again, the state refining on each pass.
  "new-architectures-test-time-reasoning": (c, t) => {
    const s = [];
    s.push(t.rect(92, 124, 56, 32, { m: true, rx: 5, fill: c.soft, stroke: c.hot }));
    s.push(t.line(102, 135, 138, 135, { m: true, stroke: c.mid }), t.line(102, 145, 126, 145, { m: true, stroke: c.mid }));
    // The loop out of the block's right side, round the top, and back in.
    s.push(t.path("M148 144H168Q178 144 178 132Q178 110 160 110H80Q62 110 62 132Q62 144 74 144H88", { m: true, stroke: c.hot }));
    s.push(t.head(90, 144, 1, 0, { m: true, stroke: c.hot }));
    // The state after each pass: scattered, then settling on the answer.
    const passes = [
      [10, 30, 6, 24],
      [18, 25, 18, 20],
      [24, 21, 27, 16],
      [26, 18, 30, 14],
    ];
    passes.forEach((heights, k) => {
      const x = 28 + k * 54;
      const last = k === passes.length - 1;
      heights.forEach((h, i) =>
        s.push(
          t.rect(x + i * 9, 216 - h, 5, h, {
            rx: 1.5,
            fill: last ? c.hot : c.soft,
            stroke: last ? c.hot : k === 0 ? c.mid : c.ink,
          }),
        ),
      );
      if (!last) s.push(t.head(x + 49, 202, 1, 0, { stroke: c.mid, size: 4 }));
    });
    return { shapes: s, mark: [56, 106, 128, 56] };
  },
};

/** The courses there is a drawing of. */
export const DRAWN = Object.keys(DRAWINGS);

/** The SVG text of one course's cover. */
export function coverSvg(slug, cover) {
  const draw = DRAWINGS[slug];
  if (!draw) return undefined;
  const c = palette(cover);
  const { shapes, mark } = draw(c, toolbox(c));
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice"` +
    ` data-mark="${[mark[0], mark[1] - RISE, mark[2], mark[3]].join(" ")}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${SW}">\n` +
    `  <g transform="translate(0 -${RISE})">\n` +
    shapes.map((shape) => `    ${shape}\n`).join("") +
    `  </g>\n</svg>\n`
  );
}

/** A course folder's front matter. */
function frontOf(dir) {
  const text = readFileSync(join(dir, "course.md"), "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  return match ? parse(match[1]) : undefined;
}

if (process.argv[1]?.endsWith("generate.mjs")) {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const root = args.find((a) => !a.startsWith("--"));
  if (!root) {
    console.error("usage: node tools/learn-covers/generate.mjs <content-dir> [--check]");
    process.exit(2);
  }
  let stale = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !existsSync(join(root, entry.name, "course.md"))) continue;
    const dir = join(root, entry.name);
    const front = frontOf(dir);
    const svg = front?.cover ? coverSvg(front.slug ?? entry.name, front.cover) : undefined;
    if (!svg) {
      console.log(`${entry.name}: no drawing`);
      continue;
    }
    const file = join(dir, "cover.svg");
    const same = existsSync(file) && readFileSync(file, "utf8") === svg;
    if (check) {
      if (!same) {
        stale += 1;
        console.log(`${entry.name}: cover.svg is ${existsSync(file) ? "out of date" : "missing"}`);
      }
    } else {
      if (!same) writeFileSync(file, svg);
      console.log(`${entry.name}: ${same ? "unchanged" : "written"}`);
    }
  }
  process.exit(stale > 0 ? 1 : 0);
}

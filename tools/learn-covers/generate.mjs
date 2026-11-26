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
// The series system. Every cover is the same grid on a 240 x 320 canvas: the
// series mark and the shelf's name in the top margin, the title from y 40, the
// ART FRAME (x 16 to 224, y 150 to 280: 208 x 130) and the lecture count in
// the foot. The page sets the text; this file draws what is in the frame.
//
// Each drawing is made at about its final size, in its own coordinates. The
// generator measures what it drew (every shape knows its bounding box), then
// scales it uniformly until it fills the frame (stroke included) and centres
// its bounding box in it, so every cover has even margins whatever its shape.
// One stroke weight (SW, in canvas units) is kept after the scaling: the
// drawing is made in design units, and `u` (design units per canvas unit)
// is how a helper sizes things that must not change with the scale, such as
// the heads of arrows.
//
// A drawing uses four colours from its course: the ink (soft white), a middle
// tone, a faint tint for fills, and the accent for the one thing to look at.
// No text, no ids, no references: the loader's checks pass and a cover may
// stand on a page several times.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { contrast, mix } from "../../src/lib/learn/cover.ts";

const PAPER = "#fbfaf7";
/** The stroke weight, in canvas units, on every cover. */
export const SW = 3.2;
/** The art frame on the 240 x 320 canvas. */
export const FRAME = { x: 16, y: 150, w: 208, h: 130 };

const n = (v) => String(Math.round(v * 100) / 100);

/** The colours of one cover. */
function palette(cover) {
  const bg = cover.color.toLowerCase();
  const accent = cover.accent.toLowerCase();
  const ink = mix(PAPER, bg, 0.94);
  return {
    bg,
    ink,
    mid: mix(PAPER, bg, 0.55),
    tint: mix(PAPER, bg, 0.2),
    // The accent, unless it cannot be seen on the cover colour.
    hot: contrast(accent, bg) >= 3 ? accent : ink,
  };
}

/** The extent of a path given as commands (absolute M L Q C), curves sampled. */
function pathBox(cmds) {
  const pts = [];
  let [cx, cy] = [0, 0];
  for (const [op, ...a] of cmds) {
    if (op === "M" || op === "L") {
      [cx, cy] = a;
      pts.push([cx, cy]);
    } else if (op === "Q") {
      for (let t = 0; t <= 1.001; t += 0.05) {
        const k = 1 - t;
        pts.push([k * k * cx + 2 * k * t * a[0] + t * t * a[2], k * k * cy + 2 * k * t * a[1] + t * t * a[3]]);
      }
      [cx, cy] = [a[2], a[3]];
    } else if (op === "C") {
      for (let t = 0; t <= 1.001; t += 0.04) {
        const k = 1 - t;
        pts.push([
          k ** 3 * cx + 3 * k * k * t * a[0] + 3 * k * t * t * a[2] + t ** 3 * a[4],
          k ** 3 * cy + 3 * k * k * t * a[1] + 3 * k * t * t * a[3] + t ** 3 * a[5],
        ]);
      }
      [cx, cy] = [a[4], a[5]];
    }
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** Helpers for one drawing at one scale; every shape is recorded with its box. */
function toolbox(c, u) {
  const shapes = [];
  const paint = (o) => {
    const fill = o.fill ?? "none";
    const stroke = o.w === 0 ? "none" : (o.stroke ?? c.ink);
    const dash = o.dash ? ` stroke-dasharray="${o.dash.map((d) => n(d * u)).join(" ")}"` : "";
    const width = o.thin ? ` stroke-width="${n(SW * 0.6 * u)}"` : "";
    return ` fill="${fill}" stroke="${stroke}"${dash}${width}`;
  };
  const add = (svg, box) => {
    shapes.push({ svg, box });
  };
  const t = {
    shapes,
    u,
    rect(x, y, w, h, o = {}) {
      add(`<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${o.rx ?? 3}"${paint(o)}/>`, [x, y, x + w, y + h]);
    },
    circle(x, y, r, o = {}) {
      add(`<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}"${paint(o)}/>`, [x - r, y - r, x + r, y + r]);
    },
    ellipse(x, y, rx, ry, o = {}) {
      add(`<ellipse cx="${n(x)}" cy="${n(y)}" rx="${n(rx)}" ry="${n(ry)}"${paint(o)}/>`, [x - rx, y - ry, x + rx, y + ry]);
    },
    line(x1, y1, x2, y2, o = {}) {
      add(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}"${paint(o)}/>`, [
        Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2),
      ]);
    },
    /** A path from commands: ["M", x, y], ["L", x, y], ["Q", cx, cy, x, y], ["C", ..., x, y], ["Z"]. */
    path(cmds, o = {}) {
      const d = cmds.map(([op, ...a]) => op + a.map(n).join(" ")).join("");
      add(`<path d="${d}"${paint(o)}/>`, pathBox(cmds.filter(([op]) => op !== "Z")));
    },
    /** An open arrowhead whose tip is (x, y), pointing along (dx, dy); its size is the same on every cover. */
    head(x, y, dx, dy, o = {}) {
      const len = Math.hypot(dx, dy);
      const [ux, uy] = [dx / len, dy / len];
      const s = (o.size ?? 7) * u;
      const wing = (a) => {
        const k = (a * Math.PI) / 180;
        const [cs, sn] = [Math.cos(k), Math.sin(k)];
        return [x - s * (ux * cs - uy * sn), y - s * (ux * sn + uy * cs)];
      };
      const [p, q] = [wing(34), wing(-34)];
      t.path([["M", ...p], ["L", x, y], ["L", ...q]], o);
    },
    /** A line with an arrowhead at its end. */
    arrow(x1, y1, x2, y2, o = {}) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const back = (o.size ?? 7) * u * 0.2;
      t.line(x1, y1, x2 - ((x2 - x1) / len) * back, y2 - ((y2 - y1) / len) * back, o);
      t.head(x2, y2, x2 - x1, y2 - y1, o);
    },
    /** A rounded rectangle outline with a gap in its left edge, centred on y = `gy`, `g` either side. */
    gapped(x0, y0, x1, y1, r, gy, g, o = {}) {
      t.path(
        [
          ["M", x0, gy - g], ["L", x0, y0 + r], ["Q", x0, y0, x0 + r, y0], ["L", x1 - r, y0],
          ["Q", x1, y0, x1, y0 + r], ["L", x1, y1 - r], ["Q", x1, y1, x1 - r, y1], ["L", x0 + r, y1],
          ["Q", x0, y1, x0, y1 - r], ["L", x0, gy + g],
        ],
        o,
      );
    },
  };
  return t;
}

// ---------------------------------------------------------------------------
// The nine drawings, each at about its final size (about 200 x 130 units).

const DRAWINGS = {
  // Tokens enter a stack of identical blocks, attention joins the positions,
  // a next-token distribution comes out.
  "how-language-models-work": (c, t) => {
    // Five tokens, the last the position being worked on.
    const cy = (i) => 14 + i * 28;
    for (let i = 0; i < 5; i++)
      t.rect(36, cy(i) - 9, 28, 18, { fill: i === 4 ? c.hot : c.tint, stroke: i === 4 ? c.hot : c.ink, rx: 4 });
    // Attention: arcs from the last token to earlier ones, the strongest in the accent.
    for (const [j, hot] of [[0, false], [1, false], [2, true], [3, true]]) {
      const reach = Math.min(30, (4 - j) * 28 * 0.3);
      t.path([["M", 36, cy(4)], ["Q", 36 - reach * 2, (cy(4) + cy(j)) / 2, 36, cy(j)]], { stroke: hot ? c.hot : c.mid });
    }
    // The stack: three identical blocks.
    for (let b = 0; b < 3; b++) t.rect(94, 6 + b * 40, 56, 32, { fill: c.tint, rx: 6 });
    t.arrow(68, 62, 90, 62, { stroke: c.mid });
    // The distribution over the next token; the likeliest in the accent.
    [14, 26, 12, 42].forEach((w, i) => t.rect(176, 16 + i * 30, w, 18, { fill: i === 3 ? c.hot : c.tint, stroke: i === 3 ? c.hot : c.ink, rx: 4 }));
    t.arrow(154, 62, 172, 62, { stroke: c.mid });
  },

  // Clients, a load balancer, replicated services, a data store.
  "system-design": (c, t) => {
    for (const y of [0, 52, 104]) {
      t.rect(0, y, 32, 32, { fill: c.tint, rx: 6 });
      t.circle(16, y + 16, 4, { fill: c.ink, w: 0 });
      t.line(32, y + 16, 54, 68, { stroke: c.mid });
      t.rect(116, y, 48, 32, { fill: c.tint, rx: 6 });
      t.circle(140, y + 16, 4, { fill: c.ink, w: 0 });
      t.arrow(84, 68 + (y + 16 - 68) * 0.35, 112, y + 16, { stroke: c.mid });
      t.line(164, y + 16, 184, 68 + (y + 16 - 68) * 0.45, { stroke: c.mid });
    }
    t.circle(68, 68, 20, { fill: c.hot, stroke: c.hot });
    t.line(58, 68, 78, 68, { stroke: c.bg });
    // The store.
    t.path([["M", 184, 46], ["L", 184, 92], ["Q", 184, 102, 208, 102], ["Q", 232, 102, 232, 92], ["L", 232, 46]], { fill: c.tint });
    t.path([["M", 184, 70], ["Q", 184, 80, 208, 80], ["Q", 232, 80, 232, 70]], { stroke: c.mid });
    t.ellipse(208, 46, 24, 9, { fill: c.tint });
  },

  // A descending loss curve of steps, and a low-rank adapter beside a frozen block.
  "training-and-fine-tuning": (c, t) => {
    t.path([["M", 0, 0], ["L", 0, 130], ["L", 120, 130]], { stroke: c.mid });
    const p = [14, 14, 30, 100, 56, 118, 112, 120];
    t.path([["M", p[0], p[1]], ["C", ...p.slice(2)]], { stroke: c.ink });
    const at = (k, a, b, d, e) => (1 - k) ** 3 * a + 3 * (1 - k) ** 2 * k * b + 3 * (1 - k) * k * k * d + k ** 3 * e;
    [0, 0.2, 0.42, 0.68, 1].forEach((k, i, all) => {
      const last = i === all.length - 1;
      t.circle(at(k, p[0], p[2], p[4], p[6]), at(k, p[1], p[3], p[5], p[7]), 6, { fill: last ? c.hot : c.tint, stroke: last ? c.hot : c.ink });
    });
    // The frozen block, and beside it the adapter: B (tall) times A (wide).
    t.rect(152, 0, 56, 56, { fill: c.tint, stroke: c.mid, dash: [6, 4], rx: 8 });
    t.line(180, 70, 180, 82, { stroke: c.hot });
    t.line(174, 76, 186, 76, { stroke: c.hot });
    t.rect(152, 96, 14, 34, { fill: c.hot, stroke: c.hot, rx: 4 });
    t.rect(174, 96, 34, 14, { fill: c.hot, stroke: c.hot, rx: 4 });
  },

  // A key-value cache that grows a token at a time; requests of different
  // lengths batched through one model.
  "inference-and-serving": (c, t) => {
    [5, 4, 3, 2, 1].forEach((len, r) => {
      const y = r * 28;
      for (let i = 0; i < len; i++) t.rect(i * 26, y, 22, 22, { fill: i === len - 1 ? c.hot : c.tint, stroke: i === len - 1 ? c.hot : c.ink, rx: 4 });
      t.arrow(len * 26 - 2, y + 11, 150, y + 11, { stroke: c.mid });
      t.rect(196, y + 1, 20, 20, { fill: c.tint, rx: 4 });
      t.line(174, y + 11, 192, y + 11, { stroke: c.mid });
    });
    t.rect(150, -4, 24, 136, { fill: c.tint, rx: 7 });
  },

  // The loop of an agent: model, tool call, result, context, back, inside the harness boundary.
  "agent-systems": (c, t) => {
    t.rect(0, 0, 200, 140, { stroke: c.mid, dash: [8, 6], rx: 18 });
    const node = (x, y, o = {}) => t.rect(x, y, 56, 36, { fill: c.tint, rx: 9, ...o });
    node(22, 22, { fill: c.hot, stroke: c.hot });
    node(122, 22);
    node(122, 82);
    node(22, 82);
    t.circle(50, 40, 8, { stroke: c.bg });
    t.line(134, 40, 166, 40, { stroke: c.mid });
    t.circle(138, 100, 3.6, { fill: c.ink, w: 0 });
    t.circle(150, 100, 3.6, { fill: c.ink, w: 0 });
    t.circle(162, 100, 3.6, { fill: c.ink, w: 0 });
    t.line(34, 94, 66, 94, { stroke: c.mid });
    t.line(34, 104, 54, 104, { stroke: c.mid });
    t.arrow(82, 40, 118, 40, { stroke: c.hot });
    t.arrow(150, 62, 150, 78, { stroke: c.ink });
    t.arrow(118, 100, 82, 100, { stroke: c.ink });
    t.arrow(50, 78, 50, 62, { stroke: c.ink });
  },

  // A leader and its followers keep a replicated log; one node is cut off.
  "distributed-systems": (c, t) => {
    const at = (deg) => [100 + 78 * Math.cos((deg * Math.PI) / 180), 70 + 52 * Math.sin((deg * Math.PI) / 180)];
    const [lead, ...rest] = [-90, -18, 54, 126, 198].map(at);
    const cut = 2; // the node at the lower left
    rest.forEach((p, i) => {
      const dx = p[0] - lead[0];
      const dy = p[1] - lead[1];
      const d = Math.hypot(dx, dy);
      const [sx, sy] = [lead[0] + (dx / d) * 26, lead[1] + (dy / d) * 17];
      const [ex, ey] = [p[0] - (dx / d) * 26, p[1] - (dy / d) * 17];
      if (i === cut) {
        t.line(sx, sy, sx + (ex - sx) * 0.4, sy + (ey - sy) * 0.4, { stroke: c.mid, dash: [5, 5] });
        const mx = sx + (ex - sx) * 0.6;
        const my = sy + (ey - sy) * 0.6;
        t.line(mx - 7, my - 7, mx + 7, my + 7, { stroke: c.hot });
        t.line(mx + 7, my - 7, mx - 7, my + 7, { stroke: c.hot });
      } else t.line(sx, sy, ex, ey, { stroke: c.mid });
    });
    const server = (p, o) => {
      t.rect(p[0] - 24, p[1] - 17, 48, 34, { fill: o.fill ?? c.tint, stroke: o.stroke ?? c.ink, dash: o.dash, rx: 7 });
      for (let i = 0; i < 3; i++) {
        const missing = o.missing && i === 2;
        t.rect(p[0] - 17 + i * 12, p[1] - 5, 10, 10, { fill: missing ? "none" : (o.cell ?? c.ink), stroke: missing ? c.mid : "none", dash: missing ? [3, 3] : undefined, w: missing ? undefined : 0, rx: 2 });
      }
    };
    server(lead, { fill: c.hot, stroke: c.hot, cell: c.bg });
    rest.forEach((p, i) => (i === cut ? server(p, { dash: [5, 4], stroke: c.mid, missing: true }) : server(p, {})));
  },

  // Nested trust boundaries around an asset, and one checked crossing.
  "security-foundations": (c, t) => {
    const ym = 70;
    t.gapped(0, 0, 200, 140, 18, ym, 8, { stroke: c.mid });
    t.gapped(32, 26, 168, 114, 14, ym, 8, { stroke: c.mid });
    t.gapped(62, 48, 138, 92, 10, ym, 8, { stroke: c.mid });
    // The asset.
    t.rect(88, 54, 24, 32, { fill: c.hot, stroke: c.hot, rx: 7 });
    // The one path in: through each boundary, checked at the outermost.
    t.arrow(-18, ym, 84, ym, { stroke: c.ink });
    t.circle(0, ym, 8, { fill: c.hot, stroke: c.bg });
    t.line(32, ym - 8, 32, ym + 8, { stroke: c.ink });
    t.line(62, ym - 8, 62, ym + 8, { stroke: c.ink });
    // Two attempts that stop at the boundary.
    for (const y of [32, 108]) {
      t.line(-18, y, -7, y, { stroke: c.mid, dash: [3, 4] });
      t.line(-7, y - 7, -7, y + 7, { stroke: c.mid });
    }
  },

  // A B-tree over pages, a search path in the accent, framed as a snapshot.
  "database-systems": (c, t) => {
    const cell = (x, y, w, h, cells) => {
      t.rect(x, y, w, h, { fill: c.tint, rx: 4 });
      for (let i = 1; i < cells; i++) t.line(x + (w * i) / cells, y + 4, x + (w * i) / cells, y + h - 4, { stroke: c.mid });
    };
    const mids = [30, 98, 166];
    mids.forEach((mx, i) => {
      t.line(98, 20, mx, 48, { stroke: i === 0 ? c.hot : c.mid });
      for (const dx of [-17, 17]) t.line(mx, 68, mx + dx, 102, { stroke: i === 0 && dx < 0 ? c.hot : c.mid });
    });
    cell(66, 0, 64, 20, 3);
    mids.forEach((mx) => cell(mx - 24, 48, 48, 20, 2));
    for (let j = 0; j < 6; j++) {
      const found = j === 0;
      t.rect(j * 34, 100, 28, 34, { fill: found ? c.hot : c.tint, stroke: found ? c.hot : c.ink, rx: 4 });
      t.line(j * 34 + 7, 114, j * 34 + 21, 114, { stroke: found ? c.bg : c.mid });
      t.line(j * 34 + 7, 124, j * 34 + 17, 124, { stroke: found ? c.bg : c.mid });
    }
    // The snapshot: the corners of a viewfinder around the tree.
    for (const [x, y, sx, sy] of [[-12, -12, 1, 1], [208, -12, -1, 1], [-12, 146, 1, -1], [208, 146, -1, -1]]) {
      t.path([["M", x, y + 16 * sy], ["L", x, y], ["L", x + 16 * sx, y]], { stroke: c.ink });
    }
  },

  // One block applied again and again, the state refining at each pass.
  "new-architectures-test-time-reasoning": (c, t) => {
    const target = [12, 26, 40, 26, 12];
    const noise = [36, 6, 32, 8, 34];
    [0, 1, 2].forEach((pass) => {
      const x = pass * 78;
      const share = [0, 0.55, 1][pass];
      target.forEach((h0, i) => {
        const h = noise[i] + (h0 - noise[i]) * share;
        const last = pass === 2;
        t.rect(x + 2 + i * 9, 50 - h, 6.5, h, { fill: last ? c.hot : c.ink, w: 0, rx: 2 });
      });
      t.line(x + 22, 56, x + 22, 66, { stroke: c.mid });
      t.rect(x, 66, 44, 54, { fill: c.tint, rx: 9 });
      t.circle(x + 22, 93, 8, { stroke: c.ink });
      if (pass < 2) t.arrow(x + 48, 93, x + 74, 93, { stroke: c.ink });
    });
    // The same block, again: the way back.
    t.path([["M", 178, 126], ["Q", 178, 142, 162, 142], ["L", 38, 142], ["Q", 22, 142, 22, 128]], { stroke: c.hot });
    t.head(22, 124, 0, -1, { stroke: c.hot });
  },
};

/** The courses there is a drawing of. */
export const DRAWN = Object.keys(DRAWINGS);

/** Draws one cover at the scale that makes it fit its frame: returns the shapes, the scale and the box it fills (canvas units, stroke included). */
function fit(slug, cover) {
  const draw = DRAWINGS[slug];
  if (!draw) return undefined;
  const c = palette(cover);
  let u = 1;
  let result;
  for (let pass = 0; pass < 3; pass++) {
    const t = toolbox(c, u);
    draw(c, t);
    const x0 = Math.min(...t.shapes.map((s) => s.box[0]));
    const y0 = Math.min(...t.shapes.map((s) => s.box[1]));
    const x1 = Math.max(...t.shapes.map((s) => s.box[2]));
    const y1 = Math.max(...t.shapes.map((s) => s.box[3]));
    const scale = Math.min((FRAME.w - SW) / (x1 - x0), (FRAME.h - SW) / (y1 - y0));
    // Placed so that the middle of the drawing is the middle of the frame.
    const tx = FRAME.x + FRAME.w / 2 - ((x0 + x1) / 2) * scale;
    const ty = FRAME.y + FRAME.h / 2 - ((y0 + y1) / 2) * scale;
    result = { shapes: t.shapes, scale, tx, ty, u };
    result.box = [x0 * scale + tx - SW / 2, y0 * scale + ty - SW / 2, x1 * scale + tx + SW / 2, y1 * scale + ty + SW / 2];
    u = 1 / scale;
  }
  return result;
}

/** Where a cover's drawing sits on the canvas: its box (stroke included) and the frame. */
export function coverBox(slug, cover) {
  const f = fit(slug, cover);
  return f && { box: f.box, frame: FRAME, scale: f.scale };
}

/** The SVG text of one course's cover. */
export function coverSvg(slug, cover) {
  const f = fit(slug, cover);
  if (!f) return undefined;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320" preserveAspectRatio="xMidYMid slice"` +
    ` fill="none" stroke-linecap="round" stroke-linejoin="round">\n` +
    `  <g transform="translate(${n(f.tx)} ${n(f.ty)}) scale(${n(f.scale * 1000) / 1000})" stroke-width="${n((SW / f.scale) * 1000) / 1000}">\n` +
    f.shapes.map((s) => `    ${s.svg}\n`).join("") +
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

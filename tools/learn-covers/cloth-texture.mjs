#!/usr/bin/env node
// The texture of book cloth on the bookshelf: a 64 x 64 grey-and-alpha PNG of
// fine specks, light and dark, mostly nearly clear. It is printed as a `data:`
// URL for `--tex-cloth` in src/styles/learn-bookshelf.css, so the page fetches
// nothing and the browser decodes a small bitmap once (a feTurbulence SVG used
// the same way costs a long frame whenever a book's layers are drawn again).
//
//   node tools/learn-covers/cloth-texture.mjs
import { crc32, deflateSync } from "node:zlib";

const SIZE = 64;
// A fixed generator, so the texture is the same every time it is made.
let seed = 0x9e3779b9;
const random = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const rows = [];
for (let y = 0; y < SIZE; y++) {
  const row = Buffer.alloc(1 + SIZE * 2);
  for (let x = 0; x < SIZE; x++) {
    row[1 + x * 2] = random() < 0.5 ? 255 : 0;
    row[2 + x * 2] = Math.round(random() ** 3 * 44);
  }
  rows.push(row);
}

const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};
const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 4; // grey with alpha
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
console.log(`url("data:image/png;base64,${png.toString("base64")}")`);

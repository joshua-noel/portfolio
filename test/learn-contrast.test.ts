import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The variables learn-content/CONTRACT.md promises to diagrams are --fg,
 * --muted, --border, --surface, --accent and --c1 to --c6. Both themes of src/styles/learn.css are held to WCAG AA. The tokens are
 * read from the stylesheet itself, so a palette edit that breaks contrast
 * fails here instead of in a reader's eyes.
 */
const css = readFileSync(
  fileURLToPath(new URL("../src/styles/learn.css", import.meta.url)),
  "utf8",
);

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `no ${selector} block`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const found: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    found[name!] = value!;
  }
  return found;
}

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => channel(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

test("both themes define every variable the contract names", () => {
  for (const [name, theme] of Object.entries(themes)) {
    for (const variable of [
      "fg",
      "muted",
      "surface",
      "accent",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]) {
      assert.ok(theme[variable], `${name} lacks --${variable}`);
    }
  }
  assert.match(css, /--border: rgba/);
  assert.match(css, /:root\[data-theme="light"\][^}]*--border: rgba/s);
});

const themes = {
  dark: { ...tokens(":root") },
  light: { ...tokens(":root"), ...tokens(':root[data-theme="light"]') },
};

const surfaces = ["bg", "surface", "bg-sunken"];
const textOnSurfaces = ["fg", "muted", "text-3", "accent"];
// Coloured text and strokes: the depth colours, the series colours --c1 to --c6
// that diagrams draw with, and the success tick.
const coloured = [
  "d-tip",
  "d-waterline",
  "d-deep",
  "d-abyss",
  "c1",
  "c2",
  "c3",
  "c4",
  "c5",
  "c6",
  "success",
];

for (const [name, theme] of Object.entries(themes)) {
  test(`${name}: text clears 4.5:1 on every surface`, () => {
    for (const surface of surfaces) {
      for (const text of [...textOnSurfaces, ...coloured]) {
        const value = ratio(theme[text]!, theme[surface]!);
        assert.ok(value >= 4.5, `${text} on ${surface}: ${value.toFixed(2)}`);
      }
    }
  });

  test(`${name}: button text and the focus ring`, () => {
    assert.ok(ratio(theme["on-accent"]!, theme.accent!) >= 4.5, "on-accent on accent");
    for (const surface of surfaces) {
      assert.ok(ratio(theme.focus!, theme[surface]!) >= 3, `focus on ${surface}`);
    }
  });

  test(`${name}: code blocks keep the contrast their themes were designed for`, () => {
    assert.ok(ratio(theme.fg!, theme["code-bg"]!) >= 7, "text on code");
    assert.ok(ratio(theme["text-3"]!, theme["code-bg"]!) >= 4.5, "muted on code");
  });
}

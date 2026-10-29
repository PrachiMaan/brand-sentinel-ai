/**
 * Builds the two Lumora decks used by the visual eval:
 *   demo-assets/decks/lumora-deck-clean.pdf      — no violations expected
 *   demo-assets/decks/lumora-deck-violations.pdf — known injected violations
 * plus one PNG per page (same geometry, drawn in-process) and the ground truth
 * in eval/visual-fixtures.json.
 *
 * Run: bun run scripts/make-visual-fixtures.mjs
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PAGE_H, PAGE_W, encodePng, hexToRgb, renderPage } from "./lib/raster.mjs";

const OUT = "demo-assets/decks";
const PNG_DIR = `${OUT}/png`;

const PALETTE = {
  bone: "#F4EFE6",
  ink: "#1F1D1A",
  clay: "#B4643C",
  sage: "#7C8B72",
  sand: "#D9C9AF",
};

const FONT_FAMILY = {
  Helvetica: "sans-serif",
  TimesRoman: "serif",
  Courier: "monospace",
};

const PDF_FONT = {
  Helvetica: StandardFonts.Helvetica,
  TimesRoman: StandardFonts.TimesRoman,
  Courier: StandardFonts.Courier,
};

const LOGO = { x: 0.06, y: 0.07, size: 0.055 };

function bodyLines(y0 = 0.42, font = "Helvetica", size = 14) {
  return [0, 1, 2].map((index) => ({
    x: 0.08,
    y: y0 + index * 0.07,
    w: 0.4 + index * 0.03,
    size,
    font,
    text:
      index === 0
        ? "Lumora Glow Serum is a fragrance-free daily serum."
        : index === 1
          ? "In a four-week study, hydration improved by 38%."
          : "Dermatologist tested and suitable for sensitive skin.",
  }));
}

function cleanPage(page) {
  return {
    page,
    background: PALETTE.bone,
    logo: { ...LOGO },
    blocks:
      page % 2 === 0
        ? [{ x: 0.62, y: 0.3, w: 0.28, h: 0.3, hex: PALETTE.sage }]
        : [{ x: 0.64, y: 0.34, w: 0.24, h: 0.26, hex: PALETTE.sand }],
    lines: [
      { x: 0.08, y: 0.28, w: 0.44, size: 28, font: "Helvetica", text: "Measured radiance" },
      ...bodyLines(),
    ],
  };
}

const CLEAN_PAGES = Array.from({ length: 10 }, (_, index) => cleanPage(index + 1));

const VIOLATION_PAGES = [
  cleanPage(1),
  // 2 — the mark sits on the trim edge.
  { ...cleanPage(2), logo: { x: 0.003, y: 0.07, size: 0.055 } },
  // 3 — a block intrudes into the mark's clear space.
  {
    ...cleanPage(3),
    blocks: [
      { x: 0.125, y: 0.075, w: 0.02, h: 0.02, hex: PALETTE.clay },
      { x: 0.62, y: 0.3, w: 0.28, h: 0.3, hex: PALETTE.sage },
    ],
  },
  // 4 — an off-palette block.
  {
    ...cleanPage(4),
    blocks: [{ x: 0.55, y: 0.45, w: 0.3, h: 0.22, hex: "#FF2E93" }],
  },
  // 5 — body copy set in a serif face.
  { ...cleanPage(5), lines: [cleanPage(5).lines[0], ...bodyLines(0.42, "TimesRoman", 14)] },
  // 6 — a page with no room to breathe.
  {
    page: 6,
    background: PALETTE.bone,
    logo: { ...LOGO },
    blocks: [
      { x: 0.015, y: 0.27, w: 0.47, h: 0.17, hex: PALETTE.sage },
      { x: 0.515, y: 0.27, w: 0.47, h: 0.17, hex: PALETTE.clay },
      { x: 0.015, y: 0.45, w: 0.47, h: 0.17, hex: PALETTE.sand },
      { x: 0.515, y: 0.45, w: 0.47, h: 0.17, hex: PALETTE.ink },
      { x: 0.015, y: 0.63, w: 0.47, h: 0.17, hex: PALETTE.clay },
      { x: 0.515, y: 0.63, w: 0.47, h: 0.17, hex: PALETTE.sage },
      { x: 0.015, y: 0.81, w: 0.47, h: 0.17, hex: PALETTE.sand },
      { x: 0.515, y: 0.81, w: 0.47, h: 0.17, hex: PALETTE.clay },
    ],
  },
  // 7 — body size deviates from the deck.
  { ...cleanPage(7), lines: [cleanPage(7).lines[0], ...bodyLines(0.42, "Helvetica", 24)] },
  cleanPage(8),
  cleanPage(9),
  // 10 — the last page carries no mark.
  { ...cleanPage(10), logo: undefined },
];

function toTextItems(page) {
  return (page.lines ?? []).map((line) => ({
    text: line.text,
    fontFamily: FONT_FAMILY[line.font] ?? "sans-serif",
    sizePt: line.size,
    x: line.x,
    y: line.y,
    w: line.w,
    h: (line.size / PAGE_H) * 0.62,
  }));
}

async function buildPdf(pages, path) {
  const doc = await PDFDocument.create();
  const fonts = {
    Helvetica: await doc.embedFont(PDF_FONT.Helvetica),
    TimesRoman: await doc.embedFont(PDF_FONT.TimesRoman),
    Courier: await doc.embedFont(PDF_FONT.Courier),
  };
  for (const page of pages) {
    const pdfPage = doc.addPage([PAGE_W, PAGE_H]);
    const bg = hexToRgb(page.background ?? PALETTE.bone);
    pdfPage.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_W,
      height: PAGE_H,
      color: rgb(bg.r / 255, bg.g / 255, bg.b / 255),
    });
    for (const block of page.blocks ?? []) {
      const colour = hexToRgb(block.hex);
      pdfPage.drawRectangle({
        x: block.x * PAGE_W,
        y: PAGE_H - (block.y + block.h) * PAGE_H,
        width: block.w * PAGE_W,
        height: block.h * PAGE_H,
        color: rgb(colour.r / 255, colour.g / 255, colour.b / 255),
      });
    }
    if (page.logo) {
      const size = page.logo.size * PAGE_W;
      const x = page.logo.x * PAGE_W;
      const y = PAGE_H - page.logo.y * PAGE_H - size;
      pdfPage.drawRectangle({ x, y, width: size, height: size, color: rgb(0.12, 0.11, 0.1) });
      const inset = size * (6 / 64);
      const notch = size * (22 / 64);
      pdfPage.drawRectangle({
        x: x + inset,
        y: y + inset,
        width: notch,
        height: notch,
        color: rgb(bg.r / 255, bg.g / 255, bg.b / 255),
      });
    }
    for (const line of page.lines ?? []) {
      const colour = hexToRgb(PALETTE.ink);
      pdfPage.drawText(line.text, {
        x: line.x * PAGE_W,
        y: PAGE_H - line.y * PAGE_H - line.size,
        size: line.size,
        font: fonts[line.font] ?? fonts.Helvetica,
        color: rgb(colour.r / 255, colour.g / 255, colour.b / 255),
      });
    }
  }
  writeFileSync(path, await doc.save());
}

/** Expected detection boxes, stated by the generator rather than by the engine. */
function groundTruth(deckId, pages) {
  const violations = [];
  const logoRect = (logo) => ({
    x: logo.x,
    y: logo.y,
    w: logo.size,
    h: (logo.size * PAGE_W) / PAGE_H,
  });

  for (const page of pages) {
    if (!page.logo && (page.page === 1 || page.page === pages.length)) {
      violations.push({
        ruleId: "VIS-LOGO-PRESENT",
        page: page.page,
        bbox: { x: 0.02, y: 0.02, w: 0.06, h: 0.06 },
        note: "no mark on this page",
      });
      continue;
    }
    if (page.logo) {
      const rect = logoRect(page.logo);
      const minMargin = Math.min(rect.x, 1 - (rect.x + rect.w), rect.y, 1 - (rect.y + rect.h));
      if (minMargin < 0.04) {
        violations.push({
          ruleId: "VIS-LOGO-MARGIN",
          page: page.page,
          bbox: rect,
          note: `${(minMargin * 100).toFixed(1)}% from the nearest edge`,
        });
      }
      const intrusion = (page.blocks ?? []).find((block) => {
        const gapX = Math.max(block.x - (rect.x + rect.w), rect.x - (block.x + block.w));
        const gapY = Math.max(block.y - (rect.y + rect.h), rect.y - (block.y + block.h));
        return gapX < rect.h * 0.5 && gapY < rect.h * 0.5;
      });
      if (intrusion) {
        const x0 = Math.min(rect.x, intrusion.x);
        const y0 = Math.min(rect.y, intrusion.y);
        violations.push({
          ruleId: "VIS-LOGO-CLEARSPACE",
          page: page.page,
          bbox: {
            x: x0,
            y: y0,
            w: Math.max(rect.x + rect.w, intrusion.x + intrusion.w) - x0,
            h: Math.max(rect.y + rect.h, intrusion.y + intrusion.h) - y0,
          },
          note: "a block enters the clear space",
        });
      }
    }
    for (const block of page.blocks ?? []) {
      const offPalette = isOffPalette(block.hex);
      if (offPalette) {
        violations.push({
          ruleId: "VIS-PALETTE",
          page: page.page,
          bbox: { x: block.x, y: block.y, w: block.w, h: block.h },
          note: `${block.hex} is not a palette colour`,
        });
      }
    }
    if ((page.lines ?? []).some((line) => line.font !== "Helvetica")) {
      violations.push({
        ruleId: "VIS-TYPE-FAMILY",
        page: page.page,
        bbox: { x: 0.08, y: 0.42, w: 0.46, h: 0.22 },
        note: "body copy set outside the brand sans",
      });
    }
    const sizes = (page.lines ?? []).map((line) => line.size);
    if (sizes.length && Math.min(...sizes) > 18) {
      violations.push({
        ruleId: "VIS-TYPE-SIZE",
        page: page.page,
        bbox: { x: 0.06, y: 0.08, w: 0.88, h: 0.8 },
        note: "body size deviates from the deck",
      });
    }
    if (page.blocks && page.blocks.length >= 5) {
      // The dense region is the area the page's own content occupies. Ground
      // truth comes from the declared block geometry, not from a hard-coded
      // corner and not from the engine's pixel scan.
      const xs = page.blocks.map((block) => block.x);
      const ys = page.blocks.map((block) => block.y);
      const x1 = Math.max(...page.blocks.map((block) => block.x + block.w));
      const y1 = Math.max(...page.blocks.map((block) => block.y + block.h));
      const x0 = Math.min(...xs);
      const y0 = Math.min(...ys);
      violations.push({
        ruleId: "VIS-DENSITY",
        page: page.page,
        bbox: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
        note: "dense region declared by the fixture geometry",
      });
    }
  }
  return { deckId, violations };
}

function isOffPalette(hex) {
  const clean = hex.replace("#", "").toUpperCase();
  return !Object.values(PALETTE).some((value) => value.replace("#", "") === clean);
}

async function main() {
  mkdirSync(PNG_DIR, { recursive: true });
  const decks = [
    { id: "clean", pages: CLEAN_PAGES, path: `${OUT}/lumora-deck-clean.pdf` },
    { id: "violations", pages: VIOLATION_PAGES, path: `${OUT}/lumora-deck-violations.pdf` },
  ];

  const fixtures = [];
  for (const deck of decks) {
    await buildPdf(deck.pages, deck.path);
    for (const page of deck.pages) {
      const png = encodePng(renderPage(page));
      writeFileSync(`${PNG_DIR}/${deck.id}-p${page.page}.png`, png);
    }
    fixtures.push({
      deckId: deck.id,
      pdf: deck.path,
      pages: deck.pages.map((page) => ({
        page: page.page,
        png: `${PNG_DIR}/${deck.id}-p${page.page}.png`,
        textItems: toTextItems(page),
      })),
      groundTruth: groundTruth(deck.id, deck.pages),
    });
  }

  writeFileSync(
    "eval/visual-fixtures.json",
    `${JSON.stringify(
      {
        generatedBy: "scripts/make-visual-fixtures.mjs",
        page: { width: PAGE_W, height: PAGE_H },
        palette: PALETTE,
        decks: fixtures,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`wrote ${decks.length} decks and ${fixtures.reduce((n, d) => n + d.pages.length, 0)} page PNGs`);
}

await main();

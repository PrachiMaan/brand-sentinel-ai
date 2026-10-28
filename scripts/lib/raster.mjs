/**
 * Tiny software rasteriser + PNG codec used to build the visual fixtures.
 *
 * The app rasterises PDFs in the browser with pdf.js. This module exists so the
 * fixture generator and the visual eval can run without a canvas backend: both
 * the PDF and the PNG are drawn from the same geometry spec.
 */

import { deflateSync, inflateSync } from "node:zlib";

export const PAGE_W = 960;
export const PAGE_H = 540;

/** The Lumora mark, identical geometry to LOGO_GEOMETRY in lib/visual.ts. */
export function logoRect(logo) {
  const size = Math.round(logo.size * PAGE_W);
  return {
    x: Math.round(logo.x * PAGE_W),
    y: Math.round(logo.y * PAGE_H),
    w: size,
    h: size,
  };
}

export function drawRect(img, rect, hex) {
  const { r, g, b } = hexToRgb(hex);
  for (let y = Math.max(0, rect.y); y < Math.min(img.height, rect.y + rect.h); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(img.width, rect.x + rect.w); x++) {
      const p = (y * img.width + x) * 4;
      img.data[p] = r;
      img.data[p + 1] = g;
      img.data[p + 2] = b;
      img.data[p + 3] = 255;
    }
  }
}

export function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function pageImage(background = "#F4EFE6") {
  const data = new Uint8ClampedArray(PAGE_W * PAGE_H * 4);
  const img = { width: PAGE_W, height: PAGE_H, data };
  const { r, g, b } = hexToRgb(background);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return img;
}

export function drawLogo(img, logo, background = "#F4EFE6") {
  const rect = logoRect(logo);
  drawRect(img, rect, "#1F1D1A");
  const notch = Math.round(rect.w * (22 / 64));
  const inset = Math.round(rect.w * (6 / 64));
  drawRect(
    img,
    {
      x: rect.x + inset,
      y: rect.y + rect.h - inset - notch,
      w: notch,
      h: notch,
    },
    background,
  );
}

export function drawTextLine(img, line, color = "#1F1D1A") {
  const rect = {
    x: Math.round(line.x * PAGE_W),
    y: Math.round(line.y * PAGE_H),
    w: Math.round(line.w * PAGE_W),
    h: Math.max(2, Math.round((line.size / 540) * PAGE_H * 0.62)),
  };
  drawRect(img, rect, color);
}

export function renderPage(page) {
  const img = pageImage(page.background ?? "#F4EFE6");
  for (const block of page.blocks ?? []) {
    drawRect(
      img,
      {
        x: Math.round(block.x * PAGE_W),
        y: Math.round(block.y * PAGE_H),
        w: Math.round(block.w * PAGE_W),
        h: Math.round(block.h * PAGE_H),
      },
      block.hex,
    );
  }
  if (page.logo) drawLogo(img, page.logo, page.background ?? "#F4EFE6");
  for (const line of page.lines ?? []) drawTextLine(img, line);
  return img;
}

/* ---------------------------------------------------------------- PNG ---- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function encodePng(img) {
  const raw = Buffer.alloc((img.width * 4 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 4 + 1)] = 0;
    Buffer.from(img.data.buffer, y * img.width * 4, img.width * 4).copy(
      raw,
      y * (img.width * 4 + 1) + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function decodePng(buffer) {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    } else if (type === "IDAT") {
      idat.push(data);
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? current[x - 4] : 0;
      const b = prev[x];
      const c = x >= 4 ? prev[x - 4] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      current[x] = value & 0xff;
    }
    out.set(current, y * stride);
    prev = current;
  }
  return { width, height, data: out };
}

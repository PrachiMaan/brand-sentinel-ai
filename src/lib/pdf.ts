/**
 * Browser-side PDF intake: rasterise each page with pdf.js and read the text
 * layer with font family, size and position. Nothing is invented here; if a
 * page cannot be rendered the caller is told which one and why.
 */

import * as pdfjs from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PageInput, TextItem } from "@/convex/lib/visual";

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export const MAX_DECK_BYTES = 20 * 1024 * 1024;
export const MAX_PAGES = 30;
export const TARGET_PAGE_WIDTH = 1200;

export type RenderedPage = {
  page: number;
  canvas: HTMLCanvasElement;
  blob: Blob;
  width: number;
  height: number;
  text: string;
  textItems: TextItem[];
};

export type RenderProgress = {
  page: number;
  total: number;
  phase: "reading" | "rendering" | "done";
};

export class PdfError extends Error {
  code: "too_large" | "too_many_pages" | "password" | "corrupt" | "empty" | "cancelled";
  constructor(code: PdfError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const FAMILY_MAP: Record<string, string> = {
  serif: "serif",
  "times-roman": "serif",
  timesroman: "serif",
  times: "serif",
  "sans-serif": "sans-serif",
  helvetica: "sans-serif",
  arial: "sans-serif",
  courier: "monospace",
  monospace: "monospace",
};

export function familyOf(fontFamily: string | undefined, fontName: string | undefined): string {
  const raw = `${fontFamily ?? ""} ${fontName ?? ""}`.toLowerCase();
  for (const [key, value] of Object.entries(FAMILY_MAP)) {
    if (raw.includes(key)) return value;
  }
  if (raw.includes("mono")) return "monospace";
  if (raw.includes("serif") && !raw.includes("sans")) return "serif";
  return "sans-serif";
}

export async function renderPdf(
  file: File,
  options: {
    onProgress?: (progress: RenderProgress) => void;
    isCancelled?: () => boolean;
  } = {},
): Promise<RenderedPage[]> {
  if (file.size > MAX_DECK_BYTES) {
    throw new PdfError("too_large", "That PDF is larger than 20 MB.");
  }
  const buffer = await file.arrayBuffer();
  let doc: pdfjs.PDFDocumentProxy;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      throw new PdfError("password", "That PDF is password protected, so its pages cannot be read.");
    }
    throw new PdfError("corrupt", "That file is not a readable PDF.");
  }

  if (doc.numPages > MAX_PAGES) {
    throw new PdfError("too_many_pages", `That PDF has ${doc.numPages} pages; the limit is ${MAX_PAGES}.`);
  }

  const pages: RenderedPage[] = [];
  for (let index = 1; index <= doc.numPages; index++) {
    if (options.isCancelled?.()) throw new PdfError("cancelled", "Stopped by the user.");
    options.onProgress?.({ page: index, total: doc.numPages, phase: "rendering" });
    const page = await doc.getPage(index);
    const base = page.getViewport({ scale: 1 });
    const scale = TARGET_PAGE_WIDTH / base.width;
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new PdfError("corrupt", "This browser cannot rasterise the PDF.");
    await page.render({ canvas, canvasContext: context, viewport }).promise;

    const textContent = await page.getTextContent();
    const items: TextItem[] = [];
    for (const item of textContent.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      const transform = item.transform as number[];
      const sizePt = Math.hypot(transform[0], transform[1]);
      const style = textContent.styles?.[item.fontName as unknown as string];
      const x = transform[4] / base.width;
      const y = 1 - transform[5] / base.height;
      items.push({
        text: item.str,
        fontFamily: familyOf(style?.fontFamily, item.fontName as unknown as string),
        sizePt: Math.round(sizePt * 10) / 10,
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        w: Math.max(0.01, Math.min(1, item.width / base.width)),
        h: Math.max(0.005, Math.min(0.2, item.height / base.height)),
      });
    }

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((result) => resolve(result), "image/png"),
    );
    if (!blob) throw new PdfError("corrupt", `Page ${index} could not be rasterised.`);

    pages.push({
      page: index,
      canvas,
      blob,
      width: canvas.width,
      height: canvas.height,
      text: items.map((i) => i.text).join(" "),
      textItems: items,
    });
  }

  if (!pages.length) throw new PdfError("empty", "That PDF has no pages.");
  options.onProgress?.({ page: pages.length, total: pages.length, phase: "done" });
  return pages;
}

export function pageInputOf(page: RenderedPage): PageInput | null {
  const context = page.canvas.getContext("2d");
  if (!context) return null;
  const image = context.getImageData(0, 0, page.width, page.height);
  return {
    page: page.page,
    image: { width: page.width, height: page.height, data: image.data },
    text: page.textItems,
  };
}

type MammothBrowser = {
  extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>;
};

/** DOCX is text-only: mammoth extracts the copy and no visual review is claimed. */
export async function extractDocx(file: File): Promise<string> {
  // The browser build of mammoth ships without type declarations. Only this one
  // function is used, and its shape is pinned by MammothBrowser above.
  // @ts-expect-error - untyped browser bundle
  const mammoth = (await import("mammoth/mammoth.browser")) as MammothBrowser;
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return result.value.trim();
}

'use client';

/**
 * Getting readable text out of whatever the user drops on us.
 *
 * Order of preference:
 *   1. Real text layer (PDF, DOCX, TXT) - free, exact, instant.
 *   2. Vision model - for scans and phone photos, which is what most people
 *      actually have when the document came from a landlord or an employer.
 *
 * Everything here runs in the browser. For a scanned PDF we rasterise each page
 * locally and send only that page image to the vision endpoint, so a 40-page
 * scan is 40 small requests instead of one that would exceed the body limit.
 */

import { authHeaders } from './device.ts';

export interface ExtractedPage {
  page: number;
  text: string;
  via: 'text' | 'vision';
}

export interface ExtractResult {
  pages: ExtractedPage[];
  text: string;
  extraction: 'text' | 'vision' | 'mixed';
  warnings: string[];
}

export interface ExtractOptions {
  user: string;
  onProgress?: (pct: number, label: string) => void;
  signal?: AbortSignal;
  /** Cap on pages sent to the vision model - protects the user's rate limit. */
  maxVisionPages?: number;
}

export const SUPPORTED = '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp';
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** A page with almost no text layer is a scan, whatever its extension says. */
const TEXT_DENSITY_FLOOR = 90;

export async function extractFile(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(
      `"${file.name}" is ${(file.size / 1e6).toFixed(1)} MB. Please upload something under 25 MB.`,
    );
  }
  if (file.size === 0) throw new Error(`"${file.name}" is empty.`);

  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return extractPdf(file, opts);
  if (name.endsWith('.docx')) return extractDocx(file, opts);
  if (/\.(png|jpe?g|webp)$/.test(name)) return extractImage(file, opts);
  if (/\.(txt|md|csv)$/.test(name) || file.type.startsWith('text/')) return extractText(file, opts);

  throw new Error(
    `I cannot read "${file.name}". Please upload a PDF, Word file, photo or text file.`,
  );
}

/* -------------------------------------------------------------- plain text */

async function extractText(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  opts.onProgress?.(50, 'reading file...');
  const text = (await file.text()).trim();
  if (!text) throw new Error(`"${file.name}" has no readable text in it.`);
  return { pages: [{ page: 1, text, via: 'text' }], text, extraction: 'text', warnings: [] };
}

/* -------------------------------------------------------------------- docx */

async function extractDocx(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  opts.onProgress?.(30, 'opening Word document...');
  const mammoth = await import('mammoth');
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  const text = (value ?? '').trim();
  if (!text) {
    throw new Error(
      `"${file.name}" has no text I can read. If it is a scan inside a Word file, export it as a PDF or upload the image.`,
    );
  }
  opts.onProgress?.(90, 'done');
  return { pages: [{ page: 1, text, via: 'text' }], text, extraction: 'text', warnings: [] };
}

/* ------------------------------------------------------------------- image */

async function extractImage(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  opts.onProgress?.(20, 'looking at the photo...');
  const dataUrl = await downscaleImage(file, 1600);
  const text = await visionRead(dataUrl, 1, opts);
  if (!text) {
    throw new Error(
      'I could not read any text in that image. Try a sharper, well-lit photo of the page.',
    );
  }
  opts.onProgress?.(100, 'done');
  return { pages: [{ page: 1, text, via: 'vision' }], text, extraction: 'vision', warnings: [] };
}

/* --------------------------------------------------------------------- pdf */

async function extractPdf(file: File, opts: ExtractOptions): Promise<ExtractResult> {
  opts.onProgress?.(5, 'opening PDF...');

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

  // Keep the loading task around: in pdf.js v6 it owns the worker, and that is
  // what has to be destroyed to release memory when we are done.
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    // Some Indian government PDFs ship broken embedded fonts; falling back to
    // system fonts stops pdf.js bailing out on them entirely.
    useSystemFonts: true,
  });

  let doc: import('pdfjs-dist').PDFDocumentProxy;
  try {
    doc = await loadingTask.promise;
  } catch (err) {
    const msg = (err as Error)?.message ?? '';
    if (/password/i.test(msg)) {
      throw new Error(
        `"${file.name}" is password protected. Please remove the password and upload it again.`,
      );
    }
    throw new Error(`I could not open "${file.name}". It may be damaged. Try re-downloading it.`);
  }

  const warnings: string[] = [];
  const pages: ExtractedPage[] = [];
  const total = doc.numPages;
  const maxVision = opts.maxVisionPages ?? 20;
  let visionUsed = 0;

  for (let n = 1; n <= total; n++) {
    if (opts.signal?.aborted) throw new Error('Upload cancelled.');
    opts.onProgress?.(5 + Math.round((n / total) * 85), `reading page ${n} of ${total}...`);

    const page = await doc.getPage(n);
    let text = '';
    try {
      const content = await page.getTextContent();
      text = joinTextItems(content.items as Array<{ str?: string; hasEOL?: boolean }>);
    } catch {
      text = '';
    }

    if (text.trim().length >= TEXT_DENSITY_FLOOR) {
      pages.push({ page: n, text: text.trim(), via: 'text' });
      page.cleanup();
      continue;
    }

    // Sparse text layer => treat as a scan and hand the page to the vision model.
    if (visionUsed >= maxVision) {
      warnings.push(`Pages after ${n - 1} were skipped - this scan is longer than I can read in one go.`);
      page.cleanup();
      break;
    }
    try {
      const image = await renderPageToImage(page, 1.7);
      const read = await visionRead(image, n, opts);
      visionUsed++;
      if (read) pages.push({ page: n, text: read, via: 'vision' });
    } catch (err) {
      warnings.push(`Page ${n} could not be read (${(err as Error).message}).`);
    }
    page.cleanup();
  }

  await loadingTask.destroy();

  const text = pages.map((p) => p.text).join('\n\n');
  if (!text.trim()) {
    throw new Error(
      `I could not find any readable text in "${file.name}". If it is a scan, try a clearer copy or upload a photo of the page.`,
    );
  }

  const kinds = new Set(pages.map((p) => p.via));
  if (visionUsed > 0) {
    warnings.push(`${visionUsed} page(s) were scanned images, so I read them with the vision model. Check anything that looks odd.`);
  }

  opts.onProgress?.(95, 'done');
  return {
    pages,
    text,
    extraction: kinds.size > 1 ? 'mixed' : kinds.has('vision') ? 'vision' : 'text',
    warnings,
  };
}

/** pdf.js gives us positioned fragments; stitch them back into readable lines. */
function joinTextItems(items: Array<{ str?: string; hasEOL?: boolean }>): string {
  let out = '';
  for (const item of items) {
    out += item.str ?? '';
    if (item.hasEOL) out += '\n';
    else if (item.str && !item.str.endsWith(' ')) out += ' ';
  }
  return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

async function renderPageToImage(
  page: import('pdfjs-dist').PDFPageProxy,
  scale: number,
): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  // Keep the longest edge near 2000px: enough for the model to read 8pt legal
  // print, small enough to stay well inside the request size limit.
  const cap = 2000 / Math.max(viewport.width, viewport.height);
  const s = cap < 1 ? scale * cap : scale;
  const vp = page.getViewport({ scale: s });
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
  return canvas.toDataURL('image/jpeg', 0.82);
}

async function downscaleImage(file: File, maxEdge: number): Promise<string> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) {
    // Older browsers without createImageBitmap: send the original bytes.
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(new Error('could not read image'));
      fr.readAsDataURL(file);
    });
  }
  const ratio = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * ratio);
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

async function visionRead(dataUrl: string, page: number, opts: ExtractOptions): Promise<string> {
  const res = await fetch('/api/vision', {
    method: 'POST',
    headers: authHeaders(opts.user),
    body: JSON.stringify({ image: dataUrl, page }),
    signal: opts.signal,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `vision failed (${res.status})`);
  }
  const { text } = (await res.json()) as { text: string };
  return (text ?? '').trim();
}

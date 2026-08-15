import * as mupdf from 'mupdf';

const RENDER_SCALE = 1.5; // ~150dpi equivalent for a slide-sized page, good balance of legibility vs file size

export function openPdf(buffer) {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  return { doc, pageCount: doc.countPages() };
}

export function extractPage(doc, pageIndex) {
  const page = doc.loadPage(pageIndex);
  const text = page.toStructuredText('preserve-whitespace').asText().trim();

  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);
  const png = pixmap.asPNG();
  const imageDataUrl = `data:image/png;base64,${Buffer.from(png).toString('base64')}`;

  return { text, imageDataUrl };
}

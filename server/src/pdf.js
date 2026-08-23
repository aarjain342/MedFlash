import * as mupdf from 'mupdf';

const RENDER_SCALE = 1.5; // ~150dpi equivalent for a slide-sized page, good balance of legibility vs file size
const JPEG_QUALITY = 78;

export function openPdf(buffer) {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  return { doc, pageCount: doc.countPages() };
}

export function extractPage(doc, pageIndex) {
  const page = doc.loadPage(pageIndex);
  const text = page.toStructuredText('preserve-whitespace').asText().trim();

  const matrix = mupdf.Matrix.scale(RENDER_SCALE, RENDER_SCALE);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);

  // Text-heavy/flat-color slides compress much better as PNG; photo-like slides (scans,
  // anatomy photos, diagrams with gradients) compress far better as JPEG. Rather than
  // guess, encode both and keep whichever is smaller — a deck with many image-heavy
  // slides was ballooning the total upsert payload past Supabase's statement timeout.
  const png = pixmap.asPNG();
  const jpeg = pixmap.asJPEG(JPEG_QUALITY, false);
  const useJpeg = jpeg.length < png.length;
  const bytes = useJpeg ? jpeg : png;
  const mime = useJpeg ? 'image/jpeg' : 'image/png';
  const imageDataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

  return { text, imageDataUrl };
}

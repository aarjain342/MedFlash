import * as mupdf from 'mupdf';

const RENDER_SCALE = 1.5; // ~150dpi equivalent for a slide-sized page, good balance of legibility vs file size
const JPEG_QUALITY = 78;

export function openPdf(buffer) {
  const doc = mupdf.Document.openDocument(buffer, 'application/pdf');
  return { doc, pageCount: doc.countPages() };
}

// `scale`/`jpegQuality` default to the slide-sized settings above. Callers that zoom into
// part of the page (Anatomy Quiz crops down to one figure) can ask for more pixels: a
// page's embedded photo is often well above 1.5x resolution, so rendering at the default
// throws that detail away and a zoomed-in crop looks soft. `jpegOnly` skips the PNG
// attempt for photo-heavy pages, where JPEG always wins and encoding a large PNG is wasted work.
export function extractPage(doc, pageIndex, { scale = RENDER_SCALE, jpegQuality = JPEG_QUALITY, jpegOnly = false } = {}) {
  const page = doc.loadPage(pageIndex);
  const text = page.toStructuredText('preserve-whitespace').asText().trim();

  const matrix = mupdf.Matrix.scale(scale, scale);
  const pixmap = page.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);

  // Text-heavy/flat-color slides compress much better as PNG; photo-like slides (scans,
  // anatomy photos, diagrams with gradients) compress far better as JPEG. Rather than
  // guess, encode both and keep whichever is smaller — a deck with many image-heavy
  // slides was ballooning the total upsert payload past Supabase's statement timeout.
  const jpeg = pixmap.asJPEG(jpegQuality, false);
  const png = jpegOnly ? null : pixmap.asPNG();
  const useJpeg = !png || jpeg.length < png.length;
  const bytes = useJpeg ? jpeg : png;
  const mime = useJpeg ? 'image/jpeg' : 'image/png';
  const imageDataUrl = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;

  return { text, imageDataUrl };
}

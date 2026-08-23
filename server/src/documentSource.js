import { openPdf, extractPage } from './pdf.js';
import { extractPptxSlides, extractDocxChunks } from './officeDocs.js';

// Unifies PDF/PPTX/DOCX behind one interface so the generation route doesn't need to know
// which format it's dealing with — just pageCount and a way to fetch each "slide"'s
// text/image. Only PDF has real slide images (via mupdf rendering); PPTX and DOCX are
// text-only, which the pipeline already handles fine as slides with no image attached.
export async function openSource(file) {
  const name = (file.originalname || '').toLowerCase();

  if (name.endsWith('.pptx')) {
    const slides = extractPptxSlides(file.buffer);
    if (slides.length === 0) throw new Error('No slides found in this PowerPoint file');
    return { pageCount: slides.length, getPage: (i) => ({ text: slides[i] || '', imageDataUrl: null }) };
  }

  if (name.endsWith('.docx')) {
    const chunks = await extractDocxChunks(file.buffer);
    if (chunks.length === 0) throw new Error('No text found in this Word document');
    return { pageCount: chunks.length, getPage: (i) => ({ text: chunks[i] || '', imageDataUrl: null }) };
  }

  // Default: PDF. Older uploads/clients don't send a distinguishing extension, so this
  // stays the fallback rather than requiring an exact ".pdf" match.
  const { doc, pageCount } = openPdf(file.buffer);
  return { pageCount, getPage: (i) => extractPage(doc, i) };
}

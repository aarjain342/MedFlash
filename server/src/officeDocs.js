import { unzipSync, strFromU8 } from 'fflate';
import mammoth from 'mammoth';

// Splits a long block of extracted text (from a Word doc, which has no inherent "slide"
// concept) into slide-sized chunks, so the rest of the pipeline — built around one prompt
// per slide — can treat it the same way as a PPTX or PDF. Breaks on blank lines where
// possible so a chunk doesn't split mid-paragraph.
const CHUNK_TARGET_CHARS = 1800;

export function chunkText(text, targetChars = CHUNK_TARGET_CHARS) {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && current.length + para.length + 2 > targetChars) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? `${current}\n\n${para}` : para;
    }
  }
  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.trim()].filter(Boolean);
}

export async function extractDocxChunks(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return chunkText(result.value);
}

function xmlToPlainText(xml) {
  // Pull every run of text inside <a:t>...</a:t> tags (DrawingML text runs) — the only
  // part of a slide's XML we actually need. <a:p> (paragraph) boundaries become newlines
  // so bullet points don't run together.
  const paragraphs = [];
  const paraRe = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g;
  let m;
  while ((m = paraRe.exec(xml))) {
    const runs = [...m[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map((r) => decodeXmlEntities(r[1]));
    const line = runs.join('').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join('\n');
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// PPTX slide order isn't guaranteed to match slideN.xml numbering — the real order comes
// from presentation.xml's <p:sldId> list, resolved through presentation.xml.rels. Falls
// back to numeric filename order if that structure is missing/malformed.
export function extractPptxSlides(buffer) {
  const files = unzipSync(new Uint8Array(buffer));
  const readXml = (path) => (files[path] ? strFromU8(files[path]) : null);

  const presentationXml = readXml('ppt/presentation.xml');
  const relsXml = readXml('ppt/_rels/presentation.xml.rels');

  let orderedPaths = null;
  if (presentationXml && relsXml) {
    const rIds = [...presentationXml.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]);
    const relMap = new Map(
      [...relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]])
    );
    const resolved = rIds
      .map((id) => relMap.get(id))
      .filter(Boolean)
      .map((target) => `ppt/${target.replace(/^\.?\//, '')}`);
    if (resolved.length > 0) orderedPaths = resolved;
  }

  if (!orderedPaths) {
    orderedPaths = Object.keys(files)
      .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .sort((a, b) => {
        const na = Number(a.match(/slide(\d+)\.xml$/)[1]);
        const nb = Number(b.match(/slide(\d+)\.xml$/)[1]);
        return na - nb;
      });
  }

  return orderedPaths
    .map((path) => readXml(path))
    .filter(Boolean)
    .map((xml) => xmlToPlainText(xml));
}

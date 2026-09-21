// Labels on an anatomy diagram are baked into the page's raster image (leader lines +
// printed text drawn as pixels, not separate PDF text objects), so there's no text layer
// to read them from — this asks Gemini's vision input to both find and locate them in one
// call, using the 0-1000 normalized box convention Gemini is actually trained to produce
// for spatial/grounding tasks when asked in plain text.
//
// The reply format is one item per line rather than JSON. A dense page has 30-40+ labels,
// and asking a fast/lite model for that much JSON failed about half the time in practice
// (dropped opening braces, mismatched brackets, stray duplicated keys) — and one malformed
// character loses the whole page. Independent lines degrade gracefully: a bad line costs one
// label, not the page. parseAnatomyResponse still accepts JSON too, since a fallback model
// deeper in the provider chain may not follow the format.
const MAX_LABELS_PER_PAGE = 60; // a real 36-page sample topped out at 43 on one dense page; headroom above that
const MAX_DIAGRAMS_PER_PAGE = 10;
// A lite model sometimes falls into a repetition loop — one line (e.g. "LABEL 740 338 757 353 | T7")
// repeated until the token limit, 170+ entries for a page that has ~45. Such a reply is
// flagged `looped`: its leading labels are real, but the tail was never written, so the page
// is worth sampling again. More entries than any real page holds is the same failure.
const RUNAWAY_LABEL_COUNT = MAX_LABELS_PER_PAGE * 2;
const LOOP_REDUNDANT_ENTRIES = 15;
const MAX_EXTRACT_ATTEMPTS = 3;

export function buildAnatomyLabelPrompt(pageIndex, totalPages) {
  return `You are looking at page ${pageIndex + 1} of ${totalPages} from a medical student's anatomy lecture slides.

Some pages are plain bullet-point text with no diagram — for those, reply with exactly: NONE

Other pages contain one or more labeled anatomical photos/diagrams: a photo of a bone or structure with printed text labels connected to specific parts by leader lines (straight or bent lines, sometimes with a bracket grouping two labels under one shared outer label). For those pages:

1. First, find every distinct labeled figure on the page (a page can have several separate figures, e.g. views of different vertebrae side by side) and report each one's bounding box. A figure's box must contain the photo AND all of the printed label text and leader lines that belong to it — labels are usually printed in the margins around the photo, so the box has to reach out to include the outermost label text on every side. Do NOT include the slide's title, page header/footer, or unrelated body text.
2. Then find EVERY label that points to a specific anatomical structure via a leader line and report its bounding box.

Rules for labels:
- Only include labels that point to a specific anatomical structure via a leader line, with a visible line/pointer connecting the text to one exact spot on a photo. A label with NO leader line is a caption describing the whole photo or sub-photo, not a structure — exclude it even if it names a real anatomical region. For example, on a page showing "L2 vertebra (superior view)" as a heading above a photo, with "Vertebral body", "Pedicle of vertebral arch", etc. as leader-lined labels on that photo: include the leader-lined labels, but exclude "L2 vertebra (superior view)" itself, and exclude any other heading/caption/view-description text near a photo (e.g. "T6 vertebra (superior view)", "C4 vertebra: anterior view", "Lumbar vertebral column (left lateral view)") the same way.
- If two labels are grouped under one shared bracket pointing at a common parent structure (e.g. "Posterior tubercle" and "Anterior tubercle" bracketed together under "Transverse process"), report each of the bracketed labels as its own separate entry, at its own text position — not the shared/parent label.
- Report the box around the label's TEXT only, not the leader line and not the anatomical structure it points to.
- A label's printed text often wraps onto two or three lines (for example "Superior articular" on one line and "process" on the line beneath it, or "Pedicle of" above "vertebral arch"). That is ONE label: report the complete phrase with the lines joined by a single space, and one box that covers all of its lines. Never report just one line of a wrapped label as if it were the whole label, and never report the same label twice.
- Use the exact text as printed, including any footnote marks (e.g. "Transverse foramen*").

Every box is four integers from 0 to 1000 in this order: top edge, left edge, bottom edge, right edge — normalized to the full image regardless of its actual pixel size (0 0 is the top-left corner, 1000 1000 is the bottom-right corner).

Reply with plain text only — no JSON, no markdown, no commentary — one item per line, in exactly this format, all FIGURE lines first and then all LABEL lines:

FIGURE top left bottom right
LABEL top left bottom right | printed label text

For example (numbers and names here are only to show the format):

FIGURE 120 340 860 700
LABEL 215 646 226 683 | Structure A
LABEL 247 630 256 676 | Structure B

If the page has no labeled figure, reply with exactly: NONE`;
}

const NUMBER = '-?\\d+(?:\\.\\d+)?';

function firstFourNumbers(text) {
  const nums = text.match(new RegExp(NUMBER, 'g'));
  return nums && nums.length >= 4 ? nums.slice(0, 4).map(Number) : null;
}

// The line format the prompt asks for. Tolerates a colon after the keyword, commas/brackets
// around the numbers, list bullets, and any casing — the point is to recover every line
// that's usable.
function parseLineFormat(raw) {
  const diagrams = [];
  const labels = [];
  for (const line of raw.split(/\r?\n/)) {
    const figure = /^[\s\-*•\d.)]*FIGURE\b:?(.*)$/i.exec(line);
    if (figure) {
      const box = firstFourNumbers(figure[1]);
      if (box) diagrams.push(box);
      continue;
    }
    const label = /^[\s\-*•\d.)]*LABEL\b:?([^|]*)\|(.+)$/i.exec(line);
    if (label) {
      const box = firstFourNumbers(label[1]);
      if (box) labels.push({ label: label[2].trim().replace(/^["']|["']$/g, ''), box });
    }
  }
  return { diagrams, labels };
}

// Recovers what it can from JSON that doesn't parse (a fallback model may still answer in
// JSON, and long JSON lists break in ways a strict parser can't survive): every label text,
// paired with the first four-number array after it and before the next label — regardless
// of stray keys, dropped braces, or a "]" typed as "}".
function salvageJson(raw) {
  const labels = [];
  const hits = [...raw.matchAll(/"label"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
  const box = new RegExp(`\\[\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*[\\]}]`);
  hits.forEach((hit, i) => {
    const segmentEnd = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    const found = box.exec(raw.slice(hit.index + hit[0].length, segmentEnd));
    if (found) labels.push({ label: hit[1], box: found.slice(1, 5).map(Number) });
  });

  const diagrams = [];
  const diagramsAt = raw.search(/"diagrams"\s*:/);
  if (diagramsAt >= 0) {
    const labelsAt = raw.search(/"labels"\s*:/);
    const ends = [hits.length ? hits[0].index : raw.length, labelsAt >= 0 ? labelsAt : raw.length];
    const chunk = raw.slice(diagramsAt, Math.min(...ends));
    const strictBox = new RegExp(`\\[\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*,\\s*(${NUMBER})\\s*\\]`, 'g');
    for (const m of chunk.matchAll(strictBox)) diagrams.push(m.slice(1, 5).map(Number));
  }
  return { diagrams, labels };
}

// How many entries repeat an earlier one (same text, same spot to within ~2.5% of the page).
// Coarse cells rather than exact numbers because a looping model jitters the coordinates by a
// unit or two between repeats.
function redundantEntryCount(labels) {
  const seen = new Set();
  let redundant = 0;
  for (const item of labels) {
    const cell = Array.isArray(item?.box) ? item.box.map((n) => Math.floor(Number(n) / 25)).join(',') : '';
    const key = `${asText(item?.label).toLowerCase()}|${cell}`;
    if (seen.has(key)) redundant++;
    else seen.add(key);
  }
  return redundant;
}

export function parseAnatomyResponse(raw) {
  const parsed = parseReply(raw);
  const looped = parsed.labels.length > RUNAWAY_LABEL_COUNT || redundantEntryCount(parsed.labels) >= LOOP_REDUNDANT_ENTRIES;
  return looped ? { ...parsed, looped: true } : parsed;
}

function parseReply(raw) {
  if (/^["'`*\s]*NONE\b/i.test(raw)) return { diagrams: [], labels: [] };

  const lines = parseLineFormat(raw);
  if (lines.labels.length > 0 || lines.diagrams.length > 0) return lines;

  // Strict JSON — an object {diagrams, labels}, or a bare array of labels.
  const braceIndex = raw.indexOf('{');
  const bracketIndex = raw.indexOf('[');
  // Whichever opening character appears first is the outer shape: an object's own "labels"
  // array is full of `{...}` objects, so a bare object regex can't otherwise tell "the whole
  // response is an object" from "an array whose first element is an object" — it would
  // match that first nested object and silently drop everything else.
  const isObjectShaped = braceIndex !== -1 && (bracketIndex === -1 || braceIndex < bracketIndex);

  let strict = null;
  if (isObjectShaped) {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        strict = {
          diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [],
          labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        };
      } catch {
        // fall through
      }
    }
  }
  if (!strict) {
    const arrMatch = raw.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        strict = { diagrams: [], labels: JSON.parse(arrMatch[0]) };
      } catch {
        // fall through
      }
    }
  }

  // Valid JSON isn't necessarily usable: a duplicated "label" key, for one, parses fine but
  // overwrites the label text with the box. So compare against the salvage pass and keep
  // whichever recovered more usable labels.
  const salvaged = salvageJson(raw);
  const strictUsable = strict ? strict.labels.filter((l) => Array.isArray(l?.box) && l.box.length === 4).length : 0;
  if (strict && strictUsable >= salvaged.labels.length) return strict;
  if (salvaged.labels.length > 0 || salvaged.diagrams.length > 0) {
    return { diagrams: strict?.diagrams?.length ? strict.diagrams : salvaged.diagrams, labels: salvaged.labels };
  }
  if (strict) return strict;
  throw new Error('Model did not return parseable output');
}

function asText(value, max = 150) {
  if (typeof value === 'string') return value.slice(0, max).trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function sanitizeBox(box) {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const nums = box.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;

  let [ymin, xmin, ymax, xmax] = nums.map((n) => Math.min(1000, Math.max(0, n)));
  if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
  if (xmin > xmax) [xmin, xmax] = [xmax, xmin];

  // Degenerate/near-zero-size boxes are useless to draw an occlusion rectangle over.
  if (ymax - ymin < 2 || xmax - xmin < 2) return null;

  return [ymin, xmin, ymax, xmax];
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// A box far taller than every other label's on the same page is a real, observed failure
// mode, not just theoretical: verified against a live page where 17 of 18 labels landed
// within ~20-25 units tall (0-1000 scale) and one came back ~6x that, badly overlapping two
// neighboring labels underneath it. Real labels are single lines of the same font size, so
// height should stay consistent across a page even though width varies a lot with text
// length — so height, not width, is the reliable outlier signal. Dropped rather than
// resized, matching this function's existing drop-what's-malformed approach.
function dropOversizedOutliers(labels) {
  if (labels.length < 4) return labels; // too few to establish a reliable baseline
  const heights = labels.map((l) => l.box[2] - l.box[0]);
  const medianHeight = median(heights);
  if (medianHeight <= 0) return labels;
  return labels.filter((l) => l.box[2] - l.box[0] <= medianHeight * 3);
}

// A figure's title — "Atlas: superior view", "L2 vertebra (superior view)", "Upper cervical
// vertebrae: posterosuperior view" — describes the whole photo rather than pointing at a part
// of it. The prompt asks the model to leave these out, but a lite model includes them anyway,
// and no structure's name ends in "view", so this is safe to enforce here.
function isViewCaption(text) {
  return /\bviews?\)?\s*$/i.test(text);
}

function boxOverlapRatio(a, b) {
  const height = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const width = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (height <= 0 || width <= 0) return 0;
  const intersection = height * width;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return intersection / union;
}

// The same text listed twice at (nearly) the same spot is the model repeating itself, not two
// structures. The same text at different spots is normal — "Vertebral body" is printed once per
// figure — so position, not text alone, decides.
function dropDuplicates(labels) {
  const kept = [];
  for (const label of labels) {
    const text = label.label.toLowerCase().replace(/\s+/g, ' ');
    const repeated = kept.some((k) => k.text === text && boxOverlapRatio(k.item.box, label.box) >= 0.4);
    if (!repeated) kept.push({ text, item: label });
  }
  return kept.map((k) => k.item);
}

// Same defensive-coercion role as sanitizeCards (llm.js) / sanitizeQuestions (quiz.js):
// a malformed or verbose response from a weaker fallback model must never crash rendering
// or bloat the saved deck — drop anything that doesn't fit the expected shape instead.
export function sanitizeAnatomyLabels(raw) {
  if (!Array.isArray(raw)) return [];

  let labels = raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ label: asText(item.label), box: sanitizeBox(item.box) }))
    .filter((item) => item.label && item.box && !isViewCaption(item.label));

  labels = dropOversizedOutliers(dropDuplicates(labels));

  // Reading order: top-to-bottom, then left-to-right — so the study flow moves through
  // the page the way a person would naturally scan it, not in arbitrary model-output order.
  labels.sort((a, b) => a.box[0] - b.box[0] || a.box[1] - b.box[1]);

  return labels.slice(0, MAX_LABELS_PER_PAGE);
}

// Reuses sanitizeBox's clamp/swap/degenerate-drop logic — same shape of validation, just
// on plain boxes instead of {label, box} objects.
export function sanitizeDiagrams(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeBox).filter(Boolean).slice(0, MAX_DIAGRAMS_PER_PAGE);
}

// One page's worth of vision extraction. `generate` returns the model's raw reply for the page
// (it already walks the provider chain, so an error from it means every provider failed and
// sampling again would only repeat that — those propagate at once). What is retried is a
// reply that can't be used: unparseable, or looped. The first clean reply wins; if every
// attempt loops, the fullest of them is kept, because a looped reply's leading labels are
// real — a page with most of its labels beats losing the page.
export async function extractAnatomyPage(generate) {
  let fullestLooped = null;
  let lastParseError = null;

  for (let attempt = 0; attempt < MAX_EXTRACT_ATTEMPTS; attempt++) {
    const raw = await generate();
    let parsed;
    try {
      parsed = parseAnatomyResponse(raw);
    } catch (err) {
      lastParseError = err;
      continue;
    }

    const page = { labels: sanitizeAnatomyLabels(parsed.labels), diagrams: sanitizeDiagrams(parsed.diagrams) };
    if (!parsed.looped) return page;
    if (!fullestLooped || page.labels.length > fullestLooped.labels.length) fullestLooped = page;
  }

  if (fullestLooped) return fullestLooped;
  throw lastParseError;
}

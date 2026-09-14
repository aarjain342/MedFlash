// Labels on an anatomy diagram are baked into the page's raster image (leader lines +
// printed text drawn as pixels, not separate PDF text objects), so there's no text layer
// to read them from — this asks Gemini's vision input to both find and locate them in one
// call, using the 0-1000 normalized box convention Gemini is actually trained to produce
// for spatial/grounding tasks when asked in plain text (this codebase has no structured
// function-calling schema anywhere — see llm.js's parseJsonArray — so this stays consistent
// with that: prompt for JSON, parse leniently, sanitize defensively).
const MAX_LABELS_PER_PAGE = 60; // a real 36-page sample topped out at 43 on one dense page; headroom above that
const MAX_DIAGRAMS_PER_PAGE = 10;

export function buildAnatomyLabelPrompt(pageIndex, totalPages) {
  return `You are looking at page ${pageIndex + 1} of ${totalPages} from a medical student's anatomy lecture slides.

Some pages are plain bullet-point text with no diagram — for those, return {"diagrams": [], "labels": []}.

Other pages contain one or more labeled anatomical photos/diagrams: a photo of a bone or structure with printed text labels connected to specific parts by leader lines (straight or bent lines, sometimes with a bracket grouping two labels under one shared outer label). For those pages:

1. First, find every distinct photo/diagram image on the page (a page can have several separate photos, e.g. views of different vertebrae side by side) and report each one's own bounding box — just the photo itself, not any surrounding title text, page header/footer, or the printed labels around it.
2. Then find EVERY label that points to a specific anatomical structure via a leader line and report its bounding box.

Rules for labels:
- Only include labels that point to a specific anatomical structure via a leader line, with a visible line/pointer connecting the text to one exact spot on a photo. A label with NO leader line is a caption describing the whole photo or sub-photo, not a structure — exclude it even if it names a real anatomical region. For example, on a page showing "L2 vertebra (superior view)" as a heading above a photo, with "Vertebral body", "Pedicle of vertebral arch", etc. as leader-lined labels on that photo: include the leader-lined labels, but exclude "L2 vertebra (superior view)" itself, and exclude any other heading/caption/view-description text near a photo (e.g. "T6 vertebra (superior view)", "C4 vertebra: anterior view", "Lumbar vertebral column (left lateral view)") the same way.
- If two labels are grouped under one shared bracket pointing at a common parent structure (e.g. "Posterior tubercle" and "Anterior tubercle" bracketed together under "Transverse process"), report each of the bracketed labels as its own separate entry, at its own text position — not the shared/parent label.
- Report the box around the label's TEXT only, not the leader line and not the anatomical structure it points to.
- Use the exact text as printed, including any footnote marks (e.g. "Transverse foramen*").

For every box (diagram or label), use [ymin, xmin, ymax, xmax] as integers from 0 to 1000, normalized to the full image regardless of its actual pixel size (0,0 is the top-left corner, 1000,1000 is the bottom-right corner).

Return ONLY a JSON object (no markdown fences, no commentary) shaped like:
{"diagrams": [[ymin, xmin, ymax, xmax], ...], "labels": [{"label": "...", "box": [ymin, xmin, ymax, xmax]}, ...]}`;
}

// The model is asked for a JSON object (see prompt above), but some responses — especially
// from a weaker fallback model deep in the chain — may still come back as a bare array in
// the old shape. Handle both rather than crashing the whole page's generation on the
// stricter parse alone.
export function parseAnatomyResponse(raw) {
  const braceIndex = raw.indexOf('{');
  const bracketIndex = raw.indexOf('[');
  // Whichever opening character appears first is the outer/top-level shape. This matters
  // because an object-shaped response's own "labels" array is full of `{...}` objects, so
  // a bare object-regex can't otherwise tell "the whole response is an object" apart from
  // "the whole response is an array whose first element happens to be an object" — it would
  // just match that first nested object and silently drop everything else.
  const isObjectShaped = braceIndex !== -1 && (bracketIndex === -1 || braceIndex < bracketIndex);

  if (isObjectShaped) {
    const objMatch = raw.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const parsed = JSON.parse(objMatch[0]);
        return {
          diagrams: Array.isArray(parsed.diagrams) ? parsed.diagrams : [],
          labels: Array.isArray(parsed.labels) ? parsed.labels : [],
        };
      } catch {
        // fall through to array-only handling below
      }
    }
  }

  const arrMatch = raw.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try {
      return { diagrams: [], labels: JSON.parse(arrMatch[0]) };
    } catch {
      // fall through
    }
  }
  throw new Error('Model did not return parseable JSON');
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

// Same defensive-coercion role as sanitizeCards (llm.js) / sanitizeQuestions (quiz.js):
// a malformed or verbose response from a weaker fallback model must never crash rendering
// or bloat the saved deck — drop anything that doesn't fit the expected shape instead.
export function sanitizeAnatomyLabels(raw) {
  if (!Array.isArray(raw)) return [];

  let labels = raw
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ label: asText(item.label), box: sanitizeBox(item.box) }))
    .filter((item) => item.label && item.box);

  labels = dropOversizedOutliers(labels);

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

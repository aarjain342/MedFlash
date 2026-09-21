import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAnatomyLabels,
  sanitizeDiagrams,
  parseAnatomyResponse,
  buildAnatomyLabelPrompt,
  extractAnatomyPage,
} from './anatomy.js';

describe('sanitizeAnatomyLabels', () => {
  test('keeps a well-formed label', () => {
    const result = sanitizeAnatomyLabels([{ label: 'Spinous process', box: [100, 200, 150, 300] }]);
    assert.deepEqual(result, [{ label: 'Spinous process', box: [100, 200, 150, 300] }]);
  });

  test('non-array input returns an empty array instead of throwing', () => {
    assert.deepEqual(sanitizeAnatomyLabels(null), []);
    assert.deepEqual(sanitizeAnatomyLabels(undefined), []);
    assert.deepEqual(sanitizeAnatomyLabels('nope'), []);
  });

  test('drops non-object entries and entries with a missing/empty label', () => {
    const result = sanitizeAnatomyLabels([
      null,
      42,
      'oops',
      { label: '', box: [0, 0, 10, 10] },
      { label: '   ', box: [0, 0, 10, 10] },
      { box: [0, 0, 10, 10] },
    ]);
    assert.deepEqual(result, []);
  });

  test('drops entries with a missing, wrong-length, or non-numeric box', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'A' },
      { label: 'B', box: [1, 2, 3] },
      { label: 'C', box: [1, 2, 3, 'x'] },
      { label: 'D', box: 'not-an-array' },
    ]);
    assert.deepEqual(result, []);
  });

  test('clamps out-of-range box values into 0-1000', () => {
    const [item] = sanitizeAnatomyLabels([{ label: 'Uncinate process', box: [-50, 5, 1200, 20] }]);
    assert.deepEqual(item.box, [0, 5, 1000, 20]);
  });

  test('swaps inverted min/max coordinates', () => {
    const [item] = sanitizeAnatomyLabels([{ label: 'Transverse foramen', box: [150, 300, 100, 200] }]);
    assert.deepEqual(item.box, [100, 200, 150, 300]);
  });

  test('drops degenerate (near-zero-size) boxes', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'Too thin', box: [100, 100, 100, 200] }, // zero height
      { label: 'Too narrow', box: [100, 100, 200, 101] }, // ~zero width
    ]);
    assert.deepEqual(result, []);
  });

  test('sorts by reading order: top-to-bottom, then left-to-right', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'Bottom-right', box: [500, 500, 550, 600] },
      { label: 'Top-left', box: [10, 10, 60, 100] },
      { label: 'Top-right', box: [10, 500, 60, 600] },
    ]);
    assert.deepEqual(result.map((r) => r.label), ['Top-left', 'Top-right', 'Bottom-right']);
  });

  test('drops a label whose box is a height outlier relative to the rest of the page', () => {
    // 4 normal-height labels plus one ~6x taller — matches a real observed failure where
    // one box swallowed two neighboring labels underneath it.
    const result = sanitizeAnatomyLabels([
      { label: 'Normal A', box: [100, 0, 122, 50] }, // height 22
      { label: 'Normal B', box: [200, 0, 220, 50] }, // height 20
      { label: 'Normal C', box: [300, 0, 325, 50] }, // height 25
      { label: 'Normal D', box: [400, 0, 421, 50] }, // height 21
      { label: 'Oversized outlier', box: [500, 0, 632, 50] }, // height 132
    ]);
    assert.deepEqual(
      result.map((r) => r.label),
      ['Normal A', 'Normal B', 'Normal C', 'Normal D']
    );
  });

  test('does not apply the outlier check with too few labels to establish a baseline', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'A', box: [0, 0, 20, 50] },
      { label: 'B', box: [100, 0, 300, 50] },
    ]);
    assert.equal(result.length, 2);
  });

  test('a page of legitimately similar-height labels keeps all of them', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'A', box: [0, 0, 22, 50] },
      { label: 'B', box: [100, 0, 120, 400] }, // much wider (long text), same height — must survive
      { label: 'C', box: [200, 0, 224, 50] },
      { label: 'D', box: [300, 0, 321, 50] },
    ]);
    assert.equal(result.length, 4);
  });

  test('drops a repeat of the same label at the same spot, keeps the same text elsewhere', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'Vertebral body', box: [100, 100, 120, 200] },
      { label: 'vertebral  body', box: [101, 102, 121, 199] }, // the model repeating itself
      { label: 'Vertebral body', box: [600, 100, 620, 200] }, // a different figure's label — real
    ]);
    assert.deepEqual(result.map((r) => r.box[0]), [100, 600]);
  });

  test('drops figure captions that describe a view rather than name a structure', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'Atlas: superior view', box: [100, 100, 120, 300] },
      { label: 'L2 vertebra (superior view)', box: [200, 100, 220, 300] },
      { label: 'Upper cervical vertebrae: posterosuperior view', box: [300, 100, 320, 400] },
      { label: 'Lumbar vertebral column (left lateral view)', box: [400, 100, 420, 400] },
      { label: 'Atlas (C1 vertebra)', box: [500, 100, 520, 300] }, // a leader-lined label, not a caption
      { label: 'Transverse process', box: [600, 100, 620, 300] },
    ]);
    assert.deepEqual(result.map((r) => r.label), ['Atlas (C1 vertebra)', 'Transverse process']);
  });

  test('keeps different labels that happen to sit at the same spot', () => {
    const result = sanitizeAnatomyLabels([
      { label: 'Pedicle', box: [100, 100, 120, 200] },
      { label: 'Lamina', box: [100, 100, 120, 200] },
    ]);
    assert.equal(result.length, 2);
  });

  test('truncates to the per-page cap', () => {
    const many = Array.from({ length: 90 }, (_, i) => ({
      label: `Structure ${i}`,
      box: [i, 0, i + 5, 50],
    }));
    const result = sanitizeAnatomyLabels(many);
    assert.equal(result.length, 60);
  });

  test('caps label text length instead of storing an unbounded string', () => {
    const [item] = sanitizeAnatomyLabels([{ label: 'x'.repeat(500), box: [0, 0, 10, 10] }]);
    assert.equal(item.label.length, 150);
  });
});

describe('sanitizeDiagrams', () => {
  test('keeps well-formed diagram boxes', () => {
    const result = sanitizeDiagrams([[100, 100, 500, 500], [50, 600, 300, 950]]);
    assert.deepEqual(result, [[100, 100, 500, 500], [50, 600, 300, 950]]);
  });

  test('non-array input returns an empty array instead of throwing', () => {
    assert.deepEqual(sanitizeDiagrams(null), []);
    assert.deepEqual(sanitizeDiagrams('nope'), []);
  });

  test('drops malformed boxes (reusing the same validation as labels)', () => {
    const result = sanitizeDiagrams([[1, 2, 3], 'not-a-box', [100, 100, 100, 200], [10, 10, 500, 500]]);
    assert.deepEqual(result, [[10, 10, 500, 500]]);
  });

  test('truncates to the per-page diagram cap', () => {
    const many = Array.from({ length: 20 }, (_, i) => [i, 0, i + 50, 50]);
    assert.equal(sanitizeDiagrams(many).length, 10);
  });
});

describe('parseAnatomyResponse', () => {
  test('parses the one-item-per-line format the prompt asks for', () => {
    const result = parseAnatomyResponse(
      'FIGURE 120 340 860 700\nFIGURE 100 10 300 200\nLABEL 215 646 226 683 | Vertebral body\nLABEL 247 630 256 676 | Transverse foramen*'
    );
    assert.deepEqual(result, {
      diagrams: [[120, 340, 860, 700], [100, 10, 300, 200]],
      labels: [
        { label: 'Vertebral body', box: [215, 646, 226, 683] },
        { label: 'Transverse foramen*', box: [247, 630, 256, 676] },
      ],
    });
  });

  test('tolerates colons, brackets, commas, bullets and casing in the line format', () => {
    const result = parseAnatomyResponse('- figure: [120, 340, 860, 700]\n1. Label: [215, 646, 226, 683] | "Vertebral body"');
    assert.deepEqual(result.diagrams, [[120, 340, 860, 700]]);
    assert.deepEqual(result.labels, [{ label: 'Vertebral body', box: [215, 646, 226, 683] }]);
  });

  test('skips a malformed line without losing the rest of the page', () => {
    const result = parseAnatomyResponse('LABEL 1 2 3 | too few numbers\nLABEL 215 646 226 683 | Vertebral body\nLABEL oops | no numbers');
    assert.deepEqual(result.labels, [{ label: 'Vertebral body', box: [215, 646, 226, 683] }]);
  });

  test('NONE means a page with no labeled figure, not an error', () => {
    assert.deepEqual(parseAnatomyResponse('NONE'), { diagrams: [], labels: [] });
    assert.deepEqual(parseAnatomyResponse('  none.\n'), { diagrams: [], labels: [] });
  });

  test('parses the JSON object shape (a fallback model may answer in JSON)', () => {
    const result = parseAnatomyResponse(
      '{"diagrams": [[10,10,500,500]], "labels": [{"label":"Vertebral body","box":[100,100,150,200]}]}'
    );
    assert.deepEqual(result, {
      diagrams: [[10, 10, 500, 500]],
      labels: [{ label: 'Vertebral body', box: [100, 100, 150, 200] }],
    });
  });

  test('extracts JSON from surrounding prose/markdown fences', () => {
    const result = parseAnatomyResponse('```json\n{"diagrams": [], "labels": []}\n```');
    assert.deepEqual(result, { diagrams: [], labels: [] });
  });

  test('falls back to treating a bare JSON array as labels-only', () => {
    const result = parseAnatomyResponse('[{"label":"Vertebral body","box":[100,100,150,200]}]');
    assert.deepEqual(result, { diagrams: [], labels: [{ label: 'Vertebral body', box: [100, 100, 150, 200] }] });
  });

  // The next three are the real ways a lite model's long JSON broke on dense pages
  // (~half of attempts before the line format), each of which used to fail the whole page.
  test('salvages JSON with dropped opening braces after the first label', () => {
    const raw =
      '{"diagrams": [[129, 252, 513, 502]], "labels": [{"label": "Vertebral foramen", "box": [163, 269, 178, 336]}, "label": "Vertebral body", "box": [146, 376, 163, 432]}, "label": "Spinous process", "box": [442, 392, 458, 449]}]}';
    const result = parseAnatomyResponse(raw);
    assert.deepEqual(result.diagrams, [[129, 252, 513, 502]]);
    assert.deepEqual(result.labels.map((l) => l.label), ['Vertebral foramen', 'Vertebral body', 'Spinous process']);
    assert.deepEqual(result.labels[2].box, [442, 392, 458, 449]);
  });

  test('salvages JSON where a box array is closed with } instead of ]', () => {
    const raw = '{"diagrams": [[105, 31, 396, 350]], "labels": [{"label": "Vertebral body", "box": [354, 165, 394, 209]}, {"label": "Spinous process", "box": [463, 463, 862, 539}]}\n}';
    const result = parseAnatomyResponse(raw);
    assert.deepEqual(result.labels.map((l) => l.label), ['Vertebral body', 'Spinous process']);
    assert.deepEqual(result.labels[1].box, [463, 463, 862, 539]);
  });

  test('salvages JSON with stray extra keys and a duplicated "label" key', () => {
    const raw =
      '{"diagrams": [], "labels": [{"label": "Vertebral body", "box": [215, 646, 226, 683], "ymin": 215, "xmin": 646}, {"label": "Superior articular process", "label": [392, 856, 403, 919], "label": "392", "xmin": 856}]}';
    const result = parseAnatomyResponse(raw);
    assert.deepEqual(result.labels, [
      { label: 'Vertebral body', box: [215, 646, 226, 683] },
      { label: 'Superior articular process', box: [392, 856, 403, 919] },
    ]);
  });

  test('flags a reply that got stuck repeating one line', () => {
    // The real failure: a few dozen good labels, then the same jittering line until the token limit.
    const good = Array.from({ length: 30 }, (_, i) => `LABEL ${i * 30} 10 ${i * 30 + 12} 90 | Structure ${i}`);
    const stuck = Array.from({ length: 80 }, (_, i) => `LABEL ${740 + (i % 2)} 338 ${757 - (i % 2)} 353 | T7`);
    const parsed = parseAnatomyResponse([...good, ...stuck].join('\n'));
    assert.equal(parsed.looped, true);
    assert.equal(parsed.labels.length, 110); // nothing is discarded here; the caller decides
  });

  test('flags a reply with more labels than any page could hold', () => {
    const many = Array.from({ length: 130 }, (_, i) => `LABEL ${(i % 100) * 10} ${Math.floor(i / 100) * 500} ${(i % 100) * 10 + 8} ${Math.floor(i / 100) * 500 + 60} | Structure ${i}`);
    assert.equal(parseAnatomyResponse(many.join('\n')).looped, true);
  });

  test('does not flag a genuinely dense page, or a label legitimately repeated across figures', () => {
    const dense = Array.from({ length: 55 }, (_, i) => `LABEL ${i * 10} 10 ${i * 10 + 8} 60 | Structure ${i}`);
    assert.equal(parseAnatomyResponse(dense.join('\n')).looped, undefined);

    const repeatedName = Array.from({ length: 20 }, (_, i) => `LABEL ${i * 50} 10 ${i * 50 + 12} 90 | Vertebral body`);
    assert.equal(parseAnatomyResponse(repeatedName.join('\n')).looped, undefined);
  });

  test('throws a clear error when nothing usable is present', () => {
    assert.throws(() => parseAnatomyResponse('sorry, I cannot help with that'), /did not return parseable output/);
  });
});

describe('buildAnatomyLabelPrompt', () => {
  test('instructs the model to exclude captions/headings with no leader line', () => {
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /NO leader line/);
    assert.match(prompt, /L2 vertebra/);
  });

  test('asks for each diagram/photo region separately from labels', () => {
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /find every distinct labeled figure/);
    assert.match(prompt, /FIGURE top left bottom right/);
    assert.match(prompt, /LABEL top left bottom right | printed label text/);
  });

  test('tells the model a figure box must include its printed labels, not just the photo', () => {
    // Regression: asking for "just the photo" produced boxes that excluded labels printed
    // in the margins, so cropping to them cut those labels off.
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /photo AND all of the printed label text/);
    assert.doesNotMatch(prompt, /just the photo itself/);
  });

  test('treats a label wrapped across lines as one label', () => {
    // Regression: two-line labels ("Pedicle of / vertebral arch") came back as fragments
    // ("Pedicle of"), which made for unanswerable quiz questions.
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /wraps onto two or three lines/);
    assert.match(prompt, /ONE label/);
  });

  test('includes the page number and total', () => {
    const prompt = buildAnatomyLabelPrompt(4, 36);
    assert.match(prompt, /page 5 of 36/);
  });
});

describe('extractAnatomyPage', () => {
  const CLEAN = 'FIGURE 100 100 600 600\nLABEL 200 300 220 400 | Vertebral body\nLABEL 300 300 320 420 | Spinous process';
  const stuck = (n) => Array.from({ length: n }, (_, i) => `LABEL ${740 + (i % 2)} 338 ${757 - (i % 2)} 353 | T7`).join('\n');
  const LOOPED = `LABEL 143 375 163 432 | Vertebral body\nLABEL 439 391 454 449 | Spinous process\n${stuck(60)}`;

  // Returns the queued replies in order and counts how many were requested.
  function fakeGenerate(...replies) {
    const generate = async () => {
      generate.calls++;
      const next = replies[Math.min(generate.calls - 1, replies.length - 1)];
      if (next instanceof Error) throw next;
      return next;
    };
    generate.calls = 0;
    return generate;
  }

  test('returns a clean first reply without sampling again', async () => {
    const generate = fakeGenerate(CLEAN);
    const page = await extractAnatomyPage(generate);
    assert.deepEqual(page.labels.map((l) => l.label), ['Vertebral body', 'Spinous process']);
    assert.deepEqual(page.diagrams, [[100, 100, 600, 600]]);
    assert.equal(generate.calls, 1);
  });

  test('samples again after an unparseable reply', async () => {
    const generate = fakeGenerate('I am unable to see labels here', CLEAN);
    const page = await extractAnatomyPage(generate);
    assert.equal(page.labels.length, 2);
    assert.equal(generate.calls, 2);
  });

  test('prefers a later clean reply over an earlier looped one', async () => {
    const generate = fakeGenerate(LOOPED, CLEAN);
    const page = await extractAnatomyPage(generate);
    assert.deepEqual(page.labels.map((l) => l.label), ['Vertebral body', 'Spinous process']);
    assert.equal(generate.calls, 2);
  });

  test('when every attempt loops, keeps the fullest one rather than losing the page', async () => {
    const shorter = 'LABEL 143 375 163 432 | Vertebral body\n' + stuck(40);
    const generate = fakeGenerate(shorter, LOOPED, shorter);
    const page = await extractAnatomyPage(generate);
    assert.equal(generate.calls, 3);
    // LOOPED carries one more real label than `shorter`; the repeated T7 collapses to one entry.
    assert.deepEqual(page.labels.map((l) => l.label).sort(), ['Spinous process', 'T7', 'Vertebral body']);
  });

  test('throws the parse error once every attempt is unparseable', async () => {
    const generate = fakeGenerate('nope', 'still nope', 'no labels here either');
    await assert.rejects(extractAnatomyPage(generate), /did not return parseable output/);
    assert.equal(generate.calls, 3);
  });

  test('a provider failure propagates immediately instead of being retried', async () => {
    const generate = fakeGenerate(new Error('All providers exhausted'), CLEAN);
    await assert.rejects(extractAnatomyPage(generate), /All providers exhausted/);
    assert.equal(generate.calls, 1);
  });

  test('an explicit NONE is a finished answer, not a retry', async () => {
    const generate = fakeGenerate('NONE', CLEAN);
    const page = await extractAnatomyPage(generate);
    assert.deepEqual(page, { labels: [], diagrams: [] });
    assert.equal(generate.calls, 1);
  });
});

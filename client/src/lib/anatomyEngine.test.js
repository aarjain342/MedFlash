import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSteps,
  initAnatomyState,
  getCurrentStep,
  recordResult,
  advance,
  getStats,
  getPageCrop,
} from './anatomyEngine.js';

function samplePages() {
  return [
    {
      page: 1,
      image: 'data:image/png;base64,AAA',
      labels: [
        { id: 'p1-a', label: 'Spinous process', box: [10, 10, 20, 20] },
        { id: 'p1-b', label: 'Vertebral body', box: [30, 30, 40, 40] },
      ],
    },
    {
      page: 2,
      image: 'data:image/png;base64,BBB',
      labels: [{ id: 'p2-a', label: 'Transverse foramen', box: [10, 10, 20, 20] }],
    },
  ];
}

describe('buildSteps', () => {
  test('flattens every page\'s labels in page order, then label order', () => {
    const steps = buildSteps(samplePages());
    assert.deepEqual(
      steps.map((s) => s.labelId),
      ['p1-a', 'p1-b', 'p2-a']
    );
  });

  test('handles missing/empty pages and labels without throwing', () => {
    assert.deepEqual(buildSteps(null), []);
    assert.deepEqual(buildSteps([{ page: 1, labels: [] }, { page: 2 }]), []);
  });
});

describe('initAnatomyState', () => {
  test('starts at cursor 0, not complete, when there are steps', () => {
    const state = initAnatomyState(samplePages());
    assert.deepEqual(state, { cursor: 0, results: {}, complete: false });
  });

  test('starts complete when there are no labels anywhere', () => {
    const state = initAnatomyState([{ page: 1, labels: [] }]);
    assert.equal(state.complete, true);
  });
});

describe('getCurrentStep', () => {
  test('returns the first label first, with correct step numbering', () => {
    const pages = samplePages();
    const state = initAnatomyState(pages);
    const step = getCurrentStep(pages, state);
    assert.equal(step.labelId, 'p1-a');
    assert.equal(step.label.label, 'Spinous process');
    assert.equal(step.stepNumber, 1);
    assert.equal(step.totalSteps, 3);
  });

  test('returns null once the cursor moves past the last step', () => {
    const pages = samplePages();
    const state = { cursor: 3, results: {}, complete: true };
    assert.equal(getCurrentStep(pages, state), null);
  });
});

describe('recordResult / advance / getStats', () => {
  test('advancing through every label reaches complete', () => {
    const pages = samplePages();
    const state = initAnatomyState(pages);

    recordResult(state, 'p1-a', true);
    advance(pages, state);
    assert.equal(state.complete, false);

    recordResult(state, 'p1-b', false);
    advance(pages, state);
    assert.equal(state.complete, false);

    recordResult(state, 'p2-a', true);
    advance(pages, state);
    assert.equal(state.complete, true);

    assert.deepEqual(getStats(state), { correct: 2, wrong: 1, attempted: 3 });
  });

  test('resuming from a saved mid-session state continues at the right step', () => {
    const pages = samplePages();
    const saved = { cursor: 1, results: { 'p1-a': true }, complete: false };
    const step = getCurrentStep(pages, saved);
    assert.equal(step.labelId, 'p1-b');
    assert.deepEqual(getStats(saved), { correct: 1, wrong: 0, attempted: 1 });
  });
});

describe('getPageCrop', () => {
  test('a page with no labels and no diagrams falls back to the full image', () => {
    assert.deepEqual(getPageCrop({ labels: [], diagrams: [] }), [0, 0, 1000, 1000]);
    assert.deepEqual(getPageCrop(null), [0, 0, 1000, 1000]);
    assert.deepEqual(getPageCrop({}), [0, 0, 1000, 1000]);
  });

  test('crops tightly (plus padding) around a small cluster of labels, not the whole page', () => {
    // Mimics a title-slide layout: a small inset diagram in one corner of an otherwise
    // mostly-empty/branding page. No `diagrams` field — the label-union fallback path.
    const labels = [
      { box: [180, 700, 220, 800] },
      { box: [250, 680, 280, 780] },
    ];
    const [cy0, cx0, cy1, cx1] = getPageCrop({ labels });
    // Should be far smaller than the full 0-1000 page, and centered on the label cluster.
    assert.ok(cy1 - cy0 < 400, `expected a tight crop, got height ${cy1 - cy0}`);
    assert.ok(cx1 - cx0 < 400, `expected a tight crop, got width ${cx1 - cx0}`);
    assert.ok(cy0 < 180 && cy1 > 280); // fully contains both label boxes
    assert.ok(cx0 < 680 && cx1 > 800);
  });

  test('never zooms in tighter than the minimum crop size, even for one tiny label', () => {
    const [cy0, cx0, cy1, cx1] = getPageCrop({ labels: [{ box: [500, 500, 510, 510] }] });
    assert.ok(cy1 - cy0 >= 260);
    assert.ok(cx1 - cx0 >= 260);
  });

  test('a page where labels span nearly the whole image stays close to the full page', () => {
    const labels = [
      { box: [50, 50, 70, 150] },
      { box: [900, 850, 950, 950] },
    ];
    const [cy0, cx0, cy1, cx1] = getPageCrop({ labels });
    assert.ok(cy0 < 50 && cy1 > 900);
    assert.ok(cx0 < 50 && cx1 > 850);
  });

  test('clamps to the image bounds instead of producing negative or >1000 coordinates', () => {
    const [cy0, cx0, cy1, cx1] = getPageCrop({ labels: [{ box: [5, 5, 15, 15] }] });
    assert.ok(cy0 >= 0 && cx0 >= 0 && cy1 <= 1000 && cx1 <= 1000);
  });

  test('prefers explicit diagram regions over labels when both are present', () => {
    // The label union below would produce a huge crop; the diagram region says the actual
    // photo is a small area elsewhere — diagrams should win.
    const page = {
      diagrams: [[700, 700, 900, 900]],
      labels: [{ box: [10, 10, 950, 950] }],
    };
    const [cy0, cx0, cy1, cx1] = getPageCrop(page);
    assert.ok(cy1 - cy0 < 400 && cx1 - cx0 < 400, 'expected the tight diagram-based crop, not the huge label box');
    assert.ok(cy0 < 700 && cy1 > 900 && cx0 < 700 && cx1 > 900);
  });

  test('unions multiple diagram regions (a page with several separate photos)', () => {
    const page = { diagrams: [[50, 50, 200, 200], [700, 700, 900, 950]], labels: [] };
    const [cy0, cx0, cy1, cx1] = getPageCrop(page);
    assert.ok(cy0 < 50 && cy1 > 900 && cx0 < 50 && cx1 > 950);
  });

  test('the label-fallback trims a wildly mispositioned outlier label instead of following it', () => {
    // Matches a real observed failure: a tight, legitimate cluster of labels plus one
    // label whose box lands somewhere else entirely, dragging a plain min/max union open.
    const tightCluster = Array.from({ length: 12 }, (_, i) => ({
      box: [600 + i, 600 + i, 620 + i, 650 + i],
    }));
    const labels = [...tightCluster, { box: [0, 0, 30, 30] }]; // one wayward outlier near the corner
    const [, cx0] = getPageCrop({ labels });
    // Without trimming, cx0 would be ~0 (dragged all the way to the outlier). With
    // trimming, it should stay close to the real cluster's own left edge (~600).
    assert.ok(cx0 > 400, `expected the outlier to be trimmed out, got cx0=${cx0}`);
  });

  test('does not trim with too few labels to establish a safe baseline (small pages keep plain min/max)', () => {
    const labels = [{ box: [500, 500, 520, 520] }, { box: [0, 0, 20, 20] }];
    const [cy0, cx0] = getPageCrop({ labels });
    // Only 2 labels — trimming is skipped, so the crop still has to contain both.
    assert.ok(cy0 < 20 && cx0 < 20);
  });

  test('given a specific label, crops to just the diagram it belongs to — not every diagram on the page', () => {
    // Matches a real observed complaint: a 4-diagram page correctly excluded the title
    // panel, but still forced showing all 4 diagrams at once for a question about one of
    // them, making the actual occluded label hard to even find.
    const page = {
      diagrams: [
        [50, 50, 300, 300], // diagram A
        [700, 700, 950, 950], // diagram B, far away
      ],
      labels: [],
    };
    const labelOnA = { box: [100, 100, 130, 200] }; // clearly inside diagram A only
    const [cy0, cx0, cy1, cx1] = getPageCrop(page, labelOnA);
    assert.ok(cy0 < 50 && cy1 > 300, 'should contain diagram A');
    assert.ok(cx0 < 50 && cx1 > 300, 'should contain diagram A');
    assert.ok(cy1 < 700 && cx1 < 700, 'should NOT extend out to diagram B');
  });

  test('refocuses correctly when the next label belongs to a different diagram', () => {
    const page = {
      diagrams: [[50, 50, 300, 300], [700, 700, 950, 950]],
      labels: [],
    };
    const onA = getPageCrop(page, { box: [100, 100, 130, 200] });
    const onB = getPageCrop(page, { box: [750, 750, 780, 850] });
    assert.notDeepEqual(onA, onB);
    assert.ok(onB[0] > 500, 'crop for the label on diagram B should be positioned over B, not A');
  });

  test('a label printed outside the figure box (photo-only box) is still fully in frame', () => {
    // Regression: the model boxed just the photo, while label text sits in the margins
    // around it. Cropping to the box alone cut those labels off (confirmed live).
    const photoOnly = [200, 400, 800, 600];
    const leftLabel = { box: [300, 250, 320, 390] }; // printed left of the photo
    const rightLabel = { box: [500, 610, 520, 760] }; // printed right of the photo
    const page = { diagrams: [photoOnly], labels: [leftLabel, rightLabel] };
    for (const label of [leftLabel, rightLabel]) {
      const [cy0, cx0, cy1, cx1] = getPageCrop(page, label);
      for (const l of page.labels) {
        assert.ok(l.box[0] >= cy0 && l.box[2] <= cy1 && l.box[1] >= cx0 && l.box[3] <= cx1, 'every label around the figure stays in frame');
      }
    }
  });

  test('a label between two figures joins the nearest one instead of forcing both into frame', () => {
    const page = {
      diagrams: [[50, 50, 300, 300], [700, 700, 950, 950]],
      labels: [],
    };
    const strayLabel = { box: [480, 480, 500, 500] }; // center in the gap, nearer diagram A
    const [cy0, cx0, cy1, cx1] = getPageCrop(page, strayLabel);
    assert.ok(cy0 <= 50 && cx0 <= 50, 'contains the nearest figure');
    assert.ok(cy1 >= 500 && cx1 >= 500, 'the label itself is always in frame');
    assert.ok(cy1 < 700 && cx1 < 700, 'but does not reach the other figure');
  });

  test('the current label is always in frame even when it is far from every figure', () => {
    const page = { diagrams: [[50, 50, 300, 300]], labels: [] };
    const wayward = { box: [900, 900, 920, 950] };
    const [cy0, cx0, cy1, cx1] = getPageCrop(page, wayward);
    assert.ok(wayward.box[0] >= cy0 && wayward.box[2] <= cy1 && wayward.box[1] >= cx0 && wayward.box[3] <= cx1);
  });

  test('a distant stray label does not stretch the crop for other labels on the same figure', () => {
    const figure = [200, 300, 600, 700];
    const near = { box: [300, 250, 320, 400] };
    const stray = { box: [960, 960, 990, 999] }; // nearest to the only figure, but far away
    const [cy0, cx0, cy1, cx1] = getPageCrop({ diagrams: [figure], labels: [near, stray] }, near);
    assert.ok(cy1 < 900 && cx1 < 900, `crop should ignore the far-away stray, got ${[cy0, cx0, cy1, cx1]}`);
  });

  test('with no diagrams field, a specific label crops generously around just that label — not distant labels on the page', () => {
    const page = {
      labels: [
        { box: [100, 100, 120, 150] }, // the current label
        { box: [800, 800, 820, 850] }, // a distant, unrelated label elsewhere on the page
      ],
    };
    const [cy0, cx0, cy1, cx1] = getPageCrop(page, page.labels[0]);
    assert.ok(cy1 < 800 && cx1 < 800, 'should not stretch to include the distant label');
    assert.ok(cy0 < 100 && cx0 < 100, 'should contain the current label with some margin');
  });
});

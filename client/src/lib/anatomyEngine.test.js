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
  test('a page with no labels falls back to the full image', () => {
    assert.deepEqual(getPageCrop([]), [0, 0, 1000, 1000]);
    assert.deepEqual(getPageCrop(null), [0, 0, 1000, 1000]);
  });

  test('crops tightly (plus padding) around a small cluster of labels, not the whole page', () => {
    // Mimics a title-slide layout: a small inset diagram in one corner of an otherwise
    // mostly-empty/branding page.
    const labels = [
      { box: [180, 700, 220, 800] },
      { box: [250, 680, 280, 780] },
    ];
    const [cy0, cx0, cy1, cx1] = getPageCrop(labels);
    // Should be far smaller than the full 0-1000 page, and centered on the label cluster.
    assert.ok(cy1 - cy0 < 400, `expected a tight crop, got height ${cy1 - cy0}`);
    assert.ok(cx1 - cx0 < 400, `expected a tight crop, got width ${cx1 - cx0}`);
    assert.ok(cy0 < 180 && cy1 > 280); // fully contains both label boxes
    assert.ok(cx0 < 680 && cx1 > 800);
  });

  test('never zooms in tighter than the minimum crop size, even for one tiny label', () => {
    const [cy0, cx0, cy1, cx1] = getPageCrop([{ box: [500, 500, 510, 510] }]);
    assert.ok(cy1 - cy0 >= 260);
    assert.ok(cx1 - cx0 >= 260);
  });

  test('a page where labels span nearly the whole image stays close to the full page', () => {
    const labels = [
      { box: [50, 50, 70, 150] },
      { box: [900, 850, 950, 950] },
    ];
    const [cy0, cx0, cy1, cx1] = getPageCrop(labels);
    assert.ok(cy0 < 50 && cy1 > 900);
    assert.ok(cx0 < 50 && cx1 > 850);
  });

  test('clamps to the image bounds instead of producing negative or >1000 coordinates', () => {
    const [cy0, cx0, cy1, cx1] = getPageCrop([{ box: [5, 5, 15, 15] }]);
    assert.ok(cy0 >= 0 && cx0 >= 0 && cy1 <= 1000 && cx1 <= 1000);
  });
});

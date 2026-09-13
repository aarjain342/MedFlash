import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSteps,
  initAnatomyState,
  getCurrentStep,
  recordResult,
  advance,
  getStats,
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

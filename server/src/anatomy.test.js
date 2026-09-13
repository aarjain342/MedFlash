import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAnatomyLabels, buildAnatomyLabelPrompt } from './anatomy.js';

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

describe('buildAnatomyLabelPrompt', () => {
  test('instructs the model to exclude captions/headings with no leader line', () => {
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /NO leader line/);
    assert.match(prompt, /L2 vertebra/);
  });

  test('instructs the model to return an empty array for non-diagram pages', () => {
    const prompt = buildAnatomyLabelPrompt(0, 10);
    assert.match(prompt, /return an empty array/);
  });

  test('includes the page number and total', () => {
    const prompt = buildAnatomyLabelPrompt(4, 36);
    assert.match(prompt, /page 5 of 36/);
  });
});

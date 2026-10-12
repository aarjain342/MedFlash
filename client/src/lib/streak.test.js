import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { levelFor, buildActivityGrid, longestRun, localDateStr } from './streak.js';

describe('localDateStr', () => {
  test('uses the local calendar date, zero-padded', () => {
    assert.equal(localDateStr(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
    assert.equal(localDateStr(new Date(2026, 8, 21, 0, 1)), '2026-09-21');
  });
});

describe('levelFor', () => {
  test('buckets answered-card counts into five levels', () => {
    assert.deepEqual([0, 1, 4, 5, 14, 15, 29, 30, 200].map(levelFor), [0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('buildActivityGrid', () => {
  // Monday 21 September 2026.
  const today = new Date(2026, 8, 21, 15, 0);

  test('is weeks x 7 cells, ending in the current week', () => {
    const cells = buildActivityGrid({}, today, 17);
    assert.equal(cells.length, 17 * 7);
    assert.equal(cells.filter((c) => c.isToday).length, 1);
  });

  test('starts on a Sunday and puts today in the right row of the last column', () => {
    const cells = buildActivityGrid({}, today, 17);
    assert.equal(new Date(`${cells[0].date}T12:00:00`).getDay(), 0);
    const last = cells.slice(-7); // Sun..Sat of the current week
    assert.equal(last[1].isToday, true); // Monday
    assert.deepEqual(last.map((c) => c.future), [false, false, true, true, true, true, true]);
  });

  test('carries each day\'s count and level, and never colours the future', () => {
    const cells = buildActivityGrid({ '2026-09-21': 12, '2026-09-20': 1, '2026-09-22': 99 }, today, 2);
    const byDate = Object.fromEntries(cells.map((c) => [c.date, c]));
    assert.equal(byDate['2026-09-21'].level, 2);
    assert.equal(byDate['2026-09-20'].level, 1);
    assert.equal(byDate['2026-09-22'].level, 0); // future
  });

  test('works across a year boundary', () => {
    const cells = buildActivityGrid({ '2025-12-31': 40 }, new Date(2026, 0, 2), 3);
    assert.equal(cells.find((c) => c.date === '2025-12-31').level, 4);
  });
});

describe('longestRun', () => {
  test('finds the longest stretch of consecutive days', () => {
    assert.equal(longestRun(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-10', '2026-09-11']), 3);
  });

  test('handles empty input, duplicates and unsorted dates', () => {
    assert.equal(longestRun([]), 0);
    assert.equal(longestRun(['2026-09-02', '2026-09-01', '2026-09-01']), 2);
  });

  test('counts across month ends', () => {
    assert.equal(longestRun(['2026-08-31', '2026-09-01']), 2);
  });
});

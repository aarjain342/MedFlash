import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme, THEMES } from './theme.js';

describe('resolveTheme', () => {
  test('an explicit choice wins over the system setting', () => {
    assert.equal(resolveTheme('light', true), 'light');
    assert.equal(resolveTheme('dark', false), 'dark');
  });

  test('"system" follows the OS', () => {
    assert.equal(resolveTheme('system', true), 'dark');
    assert.equal(resolveTheme('system', false), 'light');
  });

  test('anything unrecognised falls back to the system setting', () => {
    assert.equal(resolveTheme('sepia', true), 'dark');
    assert.equal(resolveTheme(undefined, false), 'light');
  });

  test('offers exactly system, light and dark', () => {
    assert.deepEqual(THEMES, ['system', 'light', 'dark']);
  });
});

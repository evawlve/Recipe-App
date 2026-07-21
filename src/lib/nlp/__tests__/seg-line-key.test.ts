import { canonicalizeSegLine } from '../seg-line-key';

describe('canonicalizeSegLine', () => {
  test('lowercases', () => {
    expect(canonicalizeSegLine('Two Eggs AND Toast')).toBe('two eggs and toast');
  });

  test('collapses internal whitespace runs (spaces, tabs, newlines)', () => {
    expect(canonicalizeSegLine('2  eggs\tand   toast')).toBe('2 eggs and toast');
    expect(canonicalizeSegLine('eggs\nbacon')).toBe('eggs bacon');
  });

  test('trims leading/trailing whitespace', () => {
    expect(canonicalizeSegLine('  2 eggs and toast  ')).toBe('2 eggs and toast');
  });

  test('strips trailing punctuation', () => {
    expect(canonicalizeSegLine('2 eggs and toast.')).toBe('2 eggs and toast');
    expect(canonicalizeSegLine('2 eggs and toast!?')).toBe('2 eggs and toast');
    expect(canonicalizeSegLine('2 eggs and toast;')).toBe('2 eggs and toast');
  });

  test('strips trailing punctuation separated by whitespace', () => {
    expect(canonicalizeSegLine('2 eggs and toast .')).toBe('2 eggs and toast');
  });

  test('equivalent variants of the same line collapse to one key', () => {
    const key = canonicalizeSegLine('2 eggs and toast for breakfast');
    expect(canonicalizeSegLine('  2 Eggs  AND toast for Breakfast. ')).toBe(key);
    expect(canonicalizeSegLine('2 eggs and toast for breakfast!!')).toBe(key);
  });

  test('preserves internal punctuation (list separators are load-bearing)', () => {
    expect(canonicalizeSegLine('eggs, toast; bacon')).toBe('eggs, toast; bacon');
    expect(canonicalizeSegLine('eggs, toast')).not.toBe(canonicalizeSegLine('eggs toast'));
  });

  test('NEVER strips digits/quantities — different quantities are different keys', () => {
    expect(canonicalizeSegLine('2 eggs and toast')).toBe('2 eggs and toast');
    expect(canonicalizeSegLine('2 eggs and toast')).not.toBe(canonicalizeSegLine('3 eggs and toast'));
    expect(canonicalizeSegLine('1.5 cups rice')).toBe('1.5 cups rice');
  });

  test('preserves decimal quantities at end of line (only punctuation runs stripped)', () => {
    // trailing "." after a digit is still trailing punctuation; the digit itself survives
    expect(canonicalizeSegLine('rice 1.5')).toBe('rice 1.5');
  });

  test('empty and whitespace-only input yield empty key', () => {
    expect(canonicalizeSegLine('')).toBe('');
    expect(canonicalizeSegLine('   ')).toBe('');
  });
});

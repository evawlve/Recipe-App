import { SegmentedItem } from '../ai-segmenter';
import { diffSegments, normalizeSegName, segmentNames } from '../segmentation-diff';

const item = (rawText: string, normalizedForm = '', mealType: SegmentedItem['mealType'] = 'snacks'): SegmentedItem => ({
  rawText,
  mealType,
  brand: '',
  normalizedForm,
});

describe('normalizeSegName', () => {
  test('lowercases, collapses whitespace, trims', () => {
    expect(normalizeSegName('  Wheat   Toast ')).toBe('wheat toast');
  });
});

describe('segmentNames', () => {
  test('prefers normalizedForm, falls back to rawText when empty', () => {
    expect(segmentNames([item('2 eggs', 'eggs'), item('wheat toast')])).toEqual(['eggs', 'wheat toast']);
  });

  test('returns sorted names (multiset form)', () => {
    expect(segmentNames([item('toast', 'toast'), item('2 eggs', 'eggs')])).toEqual(['eggs', 'toast']);
  });
});

describe('diffSegments', () => {
  const eggsAndToast = [item('2 eggs', 'eggs', 'breakfast'), item('wheat toast', 'wheat toast', 'breakfast')];

  test('identical segmentations match', () => {
    const d = diffSegments(eggsAndToast, [...eggsAndToast]);
    expect(d.same).toBe(true);
    expect(d.countChanged).toBe(false);
    expect(d.onlyCached).toEqual([]);
    expect(d.onlyFresh).toEqual([]);
  });

  test('re-ordered items are NOT drift (multiset compare)', () => {
    const reordered = [eggsAndToast[1], eggsAndToast[0]];
    expect(diffSegments(eggsAndToast, reordered).same).toBe(true);
  });

  test('case/whitespace variation in names is NOT drift', () => {
    const variant = [item('2 eggs', 'Eggs', 'breakfast'), item('wheat toast', ' Wheat  Toast ', 'breakfast')];
    expect(diffSegments(eggsAndToast, variant).same).toBe(true);
  });

  test('item-count change is drift', () => {
    const merged = [item('2 eggs and wheat toast', 'eggs and wheat toast', 'breakfast')];
    const d = diffSegments(eggsAndToast, merged);
    expect(d.same).toBe(false);
    expect(d.countChanged).toBe(true);
    expect(d.cachedCount).toBe(2);
    expect(d.freshCount).toBe(1);
  });

  test('same count but renamed item is drift, reported both ways', () => {
    const renamed = [item('2 eggs', 'eggs', 'breakfast'), item('white toast', 'white toast', 'breakfast')];
    const d = diffSegments(eggsAndToast, renamed);
    expect(d.same).toBe(false);
    expect(d.countChanged).toBe(false);
    expect(d.onlyCached).toEqual(['wheat toast']);
    expect(d.onlyFresh).toEqual(['white toast']);
  });

  test('duplicates count as a multiset (2x eggs vs 1x eggs + toast is drift)', () => {
    const twoEggs = [item('egg', 'eggs'), item('egg', 'eggs')];
    const eggAndToast = [item('egg', 'eggs'), item('toast', 'toast')];
    const d = diffSegments(twoEggs, eggAndToast);
    expect(d.same).toBe(false);
    expect(d.onlyCached).toEqual(['eggs']);
    expect(d.onlyFresh).toEqual(['toast']);
  });
});

/**
 * displayServingLabel() — punch #298. The two records are the ones Lane B S55
 * read on the `/api/foods/search` wire for `Rosterrie chicken`; the strings are
 * their `OffFood.servingSize` exactly as the box stores them (read 2026-09-24).
 */
import { displayServingLabel } from './serving-display-label';

describe('displayServingLabel', () => {
  test('off_0260664307833: `4 4.0 (112 g)` displays as one label serving', () => {
    expect(displayServingLabel('4 4.0 (112 g)')).toBe('1 serving (112 g)');
  });

  test('off_0200947019732: `4 1 (112 g)` displays as one label serving', () => {
    expect(displayServingLabel('4 1 (112 g)')).toBe('1 serving (112 g)');
  });

  test('the parenthetical is kept verbatim, whatever its unit', () => {
    expect(displayServingLabel('4 1 (113.398 g)')).toBe('1 serving (113.398 g)');
    expect(displayServingLabel('1 1 (100 ml)')).toBe('1 serving (100 ml)');
  });

  test('two bare numbers with no parenthetical display as a bare `1 serving`', () => {
    expect(displayServingLabel('4 4')).toBe('1 serving');
  });

  test('control: ordinary labels are byte-unchanged', () => {
    for (const label of [
      '1 container (170 g)',
      '2 tbsp (30 g)',
      '15 pieces (28 g)',
      '1 1/2 cup (45 g)',   // a mixed fraction, not two bare numbers
      '1 4 oz (112 g)',     // quantity plus a measure word — still readable
      '4 1 piece (112 g)',
      '112 g',
      '100 g',
      '1 serving',
      '',
    ]) {
      expect(displayServingLabel(label)).toBe(label);
    }
  });
});

import fixture from './fixtures/removal-billing-s459-rmd.json';
import { itemRemovalClause, stripSoloRemoval } from '../negated-part-drop';
import { applyComponentSubtraction } from '../component-subtraction';
import { ALIASES, CLAUSE_ALIASES_ES } from '../component-table';

// s459 RM-d: `hold the` and Spanish `sin` bill like `no`. Winners are frozen; only the clause feed and the gate are under test.
type Case = (typeof fixture.cases)[number];
describe('removal billing fixture (s459 RM-d)', () => {
  test.each(fixture.cases.map(c => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    expect(itemRemovalClause(c.itemRawText)?.clause ?? null).toBe(c.expectItemClause);
    const r = applyComponentSubtraction({
      nutrition: c.winner.nutrition as any, grams: c.winner.grams, foodName: c.winner.foodName, brandName: c.winner.brandName,
      standardSource: c.winner.source, head: c.itemRawText, clause: c.expectItemClause, parsed: c.parsed as any,
    });
    if ('subtracted' in c.expect) {
      expect('adjustments' in r && r.adjustments.map(a => a.component)).toEqual(c.expect.subtracted);
      expect('adjustments' in r && r.nutrition.calories).toBeCloseTo(c.expect.calories as number, 1);
    } else expect('skipped' in r && r.skipped).toBe((c.expect as any).skipped);
  });
  test.each(fixture.detectOnly as [string, string | null][])('detect %s', (line, clause) => {
    expect(itemRemovalClause(line)?.clause ?? null).toBe(clause);
  });
  // The solo strip is NOT widened: `hold the` / `sin` lines are mapped as typed; only billing reads the clause.
  test.each(fixture.detectOnly as [string, string | null][])('solo strip unchanged %s', line => {
    if (/\b(hold the|sin)\b/.test(line)) expect(stripSoloRemoval(line)).toBeNull();
  });
  // A Spanish alias never shadows an English one, and never names a winner (names() reads ALIASES only).
  test('CLAUSE_ALIASES_ES is disjoint from ALIASES', () => {
    expect(Object.keys(CLAUSE_ALIASES_ES).filter(k => k in ALIASES)).toEqual([]);
  });
});

import fixture from './fixtures/bun-build-billing-s459.json';
import { bunBuildClause, itemRemovalClause } from '../negated-part-drop';
import { applyComponentSubtraction } from '../component-subtraction';

// s459 MF-a: a bun-replacing build (`lettuce wrap`, `bunless`, `protein style`) bills as `no bun`. Winners are frozen from cold
// nosave draws (deploy 33) and organic MappingEventLog rows; only the clause feed and the subtraction gate are under test.
type Case = (typeof fixture.cases)[number];
describe('bun-build billing fixture (s459)', () => {
  test.each(fixture.cases.map(c => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    expect(itemRemovalClause(c.itemRawText)?.clause ?? bunBuildClause(c.itemRawText)?.clause ?? null).toBe(c.expectItemClause);
    const r = applyComponentSubtraction({
      nutrition: c.winner.nutrition as any, grams: c.winner.grams, foodName: c.winner.foodName, brandName: c.winner.brandName,
      standardSource: c.winner.source, head: c.itemRawText, clause: c.expectItemClause as string, parsed: c.parsed as any,
    });
    if ('subtracted' in c.expect) {
      expect('adjustments' in r && r.adjustments.map(a => a.component)).toEqual(c.expect.subtracted);
      expect('adjustments' in r && r.nutrition.calories).toBeCloseTo(c.expect.calories as number, 1);
    } else expect('skipped' in r && r.skipped).toBe((c.expect as any).skipped);
  });
  test.each(fixture.detectOnly as [string, string | null][])('detect %s', (line, phrase) => {
    expect(bunBuildClause(line)?.phrase ?? null).toBe(phrase);
  });
});

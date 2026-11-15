import * as fs from 'fs';
import * as path from 'path';
import fixture from './fixtures/removal-billing-s458.json';
import { itemRemovalClause } from '../negated-part-drop';
import { applyComponentSubtraction } from '../component-subtraction';

type Case = (typeof fixture.cases)[number];
describe('removal billing fixture (s458)', () => {
  test.each(fixture.cases.map(c => [c.id, c] as [string, Case]))('%s', (_id, c) => {
    if (!c.soloStripClause) expect(itemRemovalClause(c.itemRawText)?.clause ?? null).toBe(c.expectItemClause);
    const clause = (c.soloStripClause ?? c.expectItemClause) as string;
    const r = applyComponentSubtraction({
      nutrition: c.winner.nutrition as any, grams: c.winner.grams, foodName: c.winner.foodName, brandName: c.winner.brandName,
      standardSource: c.winner.source,
      head: c.itemRawText, clause, parsed: c.parsed as any,
    });
    if ('subtracted' in c.expect) {
      expect('adjustments' in r && r.adjustments.map(a => a.component)).toEqual(c.expect.subtracted);
      expect('adjustments' in r && r.nutrition.calories).toBeCloseTo(c.expect.calories as number, 1);
    } else expect('skipped' in r && r.skipped).toBe((c.expect as any).skipped);
  });
  test.each(fixture.detectOnly as [string, string | null][])('detect %s', (line, clause) => {
    expect(itemRemovalClause(line)?.clause ?? null).toBe(clause);
  });
  // The item grammar's absence words are the admission grammar's (removal-clause.ts F6a): one list, two copies, pinned equal.
  test('ITEM_ABSENCE_WORDS equals removal-clause.ts ABSENCE_WORDS', () => {
    const set = (f: string, name: string) => {
      const m = fs.readFileSync(f, 'utf8').match(new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`));
      if (!m) throw new Error('missing ' + name);
      return Array.from(m[1].matchAll(/'([^']+)'/g)).map(x => x[1]);
    };
    expect(set(path.join(__dirname, '..', 'negated-part-drop.ts'), 'ITEM_ABSENCE_WORDS'))
      .toEqual(set(path.join(__dirname, '..', '..', 'mapping', 'removal-clause.ts'), 'ABSENCE_WORDS'));
  });
});

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatSnapshot } from '../format';
import type { ChainSnapshot } from '../snapshot';

const MENUS = join(__dirname, '..', '..', '..', '..', 'chains', 'menus');
const files = readdirSync(MENUS).filter((f) => f.endsWith('.json')).sort();

function tiny(): ChainSnapshot {
  const panel = { kcal: 100, proteinG: 5, carbsG: 10, fatG: 4, satFatG: null, transFatG: null, cholesterolMg: null, sodiumMg: 50, fiberG: null, sugarG: null, addedSugarG: null };
  return {
    schemaVersion: 1, chain: 'tiny', chainName: 'Tiny', country: 'US', route: 'html-json',
    sources: [{ id: 'b', kind: 'html-json', url: 'u', landingUrl: null, sourceDate: null, generatedAt: null, fetchedAt: '2026-11-16', contentHash: null },
      { id: 'a', kind: 'html-json', url: 'u', landingUrl: null, sourceDate: null, generatedAt: null, fetchedAt: '2026-11-16', contentHash: null }],
    components: [{ key: 'z', name: 'Z', removalKeys: [], portions: [{ label: 'XTRA', grams: null, panel, sourceId: 'a' }, { label: 'EZ', grams: null, panel, sourceId: 'a' }] },
      { key: 'y', name: 'Y', removalKeys: [], portions: [] }],
    items: [{ key: 'm', name: 'M', aliases: [], variant: null, servingG: null, panel, sourceId: 'a', parts: [] },
      { key: 'k', name: 'K', aliases: [], variant: null, servingG: null, panel, sourceId: 'b', parts: [] }],
    spotChecks: [],
  };
}

describe('formatSnapshot', () => {
  it('sorts the four keyed lists by id and every object key, keeps inner list order, ends with one newline', () => {
    const text = formatSnapshot(tiny());
    const back = JSON.parse(text) as ChainSnapshot;
    expect(back.sources.map((s) => s.id)).toEqual(['a', 'b']);
    expect(back.components.map((c) => c.key)).toEqual(['y', 'z']);
    expect(back.items.map((i) => i.key)).toEqual(['k', 'm']);
    expect(back.components[1].portions.map((p) => p.label)).toEqual(['XTRA', 'EZ']);
    expect(Object.keys(back)).toEqual([...Object.keys(back)].sort());
    expect(Object.keys(back.items[0].panel)).toEqual([...Object.keys(back.items[0].panel)].sort());
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('is idempotent', () => {
    const once = formatSnapshot(tiny());
    expect(formatSnapshot(JSON.parse(once) as ChainSnapshot)).toBe(once);
  });

  // "Generated, never hand-edited": every committed snapshot is exactly its own reformat.
  it.each(files)('%s is byte-identical to its formatSnapshot() output', (file) => {
    const text = readFileSync(join(MENUS, file), 'utf8');
    expect(formatSnapshot(JSON.parse(text) as ChainSnapshot)).toBe(text);
  });
});

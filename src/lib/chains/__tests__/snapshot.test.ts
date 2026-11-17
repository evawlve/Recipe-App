import * as fs from 'fs';
import * as path from 'path';
import {
  ChainSnapshot,
  Panel,
  checkAtwater,
  checkChurn,
  checkClosure,
  checkFreshness,
  checkSnapshot,
  checkSpotChecks,
  checkStructure,
  churnFraction,
  newestFetchedAt,
  reportPasses,
  spotCheckKcal,
} from '../snapshot';

const MENU_DIR = path.join(__dirname, '..', '..', '..', '..', 'chains', 'menus');

function loadSnapshot(file: string): ChainSnapshot {
  return JSON.parse(fs.readFileSync(path.join(MENU_DIR, file), 'utf8')) as ChainSnapshot;
}

function panel(kcal: number | null, proteinG: number | null = null, carbsG: number | null = null, fatG: number | null = null): Panel {
  return {
    kcal, proteinG, carbsG, fatG, satFatG: null, transFatG: null,
    cholesterolMg: null, sodiumMg: null, fiberG: null, sugarG: null, addedSugarG: null,
  };
}

/** A small chain that passes every gate: a 400 kcal sandwich of bun (150) + patty (200) + mayo (50). */
function fixture(): ChainSnapshot {
  return {
    schemaVersion: 1,
    chain: 'test-chain',
    chainName: 'Test Chain',
    country: 'US',
    route: 'pdf',
    sources: [{
      id: 'pdf', kind: 'pdf', url: 'https://example.test/n.pdf', landingUrl: null,
      sourceDate: '2026-10-01', generatedAt: null, fetchedAt: '2026-11-16', contentHash: null,
    }],
    components: [
      { key: 'bun', name: 'Bun', removalKeys: ['bun'], portions: [] },
      { key: 'patty', name: 'Patty', removalKeys: ['patty'], portions: [{ label: '1 patty', grams: 80, panel: panel(200, 16, 0, 15), sourceId: 'pdf' }] },
      { key: 'mayo', name: 'Mayo', removalKeys: ['mayo'], portions: [] },
    ],
    items: [{
      key: 'sandwich', name: 'Sandwich', aliases: [], variant: null, servingG: 160, panel: panel(400, 20, 30, 22), sourceId: 'pdf',
      parts: [
        { componentKey: 'bun', portionLabel: null, quantity: null, grams: 60, isDefault: true, kcalPublished: 150, contribution: panel(150), without: null },
        { componentKey: 'patty', portionLabel: '1 patty', quantity: 1, grams: 80, isDefault: true, kcalPublished: 200, contribution: panel(200), without: null },
        { componentKey: 'mayo', portionLabel: null, quantity: null, grams: 7, isDefault: true, kcalPublished: 50, contribution: panel(50), without: panel(350) },
      ],
    }],
    spotChecks: [
      { id: 'no-mayo', itemKey: 'sandwich', removeComponentKeys: ['mayo'], addParts: [], observed: panel(350), observedAt: '2026-11-16', where: 'pdf' },
      { id: 'no-bun-no-mayo', itemKey: 'sandwich', removeComponentKeys: ['bun', 'mayo'], addParts: [], observed: panel(200), observedAt: '2026-11-16', where: 'pdf' },
      {
        id: 'double-patty', itemKey: 'sandwich', removeComponentKeys: [], addParts: [{ componentKey: 'patty', portionLabel: '1 patty', quantity: 1 }],
        observed: panel(600), observedAt: '2026-11-16', where: 'pdf',
      },
    ],
  };
}

const NOW = new Date('2026-11-16T12:00:00Z');

describe('chain snapshot gates', () => {
  it('passes a well-formed fixture on every gate', () => {
    const r = checkSnapshot(fixture(), 'test-chain', NOW);
    expect(r).toEqual({ chain: 'test-chain', structure: [], atwater: [], closure: [], freshness: [], spotChecks: [] });
    expect(reportPasses(r)).toBe(true);
  });

  it('structure: names the file-name mismatch, an unknown source, component and portion', () => {
    const s = fixture();
    s.items[0].parts[0].componentKey = 'ghost';
    s.items[0].parts[1].portionLabel = '2 patties';
    s.items[0].sourceId = 'nowhere';
    expect(checkStructure(s, 'other-chain')).toEqual([
      'chain "test-chain" does not match the file name "other-chain"',
      'item sandwich: unknown source nowhere',
      'item sandwich part ghost: unknown component',
      'item sandwich part patty: unknown portion "2 patties"',
    ]);
  });

  it('structure: a negative panel number fails, null passes, and a contribution may be negative', () => {
    const s = fixture();
    s.items[0].panel.sodiumMg = -1;
    s.items[0].panel.fiberG = null;
    s.items[0].parts[0].contribution = { ...panel(150), fiberG: -1 };
    expect(checkStructure(s, 'test-chain')).toEqual(['item sandwich: sodiumMg is not a finite number >= 0 or null']);
  });

  it('structure: a variant must be alphabetical key=value pairs', () => {
    const s = fixture();
    s.items[0].variant = 'milk=oat;size=medium';
    expect(checkStructure(s, 'test-chain')).toEqual([]);
    s.items[0].variant = 'size=medium;milk=oat';
    expect(checkStructure(s, 'test-chain')).toEqual(['item sandwich: variant "size=medium;milk=oat" keys are not unique and alphabetical']);
    s.items[0].variant = 'medium oat';
    expect(checkStructure(s, 'test-chain')).toEqual(['item sandwich: variant "medium oat" is not key=value;key=value']);
  });

  it('structure: a build with no item must add parts and remove none', () => {
    const s = fixture();
    s.spotChecks[2].itemKey = null;
    s.spotChecks[2].removeComponentKeys = ['mayo'];
    expect(checkStructure(s, 'test-chain')).toEqual(['spot check double-patty: a build with no item must add parts and remove none']);
  });

  it('structure failures stop the other gates', () => {
    const r = checkSnapshot({ ...fixture(), schemaVersion: 2 }, 'test-chain', NOW);
    expect(r.structure).toEqual(['schemaVersion 2 is not 1']);
    expect(reportPasses(r)).toBe(false);
  });

  it('atwater: flags an item panel whose kcal disagrees with its macros, skips a null macro and an exempt row', () => {
    const s = fixture();
    s.items[0].panel = panel(400, 40, 60, 30); // 4*40 + 4*60 + 9*30 = 670
    expect(checkAtwater(s)).toEqual(['item sandwich: kcal 400 vs 4P+4C+9F 670 (tolerance 60)']);
    s.items[0].atwaterExempt = 'sugar alcohols';
    expect(checkAtwater(s)).toEqual([]);
    s.items[0].atwaterExempt = undefined;
    s.items[0].panel.fatG = null;
    expect(checkAtwater(s)).toEqual([]);
  });

  it('atwater: checks component portions too', () => {
    const s = fixture();
    s.components[1].portions[0].panel = panel(200, 50, 0, 15); // 335
    expect(checkAtwater(s)).toEqual(['component patty portion "1 patty": kcal 200 vs 4P+4C+9F 335 (tolerance 30)']);
  });

  it('closure: flags default parts that do not sum to the item, and skips an item with an unknown part', () => {
    const s = fixture();
    s.items[0].parts[2].contribution = panel(120);
    expect(checkClosure(s)).toEqual(['item sandwich: default parts sum to 470 kcal vs item 400 (tolerance 20)']);
    s.items[0].parts[2].contribution = null;
    expect(checkClosure(s)).toEqual([]);
  });

  it('freshness: a source over 365 days old is stale; an undated source reads fetchedAt', () => {
    const s = fixture();
    s.sources[0].sourceDate = '2025-07-01';
    expect(checkFreshness(s, NOW)).toEqual(['source pdf: dated 2025-07-01, 504 days old (max 365)']);
    s.sources[0].sourceDate = null;
    expect(checkFreshness(s, NOW)).toEqual([]);
  });

  it('freshness: CI measures age at collection time, so a stale source cannot be committed', () => {
    const s = fixture();
    expect(newestFetchedAt(s).toISOString()).toBe('2026-11-16T00:00:00.000Z');
    s.sources[0].sourceDate = '2024-07-22';
    expect(checkFreshness(s, newestFetchedAt(s))).toEqual(['source pdf: dated 2024-07-22, 847 days old (max 365)']);
  });

  it('spot checks: need three, and a build off by more than 10 kcal fails', () => {
    const s = fixture();
    s.spotChecks[1].observed = panel(220);
    expect(checkSpotChecks(s)).toEqual(['spot check no-bun-no-mayo: computed 200 kcal vs observed 220']);
    s.spotChecks = s.spotChecks.slice(0, 2);
    expect(checkSpotChecks(s)[0]).toBe('2 spot checks (min 3)');
  });

  it('spot checks: added portions count kcal x quantity, with or without an item', () => {
    const s = fixture();
    expect(spotCheckKcal(s, s.spotChecks[2])).toBe(600);
    expect(spotCheckKcal(s, { ...s.spotChecks[2], itemKey: null, addParts: [{ componentKey: 'patty', portionLabel: '1 patty', quantity: 2 }] })).toBe(400);
  });

  it('spot checks: a build the snapshot cannot compute fails, never skips', () => {
    const s = fixture();
    s.items[0].parts[0].contribution = null;
    s.components[1].portions[0].panel.kcal = null;
    expect(checkSpotChecks(s)).toEqual([
      'spot check no-bun-no-mayo: the snapshot cannot compute this build',
      'spot check double-patty: the snapshot cannot compute this build',
    ]);
  });

  it('churn: identical snapshots move 0 whatever the key order; changing one of four rows moves 25% and fails', () => {
    const a = fixture();
    const reordered = fixture();
    reordered.items[0] = Object.fromEntries(Object.entries(reordered.items[0]).reverse()) as typeof reordered.items[0];
    expect(churnFraction(a, reordered)).toBe(0);
    expect(checkChurn(a, fixture())).toEqual([]);
    const b = fixture();
    b.items[0].panel.kcal = 410;
    expect(churnFraction(a, b)).toBe(0.25);
    expect(checkChurn(a, b)).toEqual(['25% of rows moved (max 20%): treat the collector as broken']);
  });
});

describe('committed menus (chains/menus/*.json)', () => {
  const files = fs.readdirSync(MENU_DIR).filter((f) => f.endsWith('.json')).sort();

  it('the directory holds at least the McDonald\'s snapshot', () => {
    expect(files).toContain('mcdonalds-us.json');
  });

  // Freshness is measured at the snapshot's own newest fetchedAt, never the clock: CI must not go red on a date.
  it.each(files)('%s passes every gate', (file) => {
    const snap = loadSnapshot(file);
    const r = checkSnapshot(snap, file.replace(/\.json$/, ''), newestFetchedAt(snap));
    expect(r).toEqual({ chain: file.replace(/\.json$/, ''), structure: [], atwater: [], closure: [], freshness: [], spotChecks: [] });
  });

  it('mcdonalds-us holds the 8 items, 20 components and 51 parts collected on 2026-11-14', () => {
    const s = loadSnapshot('mcdonalds-us.json');
    expect([s.items.length, s.components.length, s.items.reduce((n, i) => n + i.parts.length, 0)]).toEqual([8, 20, 51]);
  });

  it('mcdonalds-us reproduces the three live-calculator builds of 2026-11-14', () => {
    const s = loadSnapshot('mcdonalds-us.json');
    expect(s.spotChecks.map((sc) => [sc.id, spotCheckKcal(s, sc)])).toEqual([
      ['mcchicken-no-mayo', 290],
      ['big-mac-no-sauce', 440],
      ['qpc-no-cheese', 420],
    ]);
  });
});

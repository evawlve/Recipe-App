import { assembleSnapshot, sha256 } from '../lib/adapter';
import type { ChainAdapter, FetchManifest } from '../lib/adapter';
import { CHAIN_FETCH_GAP_MS, CHAIN_USER_AGENT, FetchRefused, politeFetch } from '../lib/polite-fetch';
import { fdaRound } from '../lib/fda-round';
import { cellText, num, slugify } from '../lib/text';

const body = Buffer.from('<p>hello</p>');
const adapter: ChainAdapter = {
  chain: 'tiny', chainName: 'Tiny', country: 'US', route: 'html-table',
  sources: [{ id: 'page', kind: 'html-table', url: 'https://example.test/n', landingUrl: null, file: 'page.html' }],
  sourceDate: () => '2026-02-01',
  parse: () => ({ items: [], components: [] }),
  spotChecks: [],
};
const manifest = (over: Partial<FetchManifest['records'][number]> = {}): FetchManifest => ({
  chain: 'tiny',
  records: [{ id: 'page', url: 'https://example.test/n', file: 'page.html', status: 200, bytes: body.length, sha256: sha256(body), fetchedAt: '2026-11-16T03:00:00.000Z', ...over }],
});

describe('assembleSnapshot', () => {
  it('fills each source from the manifest: hash, fetch date, printed date', () => {
    const s = assembleSnapshot(adapter, manifest(), { page: body });
    expect(s.sources).toEqual([{ id: 'page', kind: 'html-table', url: 'https://example.test/n', landingUrl: null, sourceDate: '2026-02-01', generatedAt: null, fetchedAt: '2026-11-16', contentHash: sha256(body) }]);
  });
  it('takes generatedAt from the optional hook, and writes null when the adapter has none', () => {
    const withHook: ChainAdapter = { ...adapter, generatedAt: () => '2026-11-06' };
    expect(assembleSnapshot(withHook, manifest(), { page: body }).sources[0].generatedAt).toBe('2026-11-06');
    expect(assembleSnapshot(adapter, manifest(), { page: body }).sources[0].generatedAt).toBeNull();
  });
  it('refuses a body whose bytes do not match the manifest', () => {
    expect(() => assembleSnapshot(adapter, manifest(), { page: Buffer.from('changed') })).toThrow(/does not match/);
  });
  it('refuses a non-200 record, a missing record and a manifest for another chain', () => {
    expect(() => assembleSnapshot(adapter, manifest({ status: 403 }), { page: body })).toThrow(/HTTP 403/);
    expect(() => assembleSnapshot(adapter, { chain: 'tiny', records: [] }, { page: body })).toThrow(/not in the fetch manifest/);
    expect(() => assembleSnapshot(adapter, { ...manifest(), chain: 'other' }, { page: body })).toThrow(/manifest is for/);
  });
});

describe('politeFetch', () => {
  const specs = [0, 1, 2].map((i) => ({ id: `s${i}`, kind: 'html-table' as const, url: `https://example.test/${i}`, landingUrl: null, file: `s${i}.html` }));
  function deps(statuses: number[]) {
    const calls: string[] = [];
    const sleeps: number[] = [];
    const saved: string[] = [];
    let n = 0;
    return {
      calls, sleeps, saved,
      d: {
        fetch: async (url: string, init: { headers: Record<string, string>; redirect: 'manual'; signal: AbortSignal }) => {
          calls.push(`${url} ${init.redirect} ${init.headers['User-Agent']}`);
          const status = statuses[n++];
          return { status, arrayBuffer: async () => new TextEncoder().encode(`b${n}`).buffer as ArrayBuffer };
        },
        sleep: async (ms: number) => { sleeps.push(ms); },
        now: () => new Date('2026-11-16T03:00:00Z'),
        save: (file: string) => { saved.push(file); },
      },
    };
  }
  it('fetches in order, sleeps the gap between requests only, sends the generic agent', async () => {
    const t = deps([200, 200, 200]);
    const m = await politeFetch('tiny', specs, t.d);
    expect(m.records.map((r) => r.id)).toEqual(['s0', 's1', 's2']);
    expect(t.sleeps).toEqual([CHAIN_FETCH_GAP_MS, CHAIN_FETCH_GAP_MS]);
    expect(t.calls.every((c) => c.endsWith(`manual ${CHAIN_USER_AGENT}`))).toBe(true);
    expect(CHAIN_USER_AGENT).not.toMatch(/@/);
  });
  it('stops at the first non-200 (a wall, or a redirect it does not follow) and saves nothing for it', async () => {
    const t = deps([200, 301, 200]);
    await expect(politeFetch('tiny', specs, t.d)).rejects.toBeInstanceOf(FetchRefused);
    expect(t.saved).toEqual(['s0.html']);
    expect(t.calls).toHaveLength(2);
  });
  it('refuses more sources than the request budget before sending any', async () => {
    const t = deps([]);
    const many = Array.from({ length: 9 }, (_, i) => ({ ...specs[0], id: `m${i}` }));
    await expect(politeFetch('tiny', many, t.d)).rejects.toThrow(/request budget/);
    expect(t.calls).toHaveLength(0);
  });
});

describe('text helpers', () => {
  it('num: published numbers only; never a guess', () => {
    expect([num('1,250'), num('12g'), num('480 mg'), num('0'), num('<1'), num('<1', { lessThanAs: 0 }), num('120-240'), num(''), num('-'), num('N/A')])
      .toEqual([1250, 12, 480, 0, null, 0, null, null, null, null]);
  });
  it('cellText and slugify', () => {
    expect(cellText('<td>Chick-n-Strips&reg;<br>(3&nbsp;ct)</td>')).toBe('Chick-n-Strips® (3 ct)');
    expect(slugify('Chick-n-Strips® (3 ct)')).toBe('chick-n-strips-3-ct');
    expect(slugify('Mac & Cheese')).toBe('mac-and-cheese');
    expect(slugify('Chick-n-Strips™ (3 ct)')).toBe('chick-n-strips-3-ct');
    expect(slugify('Café Piña')).toBe('cafe-pina');
  });
});

describe('fdaRound', () => {
  it('kcal: under 5 is 0, to 50 nearest 5, above nearest 10', () => {
    expect([4.9, 5, 50, 51, 55, 1089.079].map((v) => fdaRound('kcal', v))).toEqual([0, 5, 50, 50, 60, 1090]);
  });
  it('fat: under 0.5 is 0, under 5 nearest 0.5, above nearest 1', () => {
    expect([0.49, 1.404, 4.9, 61.343].map((v) => fdaRound('fat', v))).toEqual([0, 1.5, 5, 61]);
  });
  it('chol: under 2 is 0, to 5 is null (less than 5 mg), above nearest 5', () => {
    expect([1.9, 3, 5, 84.8].map((v) => fdaRound('chol', v))).toEqual([0, null, null, 85]);
  });
  it('sodium: under 5 is 0, to 140 nearest 5, above nearest 10', () => {
    expect([4, 140, 2048].map((v) => fdaRound('sodium', v))).toEqual([0, 140, 2050]);
  });
  it('gram: under 0.5 is 0, under 1 is null (less than 1 g), above nearest 1', () => {
    expect([0.49, 0.7, 7.937].map((v) => fdaRound('gram', v))).toEqual([0, null, 8]);
  });
  it('fdaRound: an exact tie goes to the even multiple (84.5 -> 84)', () => {
    expect(fdaRound('gram', 84.5)).toBe(84);
  });
  it('an odd-floor tie goes up, and a bad value throws', () => {
    expect(fdaRound('gram', 85.5)).toBe(86);
    expect(() => fdaRound('kcal', -1)).toThrow(/not a non-negative number/);
    expect(() => fdaRound('kcal', NaN)).toThrow(/not a non-negative number/);
  });
});

/**
 * The client-facing provenance whitelist. See src/lib/attribution.ts for why this is a legal
 * boundary rather than a formatting helper: the mobile client renders FatSecret's licensed
 * Web Badge directly off the `source` string this backend emits.
 */
import { toClientSource, toWireSource, CLIENT_SOURCES } from '../attribution';

/**
 * Inherited Object.prototype keys. `ALIASES[raw]` used to resolve up the prototype chain and
 * `?? null` does not catch a truthy inherited value, so `'constructor'` escaped as the Object
 * FUNCTION and `'__proto__'` as `Object.prototype`.
 *
 * Only these two matter, and the reason is worth keeping: `.toLowerCase()` accidentally
 * neutralises every camelCase prototype key (`toString` → `tostring`, which misses). That is
 * a coincidence, not a defence — the list is here in full so a future change to the
 * normalisation cannot quietly re-open the others.
 */
const PROTOTYPE_KEYS = [
  'constructor',
  '__proto__',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  'toLocaleString',
];

describe('toClientSource', () => {
  test.each([
    ['fatsecret', 'fatsecret'],
    ['fdc', 'fdc'],
    ['usda', 'fdc'],
    ['openfoodfacts', 'openfoodfacts'],
    ['off', 'openfoodfacts'],
    ['ai_estimated', 'ai_estimated'],
    ['ai_generated', 'ai_estimated'],
  ])('passes the known provider %s through as %s', (input, expected) => {
    expect(toClientSource(input)).toBe(expected);
  });

  test.each([
    'template',      // the live legacy Food table
    'verified',      // the live legacy Food table
    'fatsecret-cache', // an AiGeneratedFood branch — must NOT become 'fatsecret'
    'cache',
    'early_cache',
    'full_pipeline',
    'ai',
    'history',
    'unknown',
    '',
    '   ',
  ])('makes no provider claim for %s', (input) => {
    expect(toClientSource(input)).toBeNull();
  });

  test('never lets an unrecognised value reach the client as a provider', () => {
    // The assertion that dies if the whitelist becomes a passthrough.
    const escapes = ['template', 'verified', 'fatsecret-cache', 'history', 'cache']
      .map(toClientSource)
      .filter(v => v !== null);
    expect(escapes).toEqual([]);
  });

  test('normalizes case and surrounding whitespace', () => {
    expect(toClientSource('  FatSecret ')).toBe('fatsecret');
    expect(toClientSource('USDA')).toBe('fdc');
    expect(toClientSource('OFF')).toBe('openfoodfacts');
  });

  test.each([null, undefined, 0, 1, NaN, true, false, [], {}, ['fatsecret'], () => 'fatsecret'])(
    'returns null for the non-string %p rather than throwing',
    (input) => {
      expect(toClientSource(input as unknown)).toBeNull();
    },
  );

  test('only ever emits a member of CLIENT_SOURCES, or null', () => {
    // The prototype keys are the point. Without them this fixture is too well-behaved to
    // fail: it passed while `toClientSource('constructor')` was returning a function.
    const inputs = ['fatsecret', 'usda', 'off', 'template', 'zzz', '', null, 42, ...PROTOTYPE_KEYS];
    for (const i of inputs) {
      const out = toClientSource(i as unknown);
      if (out !== null) expect(CLIENT_SOURCES).toContain(out);
    }
  });

  test.each(PROTOTYPE_KEYS)('makes no provider claim for the inherited key %s', (key) => {
    expect(toClientSource(key)).toBeNull();
  });

  test('an inherited key never yields a non-string', () => {
    // The failure had two shapes: a function (silently dropped by JSON.stringify, so the
    // field vanishes) and an object (serialised as `"source": {}`, which breaks any client
    // doing source.toLowerCase()). Assert on the TYPE, not just on inequality.
    for (const key of PROTOTYPE_KEYS) {
      const out = toClientSource(key);
      expect(out === null || typeof out === 'string').toBe(true);
      expect(JSON.parse(JSON.stringify({ source: out }))).toEqual({ source: null });
    }
  });
});

describe('toWireSource', () => {
  test.each([
    ['fatsecret', 'fatsecret'],
    ['openfoodfacts', 'off'],
    ['off', 'off'],
    ['fdc', 'usda'],
    ['usda', 'usda'],
    ['ai_estimated', 'ai_estimated'],
    ['ai_generated', 'ai_estimated'],
  ])('maps %s onto the legacy wire spelling %s', (input, expected) => {
    expect(toWireSource(input)).toBe(expected);
  });

  test('preserves the spellings this lane has always sent', () => {
    // Changing these is a wire change for every consumer. `runLocalSearch` is the path all
    // three mobile search call sites take (`local=true`), so a rename lands on real users.
    expect(toWireSource('openfoodfacts')).toBe('off');
    expect(toWireSource('fdc')).toBe('usda');
  });

  test.each(['template', 'verified', 'fatsecret-cache', 'history', 'cache', 'community', ...PROTOTYPE_KEYS])(
    'makes no provider claim for %s',
    (input) => {
      expect(toWireSource(input)).toBeNull();
    },
  );

  test.each([null, undefined, 0, NaN, true, [], {}, () => 'off'])(
    'returns null for the non-string %p rather than throwing',
    (input) => {
      expect(toWireSource(input as unknown)).toBeNull();
    },
  );

  test('agrees with toClientSource on what is claimable at all', () => {
    // The two must never disagree about WHETHER a value is a provider — only about spelling.
    const inputs = ['fatsecret', 'off', 'usda', 'openfoodfacts', 'fdc', 'ai_generated',
      'template', 'fatsecret-cache', '', 'zzz', ...PROTOTYPE_KEYS];
    for (const i of inputs) {
      expect(toWireSource(i) === null).toBe(toClientSource(i) === null);
    }
  });
});

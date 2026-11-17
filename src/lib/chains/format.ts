/**
 * The one way a chain-menu snapshot is written to disk (chain row 2, 2026-11-16).
 *
 * Every `chains/menus/<chain>.json` is the output of `formatSnapshot()`: object keys sorted at every depth, the four
 * keyed lists (sources, components, items, spotChecks) sorted by their id, two-space indent, one trailing newline. So
 * a monthly refresh's git diff shows only what changed on the menu, never a reordering of the chain's own page, and
 * two collectors that build the same snapshot write the same bytes. `src/lib/chains/__tests__/format.test.ts` fails
 * any committed file that is not byte-identical to its own reformat, which is how "snapshots are generated, never
 * hand-edited" is checked. Lists inside an item or component (parts, portions, aliases, removal keys) keep the order
 * the collector emitted: a portion ladder (EZ / REG / XTRA) reads in its own order.
 */
import type { ChainSnapshot } from './snapshot';

function byField<T>(field: keyof T) {
  return (a: T, b: T): number => {
    const x = String(a[field]);
    const y = String(b[field]);
    return x < y ? -1 : x > y ? 1 : 0;
  };
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeysDeep(obj[k]);
    return out;
  }
  return value;
}

/** The snapshot with its four keyed lists sorted by id; nothing else changes. */
export function sortSnapshotLists(snap: ChainSnapshot): ChainSnapshot {
  return {
    ...snap,
    sources: [...snap.sources].sort(byField('id')),
    components: [...snap.components].sort(byField('key')),
    items: [...snap.items].sort(byField('key')),
    spotChecks: [...snap.spotChecks].sort(byField('id')),
  };
}

export function formatSnapshot(snap: ChainSnapshot): string {
  return `${JSON.stringify(sortKeysDeep(sortSnapshotLists(snap)), null, 2)}\n`;
}

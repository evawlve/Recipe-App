/**
 * Every curl-collected chain's adapter, by chain slug. A chain collected by a Chrome pass (McDonald's) has no entry:
 * its JSON is written by that pass and normalised with `format-snapshot.ts`.
 */
import type { ChainAdapter } from '../lib/adapter';
import chickFilA from './chick-fil-a-us';

export const ADAPTERS: Record<string, ChainAdapter> = {
  [chickFilA.chain]: chickFilA,
};

/**
 * Every curl-collected chain's adapter, by chain slug. A chain collected by a Chrome pass (McDonald's) has no entry:
 * its JSON is written by that pass and normalised with `format-snapshot.ts`.
 */
import type { ChainAdapter } from '../lib/adapter';
import chickFilA from './chick-fil-a-us';
import firstWatch from './first-watch-us';
import slimChickens from './slim-chickens-us';

export const ADAPTERS: Record<string, ChainAdapter> = {
  [chickFilA.chain]: chickFilA,
  [firstWatch.chain]: firstWatch,
  [slimChickens.chain]: slimChickens,
};

/**
 * Every curl-collected chain's adapter, by chain slug. A chain collected by a Chrome pass (McDonald's) has no entry:
 * its JSON is written by that pass and normalised with `format-snapshot.ts`.
 */
import type { ChainAdapter } from '../lib/adapter';
import applebees from './applebees-us';
import chickFilA from './chick-fil-a-us';
import chilis from './chilis-us';
import firstWatch from './first-watch-us';
import slimChickens from './slim-chickens-us';
import tacoJohns from './taco-johns-us';

export const ADAPTERS: Record<string, ChainAdapter> = {
  [applebees.chain]: applebees,
  [chickFilA.chain]: chickFilA,
  [chilis.chain]: chilis,
  [firstWatch.chain]: firstWatch,
  [slimChickens.chain]: slimChickens,
  [tacoJohns.chain]: tacoJohns,
};

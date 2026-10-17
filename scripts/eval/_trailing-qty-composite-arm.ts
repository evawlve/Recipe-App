/**
 * _trailing-qty-composite-arm.ts - composite-tuple arm for the trailing-quantity fold (S192 row 2).
 *
 * Maps every pinned item through the SHIPPED mapIngredientWithFallback() with the exact option shape
 * buildParsedItem() uses in src/app/api/nlp/parse/route.ts, plus skipCache + skipSave. Run it on a
 * base pin (twice, for the noise floor) and on a folded pin (once) produced by
 * _trailing-qty-replay.ts --pin-out [--folded].
 *
 * READ-ONLY by construction: installWriteGuard() turns every mutating Prisma action into a counted
 * no-op, and assertWriteGuardIntercepts() refuses to run unless a no-op UPDATE through $queryRaw
 * moves the tally by exactly one. Both run BEFORE the mapper is loaded.
 *
 * Usage (a worktree, env from the shell, ts-node - never tsx):
 *   set -a; . ./.env; set +a
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_trailing-qty-composite-arm.ts --pin <pin.json> --out <rows.jsonl>
 * `--dry` prints each call's options and loads no DB.
 *
 * NOTE: the worktree's .env can point at PRODUCTION. Only the seat runs the live arm.
 */

import * as fs from 'fs';
import { installWriteGuard, assertWriteGuardIntercepts, WRITE_GUARD_SELF_TEST_KEY } from './winner-diff-write-guard';

interface PinnedItem { rawText: string; normalizedForm: string | null; brand: string | null }
interface PinFile { createdAt: string; seedsPath: string; lines: Array<{ line: string; items: PinnedItem[] }> }

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const pinPath = arg('--pin');
  const outPath = arg('--out');
  const dry = process.argv.includes('--dry');
  if (!pinPath || (!outPath && !dry)) {
    console.error('usage: --pin <pin.json> --out <rows.jsonl> [--dry]');
    process.exit(2);
  }
  const pin: PinFile = JSON.parse(fs.readFileSync(pinPath, 'utf8'));

  const tally: Record<string, number> = {};
  let mapper: any = null;
  if (!dry) {
    const { prisma } = require('@/lib/db');
    installWriteGuard(prisma, (k: string) => { tally[k] = (tally[k] ?? 0) + 1; });
    await assertWriteGuardIntercepts(prisma, () => tally[WRITE_GUARD_SELF_TEST_KEY] ?? 0);
    mapper = require('@/lib/mapping/map-ingredient-with-fallback');
  }

  const rows: string[] = [];
  for (let li = 0; li < pin.lines.length; li++) {
    const L = pin.lines[li];
    for (let ii = 0; ii < L.items.length; ii++) {
      const it = L.items[ii];
      const options = {
        brand: it.brand || undefined,
        normalizedForm: it.normalizedForm || undefined,
        skipCache: true,
        skipSave: true,
      };
      const row: Record<string, unknown> = {
        lineIdx: li, itemIdx: ii, line: L.line, rawText: it.rawText,
        pinnedForm: it.normalizedForm, pinnedBrand: it.brand,
        foodId: null, foodName: null, brandName: null, grams: null, kcal: null, servingTier: null,
      };
      if (dry) {
        console.warn(`[${li}.${ii}] map(${JSON.stringify(it.rawText)}, ${JSON.stringify(options)})`);
        rows.push(JSON.stringify(row));
        continue;
      }
      try {
        const mapped = await mapper.mapIngredientWithFallback(it.rawText, options);
        if (mapped && !('status' in mapped)) {
          row.foodId = String(mapped.foodId ?? '') || null;
          row.foodName = mapped.foodName ?? null;
          row.brandName = mapped.brandName ?? null;
          row.grams = mapped.grams ?? null;
          row.kcal = mapped.calories ?? mapped.kcal ?? null;
          row.servingTier = mapped.servingTier ?? null;
        } else {
          row.error = `unmapped:${mapped?.status ?? 'null'}`;
        }
      } catch (e) {
        row.error = e instanceof Error ? e.message : String(e);
      }
      rows.push(JSON.stringify(row));
    }
  }

  if (outPath) fs.writeFileSync(outPath, rows.join('\n') + '\n');
  console.warn(`rows=${rows.length} suppressedWrites=${JSON.stringify(tally)}`);
}

main().catch(e => { console.error(e); process.exit(1); });

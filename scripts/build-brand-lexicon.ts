/**
 * build-brand-lexicon.ts — generate src/lib/mapping/brand-lexicon.json
 *
 * A build-time SQL lexicon of real brand names, derived from the OFF corpus by
 * frequency. Replaces the need for an ML "is this branded?" classifier: a brand
 * that appears on >= MIN_PRODUCTS distinct products is, empirically, a brand.
 *
 * The lexicon feeds brand DETECTION (brand-detector.ts) and the normalize gate
 * (normalize-gate.ts), so precision matters more than recall — a generic food
 * word wrongly admitted here would make every plain query look "branded". Hence
 * the STOPLIST + numeric/length guards below.
 *
 * Run (from repo root, DB must be reachable):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/build-brand-lexicon.ts [--min 50]
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const MIN_PRODUCTS = parseInt(argValue('--min') ?? '50', 10);

// Generic food words / descriptors that appear as OFF "brands" but must never be
// treated as brand signals (they would flag ordinary queries as branded).
const STOPLIST = new Set<string>([
    'milk', 'water', 'juice', 'bread', 'cheese', 'yogurt', 'yoghurt', 'butter',
    'oil', 'sugar', 'salt', 'flour', 'rice', 'pasta', 'honey', 'coffee', 'tea',
    'chocolate', 'cocoa', 'organic', 'natural', 'classic', 'original', 'fresh',
    'premium', 'gourmet', 'deluxe', 'value', 'basics', 'essentials', 'select',
    'choice', 'quality', 'brand', 'foods', 'food', 'company', 'inc', 'ltd', 'llc',
    'co', 'the', 'and', 'for', 'with', 'plus', 'gold', 'pure', 'real', 'home',
    'farm', 'farms', 'market', 'markets', 'grocery', 'store', 'super', 'family',
    'daily', 'good', 'best', 'great', 'nice', 'simply', 'simple', 'whole',
    'light', 'lite', 'diet', 'zero', 'free', 'low', 'raw', 'bio', 'eco', 'vegan',
    'vegetarian', 'gluten', 'protein', 'energy', 'sport', 'sports', 'nutrition',
    'snack', 'snacks', 'drink', 'drinks', 'beverage', 'beverages', 'cereal',
    'cereals', 'meat', 'meats', 'fruit', 'fruits', 'vegetable', 'vegetables',
    'nuts', 'beans', 'soup', 'sauce', 'spice', 'spices', 'blend', 'mix',
    'unknown', 'none', 'other', 'assorted', 'various', 'generic', 'private label',
    'n/a', 'na', 'null', 'nil', 'n.a.', 'tbd', 'various brands',
]);

function isPlausibleBrand(brand: string): boolean {
    if (brand.length < 3) return false;                 // too short to disambiguate
    if (/^\d+$/.test(brand)) return false;              // purely numeric
    if (!/[a-z]/.test(brand)) return false;             // no letters
    if (STOPLIST.has(brand)) return false;              // generic food/descriptor word
    return true;
}

async function main() {
    console.log(`Building brand lexicon (>= ${MIN_PRODUCTS} products per brand)...`);

    const rows = await prisma.$queryRaw<Array<{ brand: string; n: bigint }>>`
        SELECT lower(trim("brandName")) AS brand, COUNT(*) AS n
        FROM "OffFood"
        WHERE "brandName" IS NOT NULL AND length(trim("brandName")) >= 3
        GROUP BY lower(trim("brandName"))
        HAVING COUNT(*) >= ${MIN_PRODUCTS}
        ORDER BY COUNT(*) DESC
    `;

    console.log(`  ${rows.length} brands cleared the >=${MIN_PRODUCTS} frequency floor.`);

    const kept: string[] = [];
    let droppedStop = 0;
    for (const r of rows) {
        const brand = r.brand.trim();
        if (isPlausibleBrand(brand)) kept.push(brand);
        else droppedStop++;
    }
    // Dedupe + stable sort (alphabetical for a clean diff).
    const lexicon = Array.from(new Set(kept)).sort();

    console.log(`  ${droppedStop} dropped by stoplist/quality guards.`);
    console.log(`  ${lexicon.length} brands in final lexicon.`);
    console.log(`  ghost present: ${lexicon.includes('ghost')}`);

    const outPath = path.join(__dirname, '..', 'src', 'lib', 'mapping', 'brand-lexicon.json');
    fs.writeFileSync(outPath, JSON.stringify(lexicon, null, 0) + '\n');
    console.log(`Wrote ${path.relative(path.join(__dirname, '..'), outPath)} (${lexicon.length} entries).`);

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
});

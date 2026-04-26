/**
 * saturate-cache-from-usda.ts — Phase 6 Cache Warmup via USDA SR Legacy
 *
 * Strategy:
 *   1. Load USDA SR Legacy (and Foundation Foods if present) JSON files
 *   2. Parse each food description into a natural-English ingredient string
 *      (e.g. "Beef, ground, 85% lean meat / 15% fat, raw" → "85% lean ground beef")
 *   3. Normalize → canonicalize → deduplicate
 *   4. Skip anything already in ValidatedMapping
 *   5. Run remaining terms through mapIngredientWithFallback (the full live pipeline)
 *   6. Resumable: state tracked in logs/usda-warmup-state.json
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/saturate-cache-from-usda.ts
 *   npx ts-node ... scripts/saturate-cache-from-usda.ts --dry-run        # show terms without API calls
 *   npx ts-node ... scripts/saturate-cache-from-usda.ts --concurrency=5  # default 3
 *   npx ts-node ... scripts/saturate-cache-from-usda.ts --limit=200      # process at most N terms
 *   npx ts-node ... scripts/saturate-cache-from-usda.ts --reset          # ignore previous state, restart
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { normalizeIngredientName, canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const prisma = new PrismaClient();

// ─── Config ──────────────────────────────────────────────────────────────────

const USDA_FILES = [
    'data/usda/FoodData_Central_sr_legacy_food_json_2018-04.json',
    'data/usda/FoodData_Central_foundation_food_json_2025-04-24.json',
];

// Categories that produce no useful recipe ingredients
const SKIP_CATEGORIES = new Set([
    'Baby Foods',
    'Restaurant Foods',
    'Infant Formulas',
    'Meals, Entrees, and Side Dishes',
    'Fast Foods',
    'American Indian/Alaska Native Foods',
]);

// Subcategory description terms that indicate non-recipe USDA entries
const SKIP_DESC_PATTERNS = [
    /\b(applebee'?s?|mcdonald|burger king|wendy|kfc|subway|taco bell|denny|chick-fil-a|pizza hut|domino|olive garden)\b/i,
    /\bindustrial\b/i,
    /\b(infant|toddler|baby|enfamil|similac|nutramigen)\b/i,
    /\bformul(a|ated bar)\b/i,
    /\bby-products\b/i,
    /\bseam fat only\b/i,
    /\bvariety meats\b/i,
    // Very specific sub-cuts we don't need (these produce MSM normalizations)
    /separable lean (and fat|only), trimmed to/i,
    /\b(braised|casseroled|stewed), (boneless|bone-in)\b/i,
];

// After description parsing: terms we should not send to the pipeline
const SKIP_NORMALIZED_TERMS = new Set([
    '', 'water', 'ice', 'air', 'salt water', 'brine', 'tap water',
]);

// Minimum characters for a normalized term to be worth an API call
const MIN_TERM_LENGTH = 3;

// State file for resumability
const STATE_FILE = path.join(__dirname, '..', 'logs', 'usda-warmup-state.json');
const LOG_FILE   = path.join(__dirname, '..', 'logs', `usda-warmup-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);

// ─── USDA Description → Natural English Parser ───────────────────────────────
//
// SR Legacy descriptions use a structured comma-separated format:
//   "Category, subcategory, qualifier1, qualifier2, state"
// e.g.:
//   "Beef, ground, 85% lean meat / 15% fat, raw"       → "85% lean ground beef"
//   "Spices, pepper, black"                             → "black pepper"
//   "Oil, olive, salad or cooking"                      → "olive oil"
//   "Milk, whole, 3.25% milkfat, with added vitamin D" → "whole milk"
//   "Chicken, broilers or fryers, breast, meat only, raw" → "chicken breast"
//   "Nuts, almonds"                                     → "almonds"

// Words that are too generic to form a useful ingredient query on their own
const GENERIC_CATEGORY_WORDS = new Set([
    'salad dressing', 'spices', 'oil', 'oils', 'fat', 'fats', 'beverages',
    'beverage', 'cereals', 'cereal', 'snacks', 'snack', 'nuts', 'seeds',
    'fruit', 'fruits', 'vegetables', 'vegetable', 'fish', 'meat', 'meats',
    'legumes', 'legume', 'dairy', 'eggs', 'soup', 'soups', 'sauce', 'sauces',
    'products', 'food', 'foods', 'grains', 'grain',
]);

// Max words in the constructed ingredient term — longer = likely noisy
const MAX_TERM_WORDS = 5;

// Category priority — higher number = processed first.
// Columns that hit the FatSecret API most productively should be first.
const CATEGORY_PRIORITY: Record<string, number> = {
    'Vegetables and Vegetable Products': 100,
    'Fruits and Fruit Juices': 90,
    'Dairy and Egg Products': 85,
    'Poultry Products': 80,
    'Finfish and Shellfish Products': 75,
    'Beef Products': 70,
    'Pork Products': 70,
    'Lamb, Veal, and Game Products': 65,
    'Legumes and Legume Products': 80,
    'Cereal Grains and Pasta': 75,
    'Nut and Seed Products': 70,
    'Spices and Herbs': 80,
    'Fats and Oils': 60,
    'Soups, Sauces, and Gravies': 50,
    'Beverages': 40,
    'Breakfast Cereals': 40,
    'Sausages and Luncheon Meats': 35,
    'Baked Products': 30,
    'Sweets': 20,
    'Snacks': 10,
};

// Words from qualifiers that should be stripped from the constructed term
// (context: these add no disambiguation value for FatSecret search)
const STRIP_QUALIFIER_WORDS = new Set([
    'raw', 'cooked', 'prepared', 'unprepared', 'dried', 'fresh', 'frozen',
    'thawed', 'unthawed', 'drained', 'ns', 'nfs', 'all grades', 'all types',
    'choice', 'prime', 'select', 'grade a', 'commercial',
    'salad or cooking', 'for frying', 'for baking', 'for deep frying',
    'with salt', 'without salt', 'unsalted', 'with added salt',
    'with added vitamins', 'with added vitamin d',
    'with added calcium', 'fortified', 'enriched',
    'boiled', 'steamed', 'roasted', 'baked', 'fried', 'broiled', 'grilled',
    'braised', 'poached', 'sauteed', 'microwaved', 'stewed',
    'separable lean only', 'separable lean and fat',
    'bone-in', 'boneless', 'skinless', 'skin on', 'skin only', 'meat only',
    'broilers or fryers', 'mature seeds', 'mixed species',
    'single brand', 'type a', 'type ii',
    'cooked water no salt', 'cooked with water', 'cooked without salt',
]);

function isStripQualifier(segment: string): boolean {
    const s = segment.toLowerCase().trim();
    if (STRIP_QUALIFIER_WORDS.has(s)) return true;
    // e.g. "trimmed to 0" fat", "all grades", "sprouted"
    if (/^trimmed to/i.test(s)) return true;
    if (/^with (added|vitamin|iron|dha|ara)/i.test(s)) return true;
    if (/^(not reconstituted|reconstituted|ready.to.feed)$/i.test(s)) return true;
    if (/^\d+\.?\d*%\s*(milkfat|butterfat)$/i.test(s)) return true;
    if (/^(pan.fried|deep.fried|stir.fried|home.prepared|ready.to.eat)$/i.test(s)) return true;
    return false;
}

/**
 * Extract a useful ingredient query string from a USDA SR Legacy description.
 * Returns null if the description can't be converted to something useful.
 */
function parseUsdaDescription(description: string, category: string): string | null {
    // Skip obvious non-recipe items by description patterns
    for (const pat of SKIP_DESC_PATTERNS) {
        if (pat.test(description)) return null;
    }

    // Split into comma-separated segments, clean whitespace
    const raw = description.split(',').map(s => s.trim()).filter(Boolean);
    if (raw.length === 0) return null;

    const [primary, ...rest] = raw;
    const primaryLower = primary.toLowerCase();

    // Discard if the primary term is too generic on its own
    // (we'll try to build something from the qualifiers)
    const primaryIsGeneric = GENERIC_CATEGORY_WORDS.has(primaryLower);

    // Collect meaningful qualifiers from the rest of the segments
    const qualifiers: string[] = [];
    for (const seg of rest) {
        if (isStripQualifier(seg)) continue;
        // Skip percentage-only segments (e.g., "15% fat")
        if (/^\d+\.?\d*%(\s+fat)?$/i.test(seg.trim())) continue;
        // Skip very long segments (complex preparation descriptions)
        if (seg.split(/\s+/).length > 4) continue;
        // Skip segments that look like brand names (ALL CAPS)
        if (/^[A-Z\s,']+$/.test(seg) && seg.length > 3) continue;
        qualifiers.push(seg.toLowerCase().trim());
    }

    // Build the natural-English ingredient string
    // Rule: qualifiers precede the primary noun
    // e.g. primary="Oil", qualifiers=["olive"] → "olive oil"
    // e.g. primary="Beef", qualifiers=["ground", "85% lean"] → "85% lean ground beef"
    let term: string;

    if (primaryIsGeneric && qualifiers.length === 0) {
        return null; // "Oil" alone → skip
    }

    if (qualifiers.length > 0) {
        // Put qualifiers before the primary, but skip ultra-generic primary words
        if (primaryIsGeneric) {
            term = qualifiers.join(' ');
        } else {
            term = [...qualifiers, primaryLower].join(' ');
        }
    } else {
        term = primaryLower;
    }

    // Strip extra whitespace and slashes
    term = term.replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim();

    // Reject terms that are too long (likely noisy brand/qualifier combos)
    if (term.split(/\s+/).length > MAX_TERM_WORDS) return null;

    if (term.length < MIN_TERM_LENGTH) return null;

    return term;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    fn: (item: T, idx: number) => Promise<void>,
): Promise<void> {
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            await fn(items[idx], idx);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = process.argv.slice(2);
    const isDryRun     = args.includes('--dry-run');
    const isReset      = args.includes('--reset');
    const skipFatsecret = args.includes('--skip-fatsecret');
    const concurrency  = Number(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] ?? '3');
    const limit        = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0') || Infinity;
    const delayMs      = Number(args.find(a => a.startsWith('--delay-ms='))?.split('=')[1] ?? '400');

    const logDir = path.join(__dirname, '..', 'logs');
    fs.mkdirSync(logDir, { recursive: true });

    const logLines: string[] = [];
    function log(line: string) {
        console.log(line);
        logLines.push(line);
    }
    function flushLog() {
        fs.writeFileSync(LOG_FILE, logLines.join('\n'), 'utf-8');
    }

    log(`🌡️  USDA Cache Warmup — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);
    log(`   concurrency=${concurrency}  delayMs=${delayMs}  limit=${limit === Infinity ? '∞' : limit}`);
    log('');

    // ── Step 1: Load state (for resumability) ─────────────────────────────────
    type WarmupState = { attempted: string[] };
    let state: WarmupState = { attempted: [] };
    if (!isReset && fs.existsSync(STATE_FILE)) {
        state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
        log(`📂 Resuming — ${state.attempted.length} terms already attempted from previous run`);
    }
    const alreadyAttempted = new Set(state.attempted);

    function saveState(extraKey?: string) {
        if (extraKey) alreadyAttempted.add(extraKey);
        fs.writeFileSync(STATE_FILE, JSON.stringify({ attempted: [...alreadyAttempted] }), 'utf-8');
    }

    // ── Step 2: Load USDA files ───────────────────────────────────────────────
    const allUsdaFoods: any[] = [];
    for (const filePath of USDA_FILES) {
        const full = path.resolve(filePath);
        if (!fs.existsSync(full)) {
            log(`⚠️  File not found, skipping: ${filePath}`);
            continue;
        }
        log(`📁 Loading ${path.basename(full)}...`);
        const raw = fs.readFileSync(full, 'utf-8');
        const parsed = JSON.parse(raw);
        const foods: any[] = parsed.SRLegacyFoods ?? parsed.FoundationFoods ?? parsed.foods ?? (Array.isArray(parsed) ? parsed : []);
        log(`   Loaded ${foods.length} foods`);
        allUsdaFoods.push(...foods);
    }
    log(`📊 Total USDA foods loaded: ${allUsdaFoods.length}`);

    // ── Step 3: Parse descriptions → natural English terms ───────────────────
    log('\n🔍 Parsing USDA descriptions → ingredient terms...');
    const termSet = new Map<string, { term: string; priority: number }>(); // canonicalKey → { term, priority }

    let parseTotal = 0, parseSkippedCat = 0, parseSkippedDesc = 0, parseCollisions = 0;

    for (const food of allUsdaFoods) {
        const cat = typeof food.foodCategory === 'string'
            ? food.foodCategory
            : (food.foodCategory?.description ?? '');

        if (SKIP_CATEGORIES.has(cat)) {
            parseSkippedCat++;
            continue;
        }

        const desc: string = food.description || food.name || '';
        if (!desc) continue;

        parseTotal++;
        const natural = parseUsdaDescription(desc, cat);
        if (!natural) {
            parseSkippedDesc++;
            continue;
        }

        if (SKIP_NORMALIZED_TERMS.has(natural.toLowerCase())) {
            parseSkippedDesc++;
            continue;
        }

        // Normalize and canonicalize exactly as the pipeline does
        const { cleaned } = normalizeIngredientName(natural);
        if (!cleaned || cleaned.length < MIN_TERM_LENGTH) {
            parseSkippedDesc++;
            continue;
        }

        const cacheKey = canonicalizeCacheKey(cleaned);
        if (!cacheKey) continue;

        const priority = CATEGORY_PRIORITY[cat] ?? 0;
        if (!termSet.has(cacheKey)) {
            termSet.set(cacheKey, { term: cleaned, priority });
        } else {
            // Keep the entry associated with the higher-priority category
            const existing = termSet.get(cacheKey)!;
            if (priority > existing.priority) termSet.set(cacheKey, { term: cleaned, priority });
            parseCollisions++;
        }
    }

    log(`   Parsed:    ${parseTotal} foods`);
    log(`   Skipped (category): ${parseSkippedCat}`);
    log(`   Skipped (description): ${parseSkippedDesc}`);
    log(`   Collisions (same canonical key): ${parseCollisions}`);
    log(`   Unique canonical keys: ${termSet.size}`);

    // ── Step 4: Load existing ValidatedMapping keys ────────────────────────────
    log('\n📦 Loading existing ValidatedMapping cache keys...');
    const existingMappings = await prisma.validatedMapping.findMany({
        select: { normalizedForm: true },
    });
    const existingKeys = new Set(existingMappings.map(m => m.normalizedForm));
    log(`   Existing cache entries: ${existingKeys.size}`);

    // ── Step 5: Build work queue ───────────────────────────────────────────────
    const workQueue: Array<{ cacheKey: string; term: string }> = [];
    let skippedCached = 0;
    let skippedAttempted = 0;

    for (const [cacheKey, { term }] of termSet.entries()) {
        if (existingKeys.has(cacheKey)) {
            skippedCached++;
            continue;
        }
        if (alreadyAttempted.has(cacheKey)) {
            skippedAttempted++;
            continue;
        }
        workQueue.push({ cacheKey, term });
    }

    // Sort by category priority (highest first) so produce/protein run before snacks
    workQueue.sort((a, b) => {
        const pa = termSet.get(a.cacheKey)?.priority ?? 0;
        const pb = termSet.get(b.cacheKey)?.priority ?? 0;
        return pb - pa;
    });

    log(`   Already cached:   ${skippedCached}`);
    log(`   Already attempted: ${skippedAttempted}`);
    log(`   New to process:   ${workQueue.length}`);

    if (workQueue.length === 0) {
        log('\n✅ Nothing new to process. Cache is fully warmed from this dataset.');
        await prisma.$disconnect();
        return;
    }

    const toProcess = workQueue.slice(0, limit === Infinity ? undefined : limit);
    log(`\n🚀 Processing ${toProcess.length} terms (concurrency=${concurrency})${isDryRun ? ' [DRY RUN]' : ''}...\n`);

    // ── Step 6: Process ────────────────────────────────────────────────────────
    let mapped = 0, missed = 0, errored = 0;
    const failedTerms: string[] = [];

    await runWithConcurrency(toProcess, concurrency, async ({ cacheKey, term }, idx) => {
        const prefix = `[${String(idx + 1).padStart(5)}/${toProcess.length}]`;
        try {
            if (isDryRun) {
                log(`${prefix} 🔍 ${term}  (key: "${cacheKey}")`);
                saveState(cacheKey);
                return;
            }

            const result = await mapIngredientWithFallback(`1 cup ${term}`, {
                skipCache: false,
                source: skipFatsecret ? 'fdc' : 'fatsecret',
            });

            saveState(cacheKey); // Mark attempted regardless of result

            if (result) {
                log(`${prefix} ✅ ${term}  →  "${result.foodName}"${result.brandName ? ` (${result.brandName})` : ''}`);
                mapped++;
            } else {
                log(`${prefix} ⚠️  ${term}  →  no match`);
                failedTerms.push(term);
                missed++;
            }

            // Rate limit between calls
            await sleep(delayMs);
        } catch (err) {
            const msg = (err as Error).message;
            log(`${prefix} ❌ ${term}  →  ERROR: ${msg}`);
            saveState(cacheKey); // still mark attempted so we don't retry
            failedTerms.push(term);
            errored++;
            await sleep(delayMs * 2); // extra backoff on error
        }

        // Flush log periodically
        if ((idx + 1) % 50 === 0) flushLog();
    });

    // ── Step 7: Final report ───────────────────────────────────────────────────
    const finalCount = await prisma.validatedMapping.count();
    log('');
    log('══════════════════════════════════════════════════════');
    log('  USDA CACHE WARMUP COMPLETE');
    log('══════════════════════════════════════════════════════');
    log(`  Processed      : ${toProcess.length}`);
    log(`  Mapped (cached): ${mapped}`);
    log(`  No match       : ${missed}`);
    log(`  Errors         : ${errored}`);
    log(`  ValidatedMapping before: ${existingKeys.size}`);
    log(`  ValidatedMapping after : ${finalCount}`);
    log(`  Net new entries: ${finalCount - existingKeys.size}`);
    if (workQueue.length > toProcess.length) {
        log(`\n  ⏭️  ${workQueue.length - toProcess.length} terms remain (run again or remove --limit to continue)`);
    }
    if (failedTerms.length > 0) {
        log(`\n  Failed terms (${failedTerms.length}):`);
        for (const t of failedTerms.slice(0, 30)) log(`    - ${t}`);
        if (failedTerms.length > 30) log(`    ... and ${failedTerms.length - 30} more`);
    }

    flushLog();
    log(`\n📄 Full log: ${LOG_FILE}`);
    log(`📂 State file: ${STATE_FILE}`);

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});

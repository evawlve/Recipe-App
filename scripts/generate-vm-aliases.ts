/**
 * generate-vm-aliases.ts — Multiply VMs via alias expansion with Ollama gate
 *
 * For each existing ValidatedMapping, generates brand-stripped and variant aliases.
 * Each alias is validated by Ollama before insertion.
 *
 * Strategies:
 *   1. Brand-stripped: "great value peanut butter" → "peanut butter"
 *   2. Brand-only:     "great value peanut butter" → "great value peanut butter creamy" (already covered)
 *   3. Food-name-only: Uses foodName directly as an alias normalizedForm
 *
 * Usage:
 *   npx tsx scripts/generate-vm-aliases.ts
 *   npx tsx scripts/generate-vm-aliases.ts --source=fdc          # only FDC entries
 *   npx tsx scripts/generate-vm-aliases.ts --source=openfoodfacts
 *   npx tsx scripts/generate-vm-aliases.ts --limit=50000
 *   npx tsx scripts/generate-vm-aliases.ts --skip-ollama
 *   npx tsx scripts/generate-vm-aliases.ts --dry-run
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';
import { checkBatchQuality, verifyOllamaReady, QUALITY_GATE_BATCH_SIZE } from './lib/ollama-quality-gate';

const directUrl = process.env.DIRECT_URL;
if (!directUrl) { console.error('❌ DIRECT_URL not set'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip a known brand prefix from a normalizedForm key */
function stripBrand(normalizedForm: string, brandName: string | null): string | null {
  if (!brandName) return null;
  const brandLower = brandName.toLowerCase().trim();
  const brandTokens = brandLower.split(/\s+/);

  // The normalizedForm is sorted tokens. Remove all brand tokens.
  const formTokens = normalizedForm.split(/\s+/);
  const remaining = formTokens.filter(t => !brandTokens.includes(t));

  // Must have at least 1 meaningful token left
  if (remaining.length === 0) return null;
  const stripped = remaining.join(' ');
  // Don't create aliases shorter than 3 chars
  if (stripped.length < 3) return null;
  // Don't create aliases that are the same as the original
  if (stripped === normalizedForm) return null;
  return stripped;
}

/** Generate a normalizedForm from the raw foodName */
function foodNameToForm(foodName: string): string | null {
  const key = canonicalizeCacheKey(foodName.toLowerCase());
  if (!key || key.length < 3) return null;
  return key;
}

interface AliasCandidate {
  normalizedForm: string;    // The new alias normalizedForm
  parentVmId: string;
  foodId: string;
  foodName: string;
  brandName: string | null;
  source: string;
  aliasType: string;         // 'brand_stripped' | 'foodname_form'
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const isDryRun   = args.includes('--dry-run');
  const skipOllama = args.includes('--skip-ollama');
  const sourceFilter = args.find(a => a.startsWith('--source='))?.split('=')[1] ?? null;
  const limit      = Number(args.find(a => a.startsWith('--limit='))?.split('=')[1] ?? '0') || Infinity;

  console.log(`🔗 VM Alias Expansion — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`);
  console.log(`   source=${sourceFilter ?? 'all'}  limit=${limit === Infinity ? '∞' : limit}  ollamaCheck=${!skipOllama}\n`);

  if (!skipOllama) {
    const ok = await verifyOllamaReady();
    if (!ok) { console.error('❌ Ollama not reachable'); process.exit(1); }
    console.log('✅ Ollama is reachable\n');
  }

  // ── Load existing VMs ─────────────────────────────────────────────────────
  console.log('📦 Loading existing ValidatedMappings...');
  const whereClause: any = { isAlias: false };
  if (sourceFilter) whereClause.source = sourceFilter;

  const vms = await prisma.validatedMapping.findMany({
    where: whereClause,
    select: {
      id: true, normalizedForm: true, foodId: true,
      foodName: true, brandName: true, source: true,
    },
  });
  console.log(`   Loaded ${vms.length.toLocaleString()} non-alias VMs\n`);

  // Load all existing normalizedForm+source pairs to avoid collisions
  console.log('📦 Loading existing normalizedForm keys for dedup...');
  const existingKeys = new Set(
    (await prisma.validatedMapping.findMany({
      select: { normalizedForm: true, source: true },
    })).map(m => `${m.source}::${m.normalizedForm}`)
  );
  console.log(`   ${existingKeys.size.toLocaleString()} existing keys\n`);

  // ── Generate alias candidates ─────────────────────────────────────────────
  console.log('🧮 Generating alias candidates...');
  const candidates: AliasCandidate[] = [];

  for (const vm of vms) {
    if (candidates.length >= limit) break;

    // Strategy 1: Brand-stripped alias
    if (vm.brandName) {
      const stripped = stripBrand(vm.normalizedForm, vm.brandName);
      if (stripped) {
        const key = `${vm.source}::${stripped}`;
        if (!existingKeys.has(key)) {
          candidates.push({
            normalizedForm: stripped,
            parentVmId: vm.id, foodId: vm.foodId,
            foodName: vm.foodName, brandName: vm.brandName,
            source: vm.source, aliasType: 'brand_stripped',
          });
          existingKeys.add(key); // prevent duplicates within this run
        }
      }
    }

    // Strategy 2: foodName-derived form (different from normalizedForm)
    const fnForm = foodNameToForm(vm.foodName);
    if (fnForm && fnForm !== vm.normalizedForm) {
      const key = `${vm.source}::${fnForm}`;
      if (!existingKeys.has(key)) {
        candidates.push({
          normalizedForm: fnForm,
          parentVmId: vm.id, foodId: vm.foodId,
          foodName: vm.foodName, brandName: vm.brandName,
          source: vm.source, aliasType: 'foodname_form',
        });
        existingKeys.add(key);
      }
    }
  }

  console.log(`   Generated ${candidates.length.toLocaleString()} alias candidates\n`);

  // ── Validate + Insert ─────────────────────────────────────────────────────
  let inserted = 0, rejected = 0, errors = 0;
  const batchSize = skipOllama ? 50 : QUALITY_GATE_BATCH_SIZE;

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);

    // Ollama quality gate
    let passFlags = new Array(batch.length).fill(true);
    if (!skipOllama) {
      passFlags = await checkBatchQuality(
        batch.map(c => ({
          normalizedForm: c.normalizedForm,
          foodName: c.foodName,
          brandName: c.brandName,
        }))
      );
    }

    const passed = batch.filter((_, idx) => passFlags[idx]);
    rejected += batch.length - passed.length;

    if (isDryRun) {
      for (const c of passed) {
        console.log(`  [DRY] ${c.aliasType}: "${c.normalizedForm}" → "${c.foodName}" (${c.source})`);
        inserted++;
      }
      continue;
    }

    // Insert passed aliases
    for (const c of passed) {
      try {
        const vmId = `vm_alias_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
        await prisma.validatedMapping.create({
          data: {
            id: vmId,
            rawIngredient: `[alias:${c.aliasType}] ${c.foodName}`,
            normalizedForm: c.normalizedForm,
            foodId: c.foodId,
            foodName: c.foodName,
            brandName: c.brandName,
            source: c.source,
            aiConfidence: 0.80,
            validationReason: `alias_expansion_${c.aliasType}`,
            isAlias: true,
            canonicalRawIngredient: c.parentVmId,
            validatedBy: skipOllama ? 'alias_expansion' : 'ollama_quality_gate',
            usedCount: 0,
          },
        });
        inserted++;

        if (inserted % 5000 === 0) {
          const pct = ((i + batchSize) / candidates.length * 100).toFixed(1);
          console.log(`  ✅ ${inserted.toLocaleString()} aliases inserted | ${rejected} rejected | ${pct}%`);
        }
      } catch (err) {
        // Unique constraint violation = already exists, just skip
        if ((err as Error).message.includes('Unique constraint')) continue;
        errors++;
        if (errors <= 10) console.log(`  ⚠️  ${(err as Error).message.slice(0, 100)}`);
      }
    }
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  ALIAS EXPANSION COMPLETE');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Candidates   : ${candidates.length.toLocaleString()}`);
  console.log(`  Inserted     : ${inserted.toLocaleString()}`);
  console.log(`  Ollama reject: ${rejected.toLocaleString()}`);
  console.log(`  Errors       : ${errors.toLocaleString()}`);

  if (!isDryRun) {
    const total = await prisma.validatedMapping.count();
    console.log(`\n  📊 Total VMs now: ${total.toLocaleString()}`);
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });

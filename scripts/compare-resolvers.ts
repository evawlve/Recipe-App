import { prisma } from '../src/lib/db';
import { computeTotals } from '../src/lib/nutrition/compute';

type CompareOptions = {
  recipes: number;
  threshold: number;
  recipeId?: string;
};

type MetricKey = 'calories' | 'proteinG' | 'carbsG' | 'fatG' | 'fiberG' | 'sugarG';

const METRICS: MetricKey[] = ['calories', 'proteinG', 'carbsG', 'fatG', 'fiberG', 'sugarG'];

function parseArgs(): CompareOptions {
  const args = process.argv.slice(2);
  const options: CompareOptions = {
    recipes: 100,
    threshold: 0.05
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--recipes' || arg === '-n') {
      const value = Number(args[i + 1]);
      if (!Number.isNaN(value) && value > 0) {
        options.recipes = value;
      }
      i++;
    } else if (arg === '--threshold' || arg === '-t') {
      const value = Number(args[i + 1]);
      if (!Number.isNaN(value) && value >= 0) {
        options.threshold = value;
      }
      i++;
    } else if (arg === '--recipe' || arg === '--id') {
      options.recipeId = args[i + 1];
      i++;
    }
  }

  return options;
}

function pctDiff(oldValue: number, newValue: number) {
  if (oldValue === 0) {
    if (newValue === 0) return 0;
    return Number.POSITIVE_INFINITY;
  }
  return (newValue - oldValue) / oldValue;
}

async function main() {
  const options = parseArgs();
  const recipes = await prisma.recipe.findMany({
    where: options.recipeId ? { id: options.recipeId } : undefined,
    select: {
      id: true,
      title: true,
      authorId: true,
      updatedAt: true
    },
    orderBy: options.recipeId
      ? undefined
      : {
          updatedAt: 'desc'
        },
    take: options.recipeId ? undefined : options.recipes
  });

  if (recipes.length === 0) {
    console.log('No recipes found for comparison.');
    return;
  }

  console.log(
    `🔍 Comparing portion resolver on ${recipes.length} recipe(s) (threshold ${(options.threshold * 100).toFixed(
      1
    )}% per metric)`
  );

  const summary = {
    compared: 0,
    failures: 0,
    largeDeltas: [] as Array<{
      recipeId: string;
      title: string;
      deltas: Record<MetricKey, { diff: number; pct: number }>;
    }>,
    totals: {
      portionHits: 0,
      portionFallbacks: 0,
      avgConfidence: 0,
      sumConfidence: 0,
      confidenceSamples: 0
    }
  };

  for (const recipe of recipes) {
    try {
      const oldTotals = await computeTotals(recipe.id, {
        enablePortionV2: false
      });

      const newTotals = await computeTotals(recipe.id, {
        enablePortionV2: true,
        userId: recipe.authorId,
        recordSamples: false
      });

      summary.compared += 1;

      if (newTotals.portionStats) {
        summary.totals.portionHits += newTotals.portionStats.resolvedCount;
        summary.totals.portionFallbacks += newTotals.portionStats.fallbackCount;
        if (typeof newTotals.portionStats.avgConfidence === 'number') {
          summary.totals.sumConfidence += newTotals.portionStats.avgConfidence;
          summary.totals.confidenceSamples += 1;
        }
      }

      const deltas: Record<MetricKey, { diff: number; pct: number }> = {} as any;
      let exceedsThreshold = false;

      for (const key of METRICS) {
        const diff = (newTotals as any)[key] - (oldTotals as any)[key];
        const pct = pctDiff((oldTotals as any)[key], (newTotals as any)[key]);
        deltas[key] = { diff: Number(diff.toFixed(2)), pct: Number((pct * 100).toFixed(2)) };
        if (Number.isFinite(pct) && Math.abs(pct) > options.threshold) {
          exceedsThreshold = true;
        }
      }

      if (exceedsThreshold) {
        summary.largeDeltas.push({
          recipeId: recipe.id,
          title: recipe.title,
          deltas
        });
      }
    } catch (error) {
      summary.failures += 1;
      console.error(`❌ Failed to compare recipe ${recipe.id}:`, error);
    }
  }

  const avgConfidence =
    summary.totals.confidenceSamples > 0
      ? Number((summary.totals.sumConfidence / summary.totals.confidenceSamples).toFixed(3))
      : 0;

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SHADOW COMPARISON SUMMARY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`Recipes compared: ${summary.compared}`);
  console.log(`Recipes failed:   ${summary.failures}`);
  console.log(
    `Portion hits:    ${summary.totals.portionHits} (fallbacks ${summary.totals.portionFallbacks})`
  );
  console.log(`Avg confidence:  ${avgConfidence}`);

  if (summary.largeDeltas.length > 0) {
    console.log('\n⚠️  Recipes exceeding threshold:');
    for (const entry of summary.largeDeltas.slice(0, 10)) {
      console.log(`  - ${entry.title} (${entry.recipeId})`);
      for (const key of METRICS) {
        const delta = entry.deltas[key];
        if (Number.isFinite(delta.pct)) {
          console.log(`      ${key}: diff ${delta.diff} (${delta.pct}%)`);
        } else {
          console.log(`      ${key}: diff ${delta.diff} (baseline 0)`);
        }
      }
    }
    if (summary.largeDeltas.length > 10) {
      console.log(`  ...and ${summary.largeDeltas.length - 10} more`);
    }
  } else {
    console.log('\n✅ All recipes within threshold');
  }

  await prisma.$disconnect();
}

main()
  .catch(async (err) => {
    console.error('Fatal error:', err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .then(() => process.exit(0));


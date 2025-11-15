#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';
import { FATSECRET_CACHE_MAX_AGE_MINUTES } from '../src/lib/fatsecret/config';

interface VerifyOptions {
  limit: number;
  staleOnly: boolean;
  missingServingsOnly: boolean;
}

function parseVerifyArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  let limit = 25;
  let staleOnly = false;
  let missingServingsOnly = false;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg === '--stale-only') {
      staleOnly = true;
    } else if (arg === '--missing-servings') {
      missingServingsOnly = true;
    }
  }

  return { limit, staleOnly, missingServingsOnly };
}

async function main() {
  const options = parseVerifyArgs();
  const maxAge = FATSECRET_CACHE_MAX_AGE_MINUTES;
  const maxAgeDate = new Date(Date.now() - maxAge * 60 * 1000);

  const issues = [];

  if (options.staleOnly) {
    issues.push({
      OR: [
        { expiresAt: { lt: new Date() } },
        { syncedAt: { lt: maxAgeDate } },
      ],
    });
  }

  if (options.missingServingsOnly) {
    issues.push({
      servings: {
        none: {},
      },
    });
  }

  issues.push({ nutrientsPer100g: null });

  const candidates = await prisma.fatSecretFoodCache.findMany({
    where: {
      OR: issues,
    },
    orderBy: { syncedAt: 'asc' },
    take: options.limit,
    include: {
      servings: true,
    },
  });

  if (candidates.length === 0) {
    logger.info('No FatSecret cache issues detected ✅');
    return;
  }

  for (const food of candidates) {
    const missingNutrients = food.nutrientsPer100g == null;
    const missingServings = food.servings.length === 0;
    const stale = food.syncedAt < maxAgeDate;

    logger.warn(
      {
        foodId: food.id,
        name: food.name,
        brandName: food.brandName,
        missingNutrients,
        missingServings,
        stale,
        lastSynced: food.syncedAt.toISOString(),
      },
      'FatSecret cache verification warning',
    );
  }
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret cache verification failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

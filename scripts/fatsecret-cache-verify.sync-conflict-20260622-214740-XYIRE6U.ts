#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';
import { FATSECRET_CACHE_MAX_AGE_MINUTES } from '../src/lib/fatsecret/config';

interface VerifyOptions {
  limit: number;
  staleOnly: boolean;
  missingServingsOnly: boolean;
  servingMode?: 'weight' | 'volume';
  onlyMissingNutrients?: boolean;
  outputFile?: string;
}

function parseVerifyArgs(): VerifyOptions {
  const args = process.argv.slice(2);
  let limit = 25;
  let staleOnly = false;
  let missingServingsOnly = false;
  let servingMode: 'weight' | 'volume' | undefined;
  let onlyMissingNutrients = false;
  let outputFile: string | undefined;

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg === '--stale-only') {
      staleOnly = true;
    } else if (arg === '--missing-servings') {
      missingServingsOnly = true;
    } else if (arg.startsWith('--serving-mode=')) {
      const value = arg.split('=')[1];
      if (value === 'weight' || value === 'volume') {
        servingMode = value;
      }
    } else if (arg === '--only-missing-nutrients') {
      onlyMissingNutrients = true;
    } else if (arg.startsWith('--output-file=')) {
      outputFile = arg.split('=')[1];
    }
  }

  return { limit, staleOnly, missingServingsOnly, servingMode, onlyMissingNutrients, outputFile };
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

  if (!options.onlyMissingNutrients) {
    issues.push({ nutrientsPer100g: { equals: null } });
  }

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
    if (options.outputFile) {
      writeIdFile(options.outputFile, []);
    }
    return;
  }

  const flaggedIds: string[] = [];

  for (const food of candidates) {
    const missingNutrients = food.nutrientsPer100g == null;
    const missingServings = food.servings.length === 0;
    const missingVolume = options.servingMode === 'volume'
      ? !food.servings.some((serving) => serving.isVolume && (serving.volumeMl ?? 0) > 0)
      : false;
    const missingWeight = options.servingMode === 'weight'
      ? !food.servings.some((serving) => (serving.servingWeightGrams ?? 0) > 0)
      : false;
    const stale = food.syncedAt < maxAgeDate;

    if (options.servingMode === 'volume' && !missingVolume) {
      continue;
    }
    if (options.servingMode === 'weight' && !missingWeight) {
      continue;
    }
    if (options.servingMode == null && options.onlyMissingNutrients && !missingNutrients) {
      continue;
    }
    flaggedIds.push(food.id);

    logger.warn(
      {
        foodId: food.id,
        name: food.name,
        brandName: food.brandName,
        missingNutrients,
        missingServings,
        missingVolume,
        missingWeight,
        stale,
        lastSynced: food.syncedAt.toISOString(),
      },
      'FatSecret cache verification warning',
    );
  }

  if (options.outputFile) {
    writeIdFile(options.outputFile, flaggedIds);
  }
}

function writeIdFile(filePath: string, ids: string[]) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, `${ids.join('\n')}\n`, 'utf8');
  logger.info({ filePath: absolute, count: ids.length }, 'Wrote verify output file');
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret cache verification failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

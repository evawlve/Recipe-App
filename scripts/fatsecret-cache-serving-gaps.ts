#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';

interface CliOptions {
  limit: number;
  includeWeight: boolean;
  includeVolume: boolean;
  weightOutputFile: string | null;
  volumeOutputFile: string | null;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let limit = 250;
  let includeWeight = true;
  let includeVolume = true;
  let weightOutputFile: string | null = 'data/fatsecret/serving_gaps.weight.jsonl';
  let volumeOutputFile: string | null = 'data/fatsecret/serving_gaps.volume.jsonl';

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg === '--weight-only') {
      includeWeight = true;
      includeVolume = false;
    } else if (arg === '--volume-only') {
      includeVolume = true;
      includeWeight = false;
    } else if (arg.startsWith('--weight-output=')) {
      weightOutputFile = arg.split('=')[1];
    } else if (arg.startsWith('--volume-output=')) {
      volumeOutputFile = arg.split('=')[1];
    }
  }

  if (!includeWeight) weightOutputFile = null;
  if (!includeVolume) volumeOutputFile = null;
  if (!includeWeight && !includeVolume) {
    throw new Error('Select at least one serving mode (weight or volume)');
  }

  return { limit, includeWeight, includeVolume, weightOutputFile, volumeOutputFile };
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function main() {
  const options = parseArgs();

  const servingFilters = [];
  if (options.includeWeight) {
    servingFilters.push({
      servings: {
        none: {
          servingWeightGrams: { not: null },
        },
      },
    });
  }
  if (options.includeVolume) {
    servingFilters.push({
      servings: {
        none: {
          isVolume: true,
          volumeMl: { not: null },
        },
      },
    });
  }

  const foods = await prisma.fatSecretFoodCache.findMany({
    where: {
      OR: servingFilters,
    },
    orderBy: { syncedAt: 'asc' },
    take: options.limit,
    include: {
      servings: true,
    },
  });

  if (foods.length === 0) {
    logger.info('No serving gaps detected ✅');
    if (options.weightOutputFile) {
      ensureDir(options.weightOutputFile);
      fs.writeFileSync(options.weightOutputFile, '', 'utf8');
    }
    if (options.volumeOutputFile) {
      ensureDir(options.volumeOutputFile);
      fs.writeFileSync(options.volumeOutputFile, '', 'utf8');
    }
    return;
  }

  const weightStream = options.weightOutputFile
    ? fs.createWriteStream(options.weightOutputFile, { encoding: 'utf8' })
    : null;
  const volumeStream = options.volumeOutputFile
    ? fs.createWriteStream(options.volumeOutputFile, { encoding: 'utf8' })
    : null;

  for (const food of foods) {
    const missingWeight = !food.servings.some((serving) => (serving.servingWeightGrams ?? 0) > 0);
    const missingVolume = !food.servings.some((serving) => serving.isVolume && (serving.volumeMl ?? 0) > 0);
    const payload = JSON.stringify({
      foodId: food.id,
      name: food.name,
      brandName: food.brandName,
      missingWeight,
      missingVolume,
      servings: food.servings.map((serving) => ({
        id: serving.id,
        description: serving.measurementDescription,
        numberOfUnits: serving.numberOfUnits,
        metricServingAmount: serving.metricServingAmount,
        metricServingUnit: serving.metricServingUnit,
        servingWeightGrams: serving.servingWeightGrams,
        volumeMl: serving.volumeMl,
        isVolume: serving.isVolume,
      })),
      syncedAt: food.syncedAt,
    });

    if (missingWeight && weightStream) {
      weightStream.write(`${payload}\n`);
    }
    if (missingVolume && volumeStream) {
      volumeStream.write(`${payload}\n`);
    }

    logger.warn(
      {
        foodId: food.id,
        name: food.name,
        missingWeight,
        missingVolume,
        servings: food.servings.length,
      },
      'Detected FatSecret serving gap',
    );
  }

  weightStream?.end();
  volumeStream?.end();
  if (options.weightOutputFile) {
    logger.info({ filePath: options.weightOutputFile }, 'Wrote weight serving gaps file');
  }
  if (options.volumeOutputFile) {
    logger.info({ filePath: options.volumeOutputFile }, 'Wrote volume serving gaps file');
  }
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret serving gap detection failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

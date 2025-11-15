#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';
import { upsertFoodFromApi } from '../src/lib/fatsecret/cache';

interface CliOptions {
  foodIds: string[];
  source?: string;
  legacyFoodId?: string;
  note?: string;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const foodIds = new Set<string>();
  let source: string | undefined;
  let legacyFoodId: string | undefined;
  let note: string | undefined;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--food-id=')) {
      foodIds.add(arg.split('=')[1]?.trim() ?? '');
    } else if (arg === '--food-id') {
      const next = args[i + 1];
      if (next) {
        foodIds.add(next.trim());
        i += 1;
      }
    } else if (arg.startsWith('--file=')) {
      const idsFromFile = readIdsFromFile(arg.split('=')[1]);
      idsFromFile.forEach((id) => foodIds.add(id));
    } else if (arg.startsWith('--source=')) {
      source = arg.split('=')[1];
    } else if (arg.startsWith('--legacy-food-id=')) {
      legacyFoodId = arg.split('=')[1];
    } else if (arg.startsWith('--note=')) {
      note = arg.split('=')[1];
    }
  }

  const positionalIds = args
    .filter((arg) => !arg.startsWith('--'))
    .map((id) => id.trim())
    .filter(Boolean);
  positionalIds.forEach((id) => foodIds.add(id));

  const validFoodIds = Array.from(foodIds).filter(Boolean);
  if (validFoodIds.length === 0) {
    throw new Error('Provide at least one FatSecret food id via --food-id or --file');
  }

  return {
    foodIds: validFoodIds,
    source,
    legacyFoodId,
    note,
  };
}

function readIdsFromFile(filePath: string): string[] {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`Queue file not found: ${absolute}`);
  }
  const raw = fs.readFileSync(absolute, 'utf-8');
  return raw
    .split(/[\r\n,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

async function main() {
  const options = parseArgs();
  logger.info(
    { count: options.foodIds.length, source: options.source },
    'FatSecret cache hydrate run starting',
  );

  const syncRun = await prisma.fatSecretCacheSyncRun.create({
    data: {
      status: 'running',
      totalRequested: options.foodIds.length,
      metadata: {
        cli: 'fatsecret-cache-hydrate',
        note: options.note,
      },
    },
  });

  let hydrated = 0;
  let failed = 0;

  for (const foodId of options.foodIds) {
    try {
      await upsertFoodFromApi(foodId, {
        source: options.source,
        legacyFoodId: options.legacyFoodId,
      });
      hydrated += 1;
      logger.info({ foodId }, 'Hydrated FatSecret food');
    } catch (error) {
      failed += 1;
      logger.error({ foodId, err: error }, 'Failed to hydrate FatSecret food');
    }
  }

  await prisma.fatSecretCacheSyncRun.update({
    where: { id: syncRun.id },
    data: {
      status: failed > 0 ? 'completed_with_errors' : 'completed',
      totalHydrated: hydrated,
      totalFailed: failed,
      finishedAt: new Date(),
      error: failed > 0 ? `${failed} foods failed to hydrate` : null,
    },
  });

  logger.info(
    { hydrated, failed, runId: syncRun.id },
    'FatSecret cache hydrate run finished',
  );
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret cache hydrate failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

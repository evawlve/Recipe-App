#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';
import { requestAiServing, type ServingGapType } from '../src/lib/ai/serving-estimator';
import {
  FATSECRET_CACHE_AI_CONFIDENCE_MIN,
  FATSECRET_CACHE_AI_MAX_DENSITY,
  FATSECRET_CACHE_AI_MIN_DENSITY,
} from '../src/lib/fatsecret/config';

interface GapServing {
  id: string;
  description?: string;
  numberOfUnits?: number;
  metricServingAmount?: number;
  metricServingUnit?: string;
  servingWeightGrams?: number;
  volumeMl?: number;
  isVolume: boolean;
}

interface ServingGapRecord {
  foodId: string;
  name: string;
  brandName?: string | null;
  missingWeight: boolean;
  missingVolume: boolean;
  servings: GapServing[];
  syncedAt: string;
}

interface CliOptions {
  volumeInput: string | null;
  weightInput: string | null;
  dryRun: boolean;
  limit: number | null;
  promptDebug: boolean;
}

interface ProcessStats {
  created: number;
  skipped: number;
  manualReview: number;
}

const DEFAULT_VOLUME_FILE = 'data/fatsecret/serving_gaps.volume.jsonl';
const DEFAULT_WEIGHT_FILE = 'data/fatsecret/serving_gaps.weight.jsonl';
const AI_LOG_FILE = 'data/fatsecret/ai-servings.log';
const MANUAL_REVIEW_FILE = 'data/fatsecret/manual-review.csv';

const VOLUME_UNIT_TO_ML: Record<string, number> = {
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  millilitre: 1,
  millilitres: 1,
  l: 1000,
  liter: 1000,
  liters: 1000,
  litre: 1000,
  litres: 1000,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  floz: 30,
  'fl oz': 30,
  'fluid ounce': 30,
  'fluid ounces': 30,
};
const COUNT_UNITS = new Set(['count', 'item', 'items', 'piece', 'pieces', 'tortilla', 'egg', 'bagel']);

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let volumeInput: string | null = DEFAULT_VOLUME_FILE;
  let weightInput: string | null = DEFAULT_WEIGHT_FILE;
  let dryRun = false;
  let limit: number | null = null;
  let promptDebug = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--volume-only') {
      weightInput = null;
    } else if (arg === '--weight-only') {
      volumeInput = null;
    } else if (arg.startsWith('--volume-input=')) {
      volumeInput = arg.split('=')[1];
    } else if (arg === '--volume-input') {
      const next = args[i + 1];
      if (next) {
        volumeInput = next;
        i += 1;
      }
    } else if (arg.startsWith('--weight-input=')) {
      weightInput = arg.split('=')[1];
    } else if (arg === '--weight-input') {
      const next = args[i + 1];
      if (next) {
        weightInput = next;
        i += 1;
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--limit=')) {
      limit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg === '--prompt-debug') {
      promptDebug = true;
    }
  }

  if (!volumeInput && !weightInput) {
    throw new Error('Select at least one input file (volume or weight)');
  }

  return { volumeInput, weightInput, dryRun, limit, promptDebug };
}

function readGapFile(filePath: string | null, limit: number | null): ServingGapRecord[] {
  if (!filePath) return [];
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    logger.warn('Serving gap file not found, skipping', { filePath: absolute });
    return [];
  }
  const lines = fs.readFileSync(absolute, 'utf-8').split(/\r?\n/).filter(Boolean);
  const selected = typeof limit === 'number' ? lines.slice(0, limit) : lines;
  const records: ServingGapRecord[] = [];
  for (const line of selected) {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      logger.warn('Failed to parse serving gap entry', { filePath: absolute, line });
    }
  }
  return records;
}

function ensureFile(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf8');
  }
}

function appendManualReview(entry: ServingGapRecord, reason: string) {
  ensureFile(MANUAL_REVIEW_FILE);
  const line = `${entry.foodId},${JSON.stringify(entry.name)},${reason}\n`;
  fs.appendFileSync(MANUAL_REVIEW_FILE, line, 'utf8');
}

function logAiServing(payload: Record<string, unknown>) {
  ensureFile(AI_LOG_FILE);
  fs.appendFileSync(AI_LOG_FILE, `${JSON.stringify(payload)}\n`, 'utf8');
}

function convertVolumeToMl(unit: string, amount: number): number | null {
  if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
  const normalized = unit.trim().toLowerCase();
  const scale = VOLUME_UNIT_TO_ML[normalized];
  if (!scale) return null;
  return amount * scale;
}

function buildServingId(foodId: string, label: string): string {
  const hash = crypto.createHash('sha1').update(`${foodId}:${label}`).digest('hex').slice(0, 12);
  return `ai_${hash}`;
}

import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

async function insertAiServingWrapper(
  entry: ServingGapRecord,
  gapType: ServingGapType,
  options: CliOptions,
): Promise<boolean> {
  const result = await insertAiServing(entry.foodId, gapType, {
    dryRun: options.dryRun,
    promptDebug: options.promptDebug,
  });

  if (!result.success) {
    if (result.reason) {
      appendManualReview(entry, result.reason);
    }
    // Log failure for stats
    logAiServing({
      timestamp: new Date().toISOString(),
      foodId: entry.foodId,
      foodName: entry.name,
      brandName: entry.brandName,
      mode: gapType,
      status: 'error',
      reason: result.reason ?? 'unknown',
    });
    return false;
  }

  // If successful (or dry-run success), log it
  // Note: The shared function doesn't return the full suggestion details in the return value
  // so we might miss some detailed logging here compared to the original script,
  // but the shared function does its own logging.
  // We'll keep the simple success/failure stats.

  return true;
}

async function processGapRecords(
  records: ServingGapRecord[],
  gapType: ServingGapType,
  options: CliOptions,
): Promise<ProcessStats> {
  const stats: ProcessStats = { created: 0, skipped: 0, manualReview: 0 };
  for (const record of records) {
    const success = await insertAiServingWrapper(record, gapType, options);
    if (success) {
      stats.created += 1;
    } else {
      stats.skipped += 1;
      stats.manualReview += 1;
    }
  }
  return stats;
}

async function main() {
  const options = parseArgs();
  const volumeRecords = readGapFile(options.volumeInput, options.limit);
  const weightRecords = readGapFile(options.weightInput, options.limit);

  logger.info(
    'Starting FatSecret AI serving backfill',
    {
      dryRun: options.dryRun,
      volumeRecords: volumeRecords.length,
      weightRecords: weightRecords.length,
      confidenceMin: FATSECRET_CACHE_AI_CONFIDENCE_MIN,
    },
  );

  const volumeStats = await processGapRecords(volumeRecords, 'volume', options);
  const weightStats = await processGapRecords(weightRecords, 'weight', options);

  logger.info(
    'FatSecret AI serving backfill finished',
    {
      created: volumeStats.created + weightStats.created,
      skipped: volumeStats.skipped + weightStats.skipped,
      manualReview: volumeStats.manualReview + weightStats.manualReview,
      dryRun: options.dryRun,
    },
  );
}

main()
  .catch((error) => {
    logger.error('FatSecret AI serving backfill failed', { err: error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

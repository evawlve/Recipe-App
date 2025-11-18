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
    logger.warn({ filePath: absolute }, 'Serving gap file not found, skipping');
    return [];
  }
  const lines = fs.readFileSync(absolute, 'utf-8').split(/\r?\n/).filter(Boolean);
  const selected = typeof limit === 'number' ? lines.slice(0, limit) : lines;
  const records: ServingGapRecord[] = [];
  for (const line of selected) {
    try {
      records.push(JSON.parse(line));
    } catch (error) {
      logger.warn({ filePath: absolute, line }, 'Failed to parse serving gap entry');
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

async function insertAiServing(
  entry: ServingGapRecord,
  gapType: ServingGapType,
  options: CliOptions,
): Promise<boolean> {
  const food = await prisma.fatSecretFoodCache.findUnique({
    where: { id: entry.foodId },
    include: { servings: true },
  });
  if (!food) {
    logger.warn({ foodId: entry.foodId }, 'FatSecret food missing from cache');
    return false;
  }

  const aiResult = await requestAiServing({ gapType, food });
  if (options.promptDebug) {
    logger.info(
      { foodId: entry.foodId, gapType, prompt: aiResult.prompt },
      'AI prompt debug',
    );
  }
  if (aiResult.status === 'error') {
    logger.warn({ foodId: entry.foodId, reason: aiResult.reason }, 'AI serving suggestion failed');
    appendManualReview(entry, aiResult.reason);
    logAiServing({
      foodId: entry.foodId,
      mode: gapType,
      status: 'error',
      reason: aiResult.reason,
      prompt: aiResult.prompt,
      raw: aiResult.raw,
    });
    return false;
  }

  const suggestion = aiResult.suggestion;
  let volumeMl =
    suggestion.volumeUnit && suggestion.volumeAmount
      ? convertVolumeToMl(suggestion.volumeUnit, suggestion.volumeAmount)
      : null;
  let countServing = false;
  let countUnit: string | undefined;
  if (gapType === 'volume' && !volumeMl) {
    const unit = suggestion.volumeUnit?.toLowerCase().trim();
    if (suggestion.volumeAmount && suggestion.volumeAmount > 0 && (unit ? COUNT_UNITS.has(unit) : true)) {
      countServing = true;
      countUnit = unit ?? 'count';
      volumeMl = suggestion.volumeAmount;
    } else if (unit && COUNT_UNITS.has(unit)) {
      countServing = true;
      countUnit = unit;
      volumeMl = suggestion.volumeAmount ?? 1;
    }
  }
  if (gapType === 'volume' && !volumeMl && !countServing) {
    logger.warn(
      { foodId: entry.foodId, serving: suggestion.servingLabel },
      'AI did not return a convertible volume',
    );
    appendManualReview(entry, 'AI missing convertible volume');
    logAiServing({
      foodId: entry.foodId,
      mode: gapType,
      status: 'error',
      reason: 'missing_volume_unit',
      prompt: aiResult.prompt,
      raw: aiResult.raw,
    });
    return false;
  }

  if (suggestion.grams <= 0) {
    logger.warn({ foodId: entry.foodId }, 'AI returned invalid gram weight');
    appendManualReview(entry, 'AI invalid grams');
    return false;
  }

  const density = volumeMl && !countServing ? suggestion.grams / volumeMl : null;
  if (
    density &&
    (density < FATSECRET_CACHE_AI_MIN_DENSITY || density > FATSECRET_CACHE_AI_MAX_DENSITY)
  ) {
    logger.warn({ foodId: entry.foodId, density }, 'AI density outside bounds');
    appendManualReview(entry, 'AI density outside bounds');
    return false;
  }

  const servingId = buildServingId(entry.foodId, suggestion.servingLabel);
  if (options.dryRun) {
    logger.info(
      {
        foodId: entry.foodId,
        gapType,
        servingId,
        label: suggestion.servingLabel,
        grams: suggestion.grams,
        volumeMl,
        confidence: suggestion.confidence,
      },
      'DRY RUN: would insert AI-derived serving',
    );
    logAiServing({
      foodId: entry.foodId,
      mode: gapType,
      status: 'dry-run',
      suggestion,
      prompt: aiResult.prompt,
      raw: aiResult.raw,
    });
    return true;
  }

  await prisma.$transaction(async (tx) => {
    let densityEstimateId: string | undefined;
    if (density && volumeMl) {
      const densityRow = await tx.fatSecretDensityEstimate.create({
        data: {
          foodId: entry.foodId,
          densityGml: density,
          source: 'ai',
          confidence: suggestion.confidence,
          notes: suggestion.rationale,
        },
      });
      densityEstimateId = densityRow.id;
    }

    await tx.fatSecretServingCache.upsert({
      where: { id: servingId },
      create: {
        id: servingId,
        foodId: entry.foodId,
        measurementDescription: suggestion.servingLabel,
        numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
        metricServingAmount: volumeMl ?? suggestion.grams,
        metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
        servingWeightGrams: suggestion.grams,
        volumeMl,
        isVolume: gapType === 'volume',
        isDefault: false,
        derivedViaDensity: volumeMl != null && !countServing,
        densityEstimateId,
        source: 'ai',
        confidence: suggestion.confidence,
        note: suggestion.rationale,
      },
      update: {
        measurementDescription: suggestion.servingLabel,
        numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
        metricServingAmount: volumeMl ?? suggestion.grams,
        metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
        servingWeightGrams: suggestion.grams,
        volumeMl,
        isVolume: gapType === 'volume',
        derivedViaDensity: volumeMl != null && !countServing,
        densityEstimateId,
        source: 'ai',
        confidence: suggestion.confidence,
        note: suggestion.rationale,
      },
    });
  });

  logAiServing({
    foodId: entry.foodId,
    mode: gapType,
    status: 'inserted',
    suggestion,
    prompt: aiResult.prompt,
    raw: aiResult.raw,
  });
  logger.info(
    { foodId: entry.foodId, servingId, gapType, label: suggestion.servingLabel },
    'Inserted AI-derived FatSecret serving',
  );
  return true;
}

async function processGapRecords(
  records: ServingGapRecord[],
  gapType: ServingGapType,
  options: CliOptions,
): Promise<ProcessStats> {
  const stats: ProcessStats = { created: 0, skipped: 0, manualReview: 0 };
  for (const record of records) {
    const success = await insertAiServing(record, gapType, options);
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
    {
      dryRun: options.dryRun,
      volumeRecords: volumeRecords.length,
      weightRecords: weightRecords.length,
      confidenceMin: FATSECRET_CACHE_AI_CONFIDENCE_MIN,
    },
    'Starting FatSecret AI serving backfill',
  );

  const volumeStats = await processGapRecords(volumeRecords, 'volume', options);
  const weightStats = await processGapRecords(weightRecords, 'weight', options);

  logger.info(
    {
      created: volumeStats.created + weightStats.created,
      skipped: volumeStats.skipped + weightStats.skipped,
      manualReview: volumeStats.manualReview + weightStats.manualReview,
      dryRun: options.dryRun,
    },
    'FatSecret AI serving backfill finished',
  );
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret AI serving backfill failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

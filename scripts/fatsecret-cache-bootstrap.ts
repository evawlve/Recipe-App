#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';
import { logger } from '../src/lib/logger';
import { upsertFoodFromApi } from '../src/lib/fatsecret/cache';

interface BootstrapEntry {
  fatsecretId: string;
  legacyFoodId?: string;
  source?: string;
  note?: string;
}

interface CliOptions {
  presets: string[];
  files: string[];
  dryRun: boolean;
}

const PRESET_PATHS: Record<string, string> = {
  gold: 'data/fatsecret/bootstrap/gold.jsonl',
  curated: 'data/fatsecret/bootstrap/curated.jsonl',
  staples: 'data/fatsecret/bootstrap/staples.jsonl',
};

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const presets: string[] = [];
  const files: string[] = [];
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--preset=')) {
      presets.push(arg.split('=')[1]);
    } else if (arg === '--preset') {
      const next = args[i + 1];
      if (next) {
        presets.push(next);
        i += 1;
      }
    } else if (arg.startsWith('--file=')) {
      files.push(arg.split('=')[1]);
    } else if (arg === '--file') {
      const next = args[i + 1];
      if (next) {
        files.push(next);
        i += 1;
      }
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }

  if (presets.length === 0 && files.length === 0) {
    presets.push('gold', 'curated', 'staples');
  }

  return { presets, files, dryRun };
}

function loadEntriesFromFile(filePath: string): BootstrapEntry[] {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    logger.warn({ filePath: absolute }, 'Bootstrap file not found, skipping');
    return [];
  }

  const lines = fs.readFileSync(absolute, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const entries: BootstrapEntry[] = [];
  for (const line of lines) {
    if (line.startsWith('#')) continue;
    try {
      const parsed = JSON.parse(line);
      if (!parsed.fatsecretId) {
        logger.warn({ filePath: absolute, line }, 'fatsecretId missing in bootstrap entry');
        continue;
      }
      entries.push(parsed as BootstrapEntry);
    } catch (error) {
      logger.error({ filePath: absolute, line, err: error }, 'Failed to parse bootstrap entry');
    }
  }

  return entries;
}

function resolvePresetFiles(presets: string[]): string[] {
  const files: string[] = [];
  for (const preset of presets) {
    const normalized = preset.toLowerCase();
    const filePath = PRESET_PATHS[normalized];
    if (!filePath) {
      logger.warn({ preset }, 'Unknown preset');
      continue;
    }
    files.push(filePath);
  }
  return files;
}

async function hydrate(entries: BootstrapEntry[], dryRun: boolean) {
  if (entries.length === 0) {
    logger.info('No FatSecret bootstrap entries to hydrate');
    return;
  }

  logger.info({ count: entries.length, dryRun }, 'Bootstrapping FatSecret cache');

  let hydrated = 0;
  let failed = 0;

  for (const entry of entries) {
    const source = entry.source ?? 'bootstrap';
    if (dryRun) {
      logger.info({ fatsecretId: entry.fatsecretId, legacyFoodId: entry.legacyFoodId, source, note: entry.note }, 'Dry-run hydrate');
      hydrated += 1;
      continue;
    }

    try {
      await upsertFoodFromApi(entry.fatsecretId, {
        source,
        legacyFoodId: entry.legacyFoodId,
      });
      hydrated += 1;
      logger.info({ fatsecretId: entry.fatsecretId, source }, 'Hydrated FatSecret food');
    } catch (error) {
      failed += 1;
      logger.error({ fatsecretId: entry.fatsecretId, err: error }, 'Failed to hydrate bootstrap entry');
    }
  }

  logger.info({ hydrated, failed }, 'Bootstrap hydrate finished');
}

async function main() {
  const options = parseArgs();
  const presetFiles = resolvePresetFiles(options.presets);
  const files = [...presetFiles, ...options.files];

  const seen = new Set<string>();
  const records: BootstrapEntry[] = [];

  for (const file of files) {
    const entries = loadEntriesFromFile(file);
    for (const entry of entries) {
      if (!entry.fatsecretId) continue;
      if (seen.has(entry.fatsecretId)) continue;
      seen.add(entry.fatsecretId);
      records.push(entry);
    }
  }

  await hydrate(records, options.dryRun);
}

main()
  .catch((error) => {
    logger.error({ err: error }, 'FatSecret cache bootstrap failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

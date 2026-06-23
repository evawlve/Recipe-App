#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { logger } from '../src/lib/logger';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';

interface GoldRow {
  id: string;
  raw_line: string;
  expected_food_name?: string;
}

interface CuratedRow {
  id: string;
  name: string;
  brand?: string;
}

interface BootstrapEntry {
  fatsecretId: string;
  legacyFoodId?: string;
  source: string;
  note?: string;
}

interface ManifestStats {
  label: string;
  totalRows: number;
  mapped: number;
  deduped: number;
  duplicates: Array<{ fatsecretId: string; note?: string; source: string }>;
  failures: Array<{ rawLine: string; reason: string }>;
}

interface CliOptions {
  includeGold: boolean;
  includeCurated: boolean;
  goldFile: string;
  curatedDir: string;
  curatedFiles: string[];
  goldOutput: string;
  curatedOutput: string;
  goldLimit?: number;
  curatedLimit?: number;
  minConfidence?: number;
  dryRun: boolean;
}

function createManifestStats(label: string): ManifestStats {
  return {
    label,
    totalRows: 0,
    mapped: 0,
    deduped: 0,
    duplicates: [],
    failures: [],
  };
}

function parseArgs(): CliOptions {
  const scriptArgIndex = process.argv.findIndex((arg) =>
    arg.includes('fatsecret-cache-build-manifest'),
  );
  const args = scriptArgIndex >= 0 ? process.argv.slice(scriptArgIndex + 1) : process.argv.slice(2);
  let includeGold = false;
  let includeCurated = false;
  let goldFile = 'eval/gold.v3.csv';
  let curatedDir = 'data/curated';
  const curatedFiles: string[] = [];
  let goldOutput = 'data/fatsecret/bootstrap/gold.jsonl';
  let curatedOutput = 'data/fatsecret/bootstrap/curated.jsonl';
  let goldLimit: number | undefined;
  let curatedLimit: number | undefined;
  let minConfidence: number | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--gold') includeGold = true;
    else if (arg === '--curated') includeCurated = true;
    else if (arg === '--all') {
      includeGold = true;
      includeCurated = true;
    } else if (arg.startsWith('--gold-file=')) {
      goldFile = arg.split('=')[1];
    } else if (arg === '--gold-file') {
      const next = args[i + 1];
      if (next) {
        goldFile = next;
        i += 1;
      }
    } else if (arg.startsWith('--curated-dir=')) {
      curatedDir = arg.split('=')[1];
    } else if (arg === '--curated-dir') {
      const next = args[i + 1];
      if (next) {
        curatedDir = next;
        i += 1;
      }
    } else if (arg.startsWith('--curated-file=')) {
      curatedFiles.push(arg.split('=')[1]);
    } else if (arg === '--curated-file') {
      const next = args[i + 1];
      if (next) {
        curatedFiles.push(next);
        i += 1;
      }
    } else if (arg.startsWith('--gold-output=')) {
      goldOutput = arg.split('=')[1];
    } else if (arg === '--gold-output') {
      const next = args[i + 1];
      if (next) {
        goldOutput = next;
        i += 1;
      }
    } else if (arg.startsWith('--curated-output=')) {
      curatedOutput = arg.split('=')[1];
    } else if (arg === '--curated-output') {
      const next = args[i + 1];
      if (next) {
        curatedOutput = next;
        i += 1;
      }
    } else if (arg.startsWith('--gold-limit=')) {
      goldLimit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--curated-limit=')) {
      curatedLimit = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--min-confidence=')) {
      minConfidence = Number.parseFloat(arg.split('=')[1]);
    } else if (arg === '--dry-run' || arg === '-n') {
      dryRun = true;
    } else if (arg.startsWith('--dry-run=')) {
      const value = arg.split('=')[1];
      dryRun = value !== 'false' && value !== '0';
    }
  }

  if (!includeGold && !includeCurated) {
    includeGold = true;
    includeCurated = true;
  }

  return {
    includeGold,
    includeCurated,
    goldFile,
    curatedDir,
    curatedFiles,
    goldOutput,
    curatedOutput,
    goldLimit,
    curatedLimit,
      minConfidence,
    dryRun,
  };
}

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function readCsvRows<T = Record<string, string>>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV file not found: ${filePath}`);
  }
  const csv = fs.readFileSync(filePath, 'utf-8');
  const { data, errors } = Papa.parse<T>(csv, {
    header: true,
    skipEmptyLines: true,
  });
  if (errors.length > 0) {
    const message = errors.map((err) => `${err.message} @ ${err.row}`).join('; ');
    throw new Error(`Failed to parse CSV ${filePath}: ${message}`);
  }
  return data;
}

interface MapResult {
  entry: BootstrapEntry | null;
  failureReason?: string;
}

async function mapRawLine(
  rawLine: string,
  opts: { source: string; legacyFoodId?: string; minConfidence?: number; note?: string },
): Promise<MapResult> {
  try {
    const mapped = await mapIngredientWithFatsecret(rawLine, { minConfidence: opts.minConfidence });
    if (!mapped) {
      logger.warn({ rawLine }, 'Failed to map ingredient via FatSecret');
      return { entry: null, failureReason: 'no_match' };
    }
    if (opts.minConfidence != null && mapped.confidence < opts.minConfidence) {
      logger.warn({ rawLine, confidence: mapped.confidence }, 'FatSecret match below min confidence');
      return { entry: null, failureReason: 'below_min_confidence' };
    }
    return {
      entry: {
        fatsecretId: mapped.foodId,
        legacyFoodId: opts.legacyFoodId,
        source: opts.source,
        note: opts.note ?? rawLine,
      },
    };
  } catch (error) {
    logger.error({ rawLine, err: error }, 'FatSecret lookup failed');
    return { entry: null, failureReason: 'lookup_error' };
  }
}

async function buildGoldEntries(options: CliOptions): Promise<{ entries: BootstrapEntry[]; stats: ManifestStats }> {
  logger.info({ file: options.goldFile, limit: options.goldLimit }, 'Building gold manifest');
  const rows = readCsvRows<GoldRow>(options.goldFile).slice(0, options.goldLimit ?? undefined);
  const entries: BootstrapEntry[] = [];
  const stats = createManifestStats('gold');
  stats.totalRows = rows.length;

  for (const row of rows) {
    const rawLine = row.raw_line?.trim();
    if (!rawLine) continue;
    const result = await mapRawLine(rawLine, {
      source: 'gold',
      minConfidence: options.minConfidence,
      note: row.expected_food_name ?? rawLine,
    });
    if (result.entry) {
      entries.push(result.entry);
      stats.mapped += 1;
    } else {
      stats.failures.push({ rawLine, reason: result.failureReason ?? 'unknown' });
    }
  }
  return { entries, stats };
}

function listCuratedCsvFiles(options: CliOptions): string[] {
  if (options.curatedFiles.length > 0) {
    return options.curatedFiles;
  }
  if (!fs.existsSync(options.curatedDir)) {
    throw new Error(`Curated directory not found: ${options.curatedDir}`);
  }
  return fs
    .readdirSync(options.curatedDir)
    .filter((file) => file.endsWith('.csv'))
    .map((file) => path.join(options.curatedDir, file));
}

async function buildCuratedEntries(options: CliOptions): Promise<{ entries: BootstrapEntry[]; stats: ManifestStats }> {
  const csvFiles = listCuratedCsvFiles(options);
  logger.info({ files: csvFiles.length, limit: options.curatedLimit }, 'Building curated manifest');
  const entries: BootstrapEntry[] = [];
  const stats = createManifestStats('curated');
  let processed = 0;

  for (const file of csvFiles) {
    const rows = readCsvRows<CuratedRow>(file);
    for (const row of rows) {
      if (!row?.name) continue;
      if (options.curatedLimit && processed >= options.curatedLimit) {
        stats.totalRows = processed;
        return { entries, stats };
      }
      processed += 1;
      const rawLine = row.brand ? `${row.brand} ${row.name}` : row.name;
      const result = await mapRawLine(rawLine, {
        source: 'curated',
        legacyFoodId: row.id,
        minConfidence: options.minConfidence,
        note: `${row.name}${row.brand ? ` (${row.brand})` : ''}`,
      });
      if (result.entry) {
        entries.push(result.entry);
        stats.mapped += 1;
      } else {
        stats.failures.push({ rawLine, reason: result.failureReason ?? 'unknown' });
      }
    }
  }
  stats.totalRows = processed;
  return { entries, stats };
}

function writeManifest(entries: BootstrapEntry[], filePath: string, dryRun: boolean, stats?: ManifestStats) {
  const unique = new Map<string, BootstrapEntry>();
  for (const entry of entries) {
    if (unique.has(entry.fatsecretId)) {
      stats?.duplicates.push({
        fatsecretId: entry.fatsecretId,
        note: entry.note,
        source: entry.source,
      });
      continue;
    }
    unique.set(entry.fatsecretId, entry);
  }
  const finalEntries = Array.from(unique.values());
  if (stats) {
    stats.deduped = entries.length - finalEntries.length;
    logger.info(
      {
        filePath,
        dryRun,
        label: stats.label,
        uniqueEntries: finalEntries.length,
        totalRows: stats.totalRows,
        mapped: stats.mapped,
        deduped: stats.deduped,
        failures: stats.failures.length,
        duplicates: stats.duplicates.length,
      },
      'Prepared FatSecret manifest',
    );
  } else {
    logger.info({ count: finalEntries.length, filePath, dryRun }, 'Prepared FatSecret manifest');
  }

  if (dryRun) {
    finalEntries.slice(0, 5).forEach((entry) => logger.info({ sample: entry }, 'Manifest preview'));
    if (stats) {
      logger.info(
        {
          label: stats.label,
          failureSample: stats.failures.slice(0, 5),
          duplicateSample: stats.duplicates.slice(0, 5),
        },
        'Manifest diagnostics (dry run)',
      );
    }
    return;
  }

  ensureDir(filePath);
  const stream = fs.createWriteStream(filePath, { flags: 'w' });
  for (const entry of finalEntries) {
    stream.write(`${JSON.stringify(entry)}\n`);
  }
  stream.end();

  if (stats) {
    writeDiagnostics(filePath, stats);
  }
}

function writeDiagnostics(filePath: string, stats: ManifestStats) {
  const basePath = filePath.replace(/\.jsonl$/, '');
  if (stats.failures.length > 0) {
    const failuresPath = `${basePath}.failures.jsonl`;
    const failureStream = fs.createWriteStream(failuresPath, { flags: 'w' });
    for (const failure of stats.failures) {
      failureStream.write(`${JSON.stringify(failure)}\n`);
    }
    failureStream.end();
    logger.info({ failures: stats.failures.length, failuresPath }, 'Wrote manifest failure diagnostics');
  }

  if (stats.duplicates.length > 0) {
    const duplicatesPath = `${basePath}.duplicates.jsonl`;
    const duplicatesStream = fs.createWriteStream(duplicatesPath, { flags: 'w' });
    for (const duplicate of stats.duplicates) {
      duplicatesStream.write(`${JSON.stringify(duplicate)}\n`);
    }
    duplicatesStream.end();
    logger.info({ duplicates: stats.duplicates.length, duplicatesPath }, 'Wrote manifest duplicate diagnostics');
  }
}

async function main() {
  const options = parseArgs();
  if (options.includeGold) {
    const { entries, stats } = await buildGoldEntries(options);
    writeManifest(entries, options.goldOutput, options.dryRun, stats);
  }

  if (options.includeCurated) {
    const { entries, stats } = await buildCuratedEntries(options);
    writeManifest(entries, options.curatedOutput, options.dryRun, stats);
  }
}

main().catch((error) => {
  logger.error({ err: error }, 'Failed to build FatSecret manifests');
  process.exitCode = 1;
});

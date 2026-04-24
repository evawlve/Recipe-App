/**
 * Purge Bad ValidatedMapping Entries — Phase 6 Cache Quality Audit
 *
 * Reads logs/to_delete.json (curated by human reviewer after running
 * audit-validated-mappings.ts) and deletes the specified entries.
 *
 * Each entry in to_delete.json must have:
 *   { normalizedForm: string, source: string }
 *
 * All deletions are logged with timestamp and reason.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/purge-bad-mappings.ts
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/purge-bad-mappings.ts --dry-run
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ToDeleteEntry {
    normalizedForm: string;
    source: string;
    foodName?: string;
    reason?: string;
}

async function main() {
    const isDryRun = process.argv.includes('--dry-run');

    const toDeletePath = path.join(__dirname, '..', 'logs', 'to_delete.json');

    if (!fs.existsSync(toDeletePath)) {
        console.error(`❌ to_delete.json not found at: ${toDeletePath}`);
        console.error('   Run audit-validated-mappings.ts first, then curate the file.');
        process.exit(1);
    }

    const toDelete: ToDeleteEntry[] = JSON.parse(fs.readFileSync(toDeletePath, 'utf-8'));

    if (!Array.isArray(toDelete) || toDelete.length === 0) {
        console.log('⚠️  to_delete.json is empty — nothing to purge.');
        process.exit(0);
    }

    console.log(`🗑️  Purge Bad Mappings${isDryRun ? ' [DRY RUN]' : ''}`);
    console.log(`   Entries to process: ${toDelete.length}`);
    console.log('');

    const logLines: string[] = [
        `Purge log — ${new Date().toISOString()}${isDryRun ? ' [DRY RUN]' : ''}`,
        `Entries in to_delete.json: ${toDelete.length}`,
        '',
    ];

    let deleted = 0;
    let notFound = 0;
    let errors = 0;

    for (const entry of toDelete) {
        if (!entry.normalizedForm || !entry.source) {
            console.warn(`⚠️  Skipping invalid entry (missing normalizedForm or source):`, entry);
            logLines.push(`SKIP (invalid) — ${JSON.stringify(entry)}`);
            continue;
        }

        try {
            const existing = await prisma.validatedMapping.findUnique({
                where: {
                    normalizedForm_source: {
                        normalizedForm: entry.normalizedForm,
                        source: entry.source as 'fatsecret' | 'fdc',
                    },
                },
            });

            if (!existing) {
                console.log(`⏭️  Not found (already clean): "${entry.normalizedForm}" [${entry.source}]`);
                logLines.push(`NOT_FOUND — "${entry.normalizedForm}" [${entry.source}] — ${entry.reason ?? 'no reason'}`);
                notFound++;
                continue;
            }

            const line = `"${entry.normalizedForm}" → "${existing.foodName}"${existing.brandName ? ` (${existing.brandName})` : ''}  [usedCount: ${existing.usedCount}]  reason: ${entry.reason ?? 'no reason'}`;

            if (isDryRun) {
                console.log(`🔍 WOULD DELETE: ${line}`);
                logLines.push(`DRY_RUN DELETE — ${line}`);
            } else {
                await prisma.validatedMapping.delete({
                    where: { id: existing.id },
                });
                console.log(`✅ Deleted: ${line}`);
                logLines.push(`DELETED — ${line} — at ${new Date().toISOString()}`);
                deleted++;
            }
        } catch (err) {
            const msg = (err as Error).message;
            console.error(`❌ Error processing "${entry.normalizedForm}": ${msg}`);
            logLines.push(`ERROR — "${entry.normalizedForm}" [${entry.source}] — ${msg}`);
            errors++;
        }
    }

    // ── Write purge log ────────────────────────────────────────────────────────
    logLines.push('');
    logLines.push(`Summary: deleted=${deleted}, notFound=${notFound}, errors=${errors}`);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logDir = path.join(__dirname, '..', 'logs');
    const logPath = path.join(logDir, `purge-mappings-${timestamp}${isDryRun ? '-dryrun' : ''}.txt`);
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(logPath, logLines.join('\n'), 'utf-8');

    console.log('');
    console.log('══════════════════════════════════════');
    console.log('  PURGE SUMMARY');
    console.log('══════════════════════════════════════');
    console.log(`  Deleted  : ${deleted}`);
    console.log(`  Not found: ${notFound}`);
    console.log(`  Errors   : ${errors}`);
    console.log(`  Log      : ${logPath}`);

    if (isDryRun) {
        console.log('');
        console.log('  ℹ️  DRY RUN — no changes made. Remove --dry-run to execute.');
    }

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    prisma.$disconnect();
    process.exit(1);
});

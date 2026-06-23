import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';
import { execSync } from 'child_process';

const INGREDIENTS = [
    'palm sugar',
    '0.5 cup unpacked palm sugar',
    'rice vinegar',
    '5 large green onion',
    '1 jalapeno',
    '0.25 tsp crushed red pepper flakes',
    '0.25 cup fat free liquid egg substitute',
    '1 blood orange peel',
];

async function main() {
    const lines: string[] = [];
    const log = (s: string) => { lines.push(s); console.log(s); };

    // Step 1: NUKE entire AiNormalizeCache
    log('=== CLEARING ENTIRE AiNormalizeCache ===');
    const normDeleted = await prisma.aiNormalizeCache.deleteMany({});
    log('Deleted ' + normDeleted.count + ' AiNormalizeCache entries');

    // Step 2: Clear ValidatedMapping for test ingredients
    log('\n=== CLEARING ValidatedMapping for test ingredients ===');
    const searchTerms = ['palm sugar', 'rice vinegar', 'green onion', 'jalapeno',
        'pepper flakes', 'egg substitute', 'blood orange', 'vinegar', 'onion',
        'red pepper', 'orange peel'];
    let vmTotal = 0;
    for (const t of searchTerms) {
        const d = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: { contains: t, mode: 'insensitive' } },
                    { normalizedForm: { contains: t, mode: 'insensitive' } },
                ]
            }
        });
        if (d.count > 0) {
            log('  Deleted ' + d.count + ' ValidatedMapping for: ' + t);
            vmTotal += d.count;
        }
    }
    log('Total ValidatedMapping deleted: ' + vmTotal);

    log('\n=== TESTING ALL INGREDIENTS (fresh, no cache) ===\n');

    for (const ing of INGREDIENTS) {
        log('--- ' + ing + ' ---');
        try {
            const output = execSync(
                'npx tsx scripts/debug-full-pipeline.ts --ingredient "' + ing + '"',
                { cwd: process.cwd(), timeout: 120000, env: { ...process.env, DEBUG: '' }, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
            );

            // Parse the output for key fields
            const lines2 = output.split('\n');
            const selectedLine = lines2.find(l => l.includes('Selected:') && !l.includes('Pre-Run') && !l.includes('Post-Run'));
            const confLine = lines2.find(l => l.match(/^\s+Confidence:\s+[\d.]/));
            const macrosLine = lines2.find(l => l.includes('Macros:'));
            const failLine = lines2.find(l => l.includes('FAILED'));

            if (selectedLine && confLine) {
                const selected = selectedLine.replace(/.*Selected:\s*/, '').trim();
                const conf = confLine.replace(/.*Confidence:\s*/, '').trim();
                const macros = macrosLine ? macrosLine.replace(/.*Macros:\s*/, '').trim() : 'unknown';
                log('  ✅ ' + selected);
                log('  Confidence: ' + conf);
                log('  Macros: ' + macros);
            } else if (failLine) {
                log('  ❌ FAILED - No mapping result');
            } else {
                log('  ⚠️  Could not parse result');
            }
        } catch (e: any) {
            const stderr = e.stderr?.toString() || '';
            const stdout = e.stdout?.toString() || '';
            if (stdout.includes('FAILED')) {
                log('  ❌ FAILED - No mapping result');
            } else {
                log('  ❌ ERROR: ' + (e.message?.slice(0, 200) || 'unknown'));
            }
        }
        log('');
    }

    writeFileSync('logs/test-all-failing.txt', lines.join('\n'));
    log('Results written to logs/test-all-failing.txt');
    await prisma.$disconnect();
}
main();

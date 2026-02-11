import { prisma } from '../src/lib/db';
import { writeFileSync } from 'fs';

async function main() {
    const lines: string[] = [];
    const log = (s: string) => { lines.push(s); };

    const count = await prisma.aiNormalizeCache.count();
    log('Total AiNormalizeCache entries: ' + count);
    log('');

    log('=== AiNormalizeCache ===');
    const terms = ['palm sugar', 'rice vinegar', 'green onion', 'jalapeno', 'pepper flakes', 'egg substitute', 'blood orange'];
    for (const t of terms) {
        const entries = await prisma.aiNormalizeCache.findMany({
            where: { normalizedName: { contains: t, mode: 'insensitive' } },
            take: 5
        });
        if (entries.length > 0) {
            for (const x of entries) {
                log('  KEY: ' + x.normalizedKey);
                log('  normalizedName: ' + x.normalizedName);
                log('  canonicalBase: ' + (x.canonicalBase || 'null'));
                log('  synonyms: ' + JSON.stringify(x.synonyms));
                log('  kcal/100g: ' + (x.estimatedCaloriesPer100g ?? 'null'));
                log('  protein/100g: ' + (x.estimatedProteinPer100g ?? 'null'));
                log('  carbs/100g: ' + (x.estimatedCarbsPer100g ?? 'null'));
                log('  fat/100g: ' + (x.estimatedFatPer100g ?? 'null'));
                log('');
            }
        } else {
            log('  NOT_FOUND: ' + t);
            log('');
        }
    }

    log('=== ValidatedMapping ===');
    for (const t of terms) {
        const vm = await prisma.validatedMapping.findMany({
            where: {
                OR: [
                    { rawIngredient: { contains: t, mode: 'insensitive' } },
                    { normalizedForm: { contains: t, mode: 'insensitive' } }
                ]
            },
            take: 5
        });
        if (vm.length > 0) {
            for (const v of vm) {
                log('  RAW: ' + v.rawIngredient);
                log('  NORM: ' + v.normalizedForm);
                log('  FOOD: ' + v.foodName + (v.brandName ? ' (' + v.brandName + ')' : ''));
                log('  CONF: ' + v.aiConfidence + ' | SRC: ' + v.source);
                log('  IS_ALIAS: ' + v.isAlias);
                log('');
            }
        } else {
            log('  NOT_FOUND: ' + t);
            log('');
        }
    }

    writeFileSync('logs/cache-inspection.txt', lines.join('\n'));
    console.log('Written to logs/cache-inspection.txt');
    await prisma.$disconnect();
}
main();

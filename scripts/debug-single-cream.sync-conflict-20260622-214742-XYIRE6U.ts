
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { logger } from '../src/lib/logger';
import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'logs', 'debug-single-cream.log');

function log(msg: string) {
    fs.appendFileSync(LOG_FILE, msg + '\n');
    process.stdout.write(msg + '\n');
}

async function main() {
    // Clear log file
    if (fs.existsSync(LOG_FILE)) fs.unlinkSync(LOG_FILE);
    // Ensure dir exists
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

    const rawLine = "3 fl oz single cream";

    log(`\n🔍 Debugging: "${rawLine}"\n`);
    log('='.repeat(60));

    // 1. Test Parser
    const parsed = parseIngredientLine(rawLine);
    log('1. Parser Result:');
    log(JSON.stringify(parsed, null, 2));

    // 2. Test Normalization
    const normalized = normalizeIngredientName(parsed?.name || rawLine);
    log('\n2. Normalization Result:');
    log(JSON.stringify(normalized, null, 2));

    // 3. Test Mapping Pipeline (WITH CACHE)
    log('\n3. Running mapIngredientWithFallback (debug=true, skipCache=FALSE)...');

    // Hack logger
    logger.info = (msg: string, meta?: any) => log(`[INFO] ${msg} ${meta ? JSON.stringify(meta) : ''}`);
    logger.warn = (msg: string, meta?: any) => log(`[WARN] ${msg} ${meta ? JSON.stringify(meta) : ''}`);
    logger.debug = (msg: string, meta?: any) => { };

    try {
        const result = await mapIngredientWithFallback(rawLine, {
            debug: true,
            skipCache: false,
            minConfidence: 0.1,
        });

        log('\n4. Final Result:');
        if (result) {
            log(`   ✅ Mapped to: "${result.foodName}" (Score: ${result.confidence.toFixed(3)})`);
            log(`      Food ID: ${result.foodId}`);
            log(`      Serving: ${result.servingDescription}`);
            log(`      Grams: ${result.grams}`);
            log(`      Source: ${result.source}`);

            // Inspect Cache for this Food ID
            log(`\n5. Inspecting Cache for Food ID ${result.foodId}...`);
            const cachedFood = await prisma.fatSecretFoodCache.findUnique({
                where: { id: result.foodId },
                include: { servings: true }
            });

            if (cachedFood) {
                log(`   Cached Name: ${cachedFood.name}`);
                log(`   Servings in DB (${cachedFood.servings.length}):`);
                cachedFood.servings.forEach(s => {
                    log(`     - ID: ${s.id}`);
                    log(`       MeasDesc: "${s.measurementDescription}"`);
                    log(`       Metric: ${s.metricServingAmount}${s.metricServingUnit}`);
                });
            } else {
                log('   ❌ Food not found in FatSecretFoodCache!');
            }

        } else {
            log('   ❌ No mapping found');
        }

    } catch (err) {
        log(`Error: ${err}`);
    } finally {
        await prisma.$disconnect();
    }
}

main();

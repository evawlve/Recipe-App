import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { normalizeIngredientName, canonicalizeCacheKey } from '../src/lib/fatsecret/normalization-rules';
import { saveValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';

async function main() {
    console.log('🚀 Starting Fast-Path FDC Cache to ValidatedMapping Conversion...');

    // 1. Get all FdcFoodCache entries that have a corresponding FdcServingCache entry
    // We need a serving to make the mapping usable.
    const fdcFoods = await prisma.fdcFoodCache.findMany({
        where: {
            servings: {
                some: {} // Must have at least one serving
            }
        },
        include: {
            servings: true
        }
    });

    console.log(`Found ${fdcFoods.length} FDC foods with servings.`);

    let converted = 0;
    let skippedExisting = 0;
    let skippedFilter = 0;
    let skippedMissingMacros = 0;

    for (const food of fdcFoods) {
        // Skip obvious bad categories
        const badCategories = ['Baby Foods', 'Restaurant Foods', 'Fast Foods'];
        const isBadCat = badCategories.some(cat => food.description.toLowerCase().includes(cat.toLowerCase()));
        if (isBadCat) {
            skippedFilter++;
            continue;
        }

        // Validate macros
        const nutrients: any = food.nutrients;
        if (!nutrients || nutrients.calories == null || nutrients.protein == null || nutrients.carbs == null || nutrients.fat == null) {
            skippedMissingMacros++;
            continue;
        }
        
        // Atwater sanity check (skip wildly inaccurate label data)
        const expectedKcal = (nutrients.protein * 4) + (nutrients.carbs * 4) + (nutrients.fat * 9);
        const actualKcal = nutrients.calories || 0;
        if (expectedKcal > 0 && (actualKcal < expectedKcal * 0.7 || actualKcal > expectedKcal * 1.3)) {
             skippedFilter++;
             continue; // Macros don't add up
        }

        // Build mock FatsecretMappedIngredient
        const mapping = {
            source: 'fdc' as const,
            foodId: `fdc_${food.id}`,
            foodName: food.description,
            brandName: food.brandName || null,
            servingId: food.servings[0].id.toString(),
            servingDescription: food.servings[0].description,
            grams: food.servings[0].gramWeight,
            kcal: actualKcal,
            protein: nutrients.protein,
            carbs: nutrients.carbs,
            fat: nutrients.fat,
            confidence: 0.95, // High confidence since it's directly from FDC
            quality: 'high' as const,
            rawLine: `1 serving ${food.description}`,
        };

        const { cleaned: normalized } = normalizeIngredientName(food.description);
        if (!normalized || normalized.length < 3) {
            skippedFilter++;
            continue;
        }

        let normalizedForm = canonicalizeCacheKey(normalized);
        if (!normalizedForm) {
            skippedFilter++;
            continue;
        }
        
        // Brand logic (Option A emulation for fast path)
        if (food.brandName) {
             const brandLower = food.brandName.toLowerCase().trim();
             if (!normalizedForm.includes(brandLower)) {
                 normalizedForm = `${brandLower} ${normalizedForm}`;
             }
        }

        // Check if already exists in ValidatedMapping
        const existing = await prisma.validatedMapping.findFirst({
            where: {
                normalizedForm,
                source: 'fdc'
            }
        });

        if (existing) {
            skippedExisting++;
            continue;
        }

        // Save it!
        await saveValidatedMapping(`1 serving ${food.description} [${food.id}]`, mapping as any, {
            approved: true,
            confidence: 0.95,
            reason: 'bulk_seed_fdc_fast_path',
        }, {
            normalizedForm
        });

        converted++;
        if (converted % 500 === 0) {
            console.log(`...converted ${converted} entries...`);
        }
    }

    console.log('\\n✅ Fast-Path Conversion Complete!');
    console.log(`Total scanned     : ${fdcFoods.length}`);
    console.log(`Successfully added: ${converted}`);
    console.log(`Skipped (existing): ${skippedExisting}`);
    console.log(`Skipped (filtered): ${skippedFilter}`);
    console.log(`Skipped (no macros): ${skippedMissingMacros}`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());

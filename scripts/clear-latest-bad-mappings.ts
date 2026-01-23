/**
 * Clear all bad mappings identified in the latest mapping analysis
 * 
 * Run with: npx tsx scripts/clear-latest-bad-mappings.ts
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

// All problematic mappings from the latest analysis
const BAD_MAPPINGS = [
    // ========================================
    // 🚨 Critical False Positives
    // ========================================
    
    // Ice cubes → Ice Breakers (mint/gum brand)
    { rawIngredient: '%ice cube%' },
    { rawIngredient: '%cup ice%' },
    { rawIngredient: '%ice%', foodName: '%ice breakers%' },
    
    // Plum tomatoes → Plum fruit
    { rawIngredient: '%plum tomato%' },
    
    // Graham cracker → Cake
    { rawIngredient: '%graham cracker%', foodName: '%cake%' },
    { rawIngredient: '%grahm cracker%', foodName: '%cake%' },
    
    // Vegetarian egg replacer → Egg
    { rawIngredient: '%egg replacer%' },
    { rawIngredient: '%vegetarian egg%' },
    
    // Better Than Sour Cream (vegan) → Sour Cream (dairy)
    { rawIngredient: '%better than sour cream%' },
    { rawIngredient: '%better than%sour cream%' },
    
    // Chocolate Ice Pop → Ice Cream
    { rawIngredient: '%ice pop%', foodName: '%ice cream%' },
    { rawIngredient: '%chocolate ice pop%' },
    
    // Mixed seeds bread → Seeds
    { rawIngredient: '%seeds bread%' },
    { rawIngredient: '%mixed seeds bread%' },
    
    // ========================================
    // ⚠️ Wildly Incorrect Serving Sizes
    // ========================================
    
    // Wine - serving size bugs
    { rawIngredient: '%fl oz%wine%' },
    { rawIngredient: '%fl oz%red wine%' },
    { rawIngredient: '%serving red wine%' },
    
    // Sugar - tiny servings
    { rawIngredient: '%tbsp sugar%' },
    { rawIngredient: '%cup sugar%' },
    { rawIngredient: '%granulated sugar%' },
    
    // Coconut flakes - tiny servings
    { rawIngredient: '%coconut flakes%' },
    { rawIngredient: '%tbsp coconut%' },
    
    // Cherry tomatoes - wrong count
    { rawIngredient: '%cherry tomato%' },
    { rawIngredient: '%cherries tomato%' },
    
    // Black olives - wrong count
    { rawIngredient: '%black olive%' },
    
    // Avocado slices - wrong serving
    { rawIngredient: '%slice%avocado%' },
    
    // Sun-dried tomatoes - wrong pieces
    { rawIngredient: '%sun-dried tomato%' },
    { rawIngredient: '%sundried tomato%' },
    
    // Rice wine vinegar - wrong calories
    { rawIngredient: '%rice%vinegar%' },
    { rawIngredient: '%rice wine vinegar%' },
    
    // Low calorie sugar substitute - should be 0 cal
    { rawIngredient: '%sugar substitute%' },
    { rawIngredient: '%low calorie%sugar%' },
    
    // ========================================
    // 🔸 Fat Modifier Mismatches
    // ========================================
    
    // Low fat yogurt → Plain Yogurt
    { rawIngredient: '%low fat%yogurt%' },
    { rawIngredient: '%yogurt%low fat%' },
    
    // Nonfat Italian dressing → Light (still has fat)
    { rawIngredient: '%nonfat%dressing%' },
    { rawIngredient: '%nonfat%italian%' },
    
    // Light cream cheese → regular Cream Cheese
    { rawIngredient: '%light cream cheese%' },
    { rawIngredient: '%light%cream cheese%' },
    
    // Light whipping cream → Heavy Whipping Cream
    { rawIngredient: '%light%whipping cream%' },
    { rawIngredient: '%light whipping%' },
    
    // Mozzarella with unwanted part-skim modifier
    { rawIngredient: '%mozzarella%', foodName: '%part-skim%' },
    { rawIngredient: '%mozzarella%', foodName: '%part skim%' },
    
    // ========================================
    // 🔹 Questionable Macros (wrong food matched)
    // ========================================
    
    // Potatoes with high fat (Denny's version)
    { rawIngredient: '%potato%', foodName: '%denny%' },
    { rawIngredient: '%red potato%', foodName: '%denny%' },
    
    // Lentils with high fat
    { rawIngredient: '%lentil%' },
    
    // Kalamata olives with inverted macros
    { rawIngredient: '%kalamata%' },
];

async function main() {
    console.log('🧹 Clearing all bad mappings from latest analysis...\n');
    console.log('=' .repeat(60));

    let totalDeleted = 0;
    const errors: string[] = [];

    for (const mapping of BAD_MAPPINGS) {
        const whereClause: any = {};

        if (mapping.rawIngredient) {
            // Handle patterns with multiple wildcards
            const pattern = mapping.rawIngredient.replace(/%/g, '');
            whereClause.rawIngredient = {
                contains: pattern,
                mode: 'insensitive',
            };
        }

        if ('foodName' in mapping && mapping.foodName) {
            const foodPattern = mapping.foodName.replace(/%/g, '');
            whereClause.foodName = {
                contains: foodPattern,
                mode: 'insensitive',
            };
        }

        try {
            const matches = await prisma.validatedMapping.findMany({
                where: whereClause,
                select: { id: true, rawIngredient: true, foodName: true },
            });

            if (matches.length > 0) {
                const foodFilter = 'foodName' in mapping ? ` → "${mapping.foodName}"` : '';
                console.log(`\n📋 "${mapping.rawIngredient}"${foodFilter}`);
                console.log(`   Found ${matches.length} entries:`);
                
                for (const m of matches.slice(0, 3)) {
                    console.log(`   - "${m.rawIngredient}" → "${m.foodName}"`);
                }
                if (matches.length > 3) {
                    console.log(`   ... and ${matches.length - 3} more`);
                }

                const deleted = await prisma.validatedMapping.deleteMany({
                    where: { id: { in: matches.map(m => m.id) } },
                });

                totalDeleted += deleted.count;
                console.log(`   ✅ Deleted ${deleted.count} entries`);
            }
        } catch (err) {
            const errorMsg = `Error for pattern "${mapping.rawIngredient}": ${(err as Error).message}`;
            errors.push(errorMsg);
            console.error(`   ❌ ${errorMsg}`);
        }
    }

    console.log('\n' + '=' .repeat(60));
    console.log(`\n🎯 Total deleted: ${totalDeleted} bad cache entries`);
    
    if (errors.length > 0) {
        console.log(`\n⚠️ ${errors.length} errors occurred during cleanup`);
    }

    console.log('\n📝 Next steps:');
    console.log('   1. Run the batch import to re-map these ingredients');
    console.log('   2. The updated filtering logic will now apply correctly');
    console.log('   3. Check the new mapping-summary file for improvements\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());




















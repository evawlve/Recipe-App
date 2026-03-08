#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';

// Top 100 most common ingredients in recipes
const TOP_INGREDIENTS = [
    // Proteins
    'chicken breast', 'ground beef', 'bacon', 'eggs', 'salmon', 'shrimp', 'pork chops',
    'chicken thighs', 'turkey breast', 'tuna', 'ground turkey', 'ham', 'sausage',

    // Dairy
    'milk', 'butter', 'cheese', 'cheddar cheese', 'mozzarella cheese', 'parmesan cheese',
    'cream cheese', 'sour cream', 'heavy cream', 'yogurt', 'feta cheese',

    // Vegetables
    'onion', 'garlic', 'tomato', 'potato', 'carrot', 'celery', 'bell pepper',
    'broccoli', 'spinach', 'mushrooms', 'zucchini', 'cucumber', 'lettuce',
    'green beans', 'corn', 'peas', 'cabbage', 'cauliflower', 'kale',
    'red onion', 'green onion', 'jalapeño', 'red bell pepper',

    // Grains & Starches
    'flour', 'rice', 'pasta', 'bread', 'spaghetti', 'quinoa', 'oats',
    'brown rice', 'white rice', 'breadcrumbs', 'tortillas',

    // Oils & Fats
    'olive oil', 'vegetable oil', 'coconut oil', 'canola oil', 'sesame oil',

    // Seasonings & Spices
    'salt', 'black pepper', 'garlic powder', 'onion powder', 'paprika',
    'cumin', 'chili powder', 'oregano', 'basil', 'thyme', 'rosemary',
    'cinnamon', 'ginger', 'cayenne pepper', 'red pepper flakes',

    // Condiments & Sauces
    'soy sauce', 'worcestershire sauce', 'hot sauce', 'ketchup', 'mustard',
    'mayonnaise', 'ranch dressing', 'balsamic vinegar', 'red wine vinegar',
    'apple cider vinegar', 'honey', 'maple syrup', 'bbq sauce',

    // Baking
    'sugar', 'brown sugar', 'baking powder', 'baking soda', 'vanilla extract',
    'cocoa powder', 'chocolate chips', 'powdered sugar',

    // Canned/Packaged
    'chicken broth', 'beef broth', 'vegetable broth', 'tomato sauce',
    'tomato paste', 'diced tomatoes', 'black beans', 'kidney beans',
    'chickpeas', 'coconut milk',

    // Fruits
    'lemon', 'lime', 'apple', 'banana', 'strawberries', 'blueberries',
    'orange', 'avocado', 'pineapple',

    // Nuts & Seeds
    'almonds', 'walnuts', 'pecans', 'peanuts', 'cashews', 'sunflower seeds'
];

async function main() {
    console.log('\n🌱 Pre-populating Global Cache with Top 100 Ingredients\n');
    console.log('This will speed up future imports significantly!\n');

    let cached = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < TOP_INGREDIENTS.length; i++) {
        const ingredient = TOP_INGREDIENTS[i];
        const normalizedName = normalizeIngredientName(ingredient).cleaned;

        // Check if already cached
        const existing = await (prisma as any).globalIngredientMapping.findUnique({
            where: { normalizedName }
        });

        if (existing) {
            console.log(`${i + 1}/${TOP_INGREDIENTS.length} ⏭️  "${ingredient}" - Already cached`);
            skipped++;
            continue;
        }

        try {
            console.log(`${i + 1}/${TOP_INGREDIENTS.length} 🔍 Mapping "${ingredient}"...`);

            // Map with FatSecret
            const mapped = await mapIngredientWithFatsecret(`1 ${ingredient}`, {
                minConfidence: 0.4,  // Lower threshold to get something
                debug: false
            });

            if (mapped && mapped.confidence >= 0.6) {
                // Cache it!
                await (prisma as any).globalIngredientMapping.create({
                    data: {
                        normalizedName,
                        fatsecretFoodId: mapped.foodId,
                        fatsecretServingId: mapped.servingId,
                        confidence: mapped.confidence,
                        source: 'fatsecret',
                        createdBy: 'prepopulate',
                        usageCount: 0
                    }
                });

                console.log(`   ✅ Cached! (confidence: ${(mapped.confidence * 100).toFixed(0)}%)`);
                cached++;
            } else {
                console.log(`   ⚠️  Low confidence or no match - skipped`);
                failed++;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));

        } catch (err) {
            console.log(`   ❌ Error: ${(err as Error).message}`);
            failed++;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Pre-population Complete!\n`);
    console.log(`Cached: ${cached} new ingredients`);
    console.log(`Skipped: ${skipped} (already cached)`);
    console.log(`Failed: ${failed} (low confidence or error)`);
    console.log(`\nTotal in cache: ${cached + skipped}`);
    console.log(`\n💡 Future imports will be much faster with ${cached + skipped} ingredients pre-cached!\n`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

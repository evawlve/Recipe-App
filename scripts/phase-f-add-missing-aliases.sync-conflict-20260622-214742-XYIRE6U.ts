#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

/**
 * Phase F: Add missing aliases for existing foods
 * Focus on common variations that might cause NO MATCH or WRONG MATCH
 */

const ALIAS_ADDITIONS = [
  // Broccoli variations
  {
    foodName: 'broccoli, raw',
    aliases: ['broccoli florets', 'florets', 'broccoli, florets']
  },
  {
    foodName: 'Broccoli, Raw',
    aliases: ['broccoli florets', 'florets', 'broccoli, florets']
  },
  
  // Tomato variations
  {
    foodName: 'tomatoes, red, ripe, raw',
    aliases: ['tomato, diced', 'tomato, chopped', 'tomato, sliced', 'tomatoes, diced', 'tomatoes, chopped', 'tomatoes, sliced']
  },
  
  // Cheese variations
  {
    foodName: 'cheese, cheddar',
    aliases: ['cheese, shredded', 'cheddar cheese, shredded', 'shredded cheese', 'shredded cheddar']
  },
  
  // Ground beef variations
  {
    foodName: 'Ground Beef 90/10',
    aliases: ['ground beef', 'beef, ground', 'ground beef, raw', 'beef, ground, raw']
  },
  
  // Black beans variations
  {
    foodName: 'Black Beans, Cooked',
    aliases: ['black beans, cooked', 'black beans, drained', 'beans, black, cooked', 'beans, black, mature seeds, cooked']
  },
  
  // Tofu variations
  {
    foodName: 'Tofu, Firm',
    aliases: ['tofu, cubed', 'tofu cubed', 'firm tofu, cubed', 'firm tofu cubed', 'tofu, firm, cubed']
  },
  
  // Milk variations
  {
    foodName: 'milk, whole, 3.25% milkfat',
    aliases: ['milk, whole', 'whole milk', 'milk whole']
  },
  {
    foodName: 'Milk, Whole',
    aliases: ['milk, whole', 'whole milk', 'milk whole', 'milk, whole, 3.25% milkfat']
  },
  {
    foodName: 'milk, reduced fat, fluid, 2% milkfat, with added vitamin A and vitamin D',
    aliases: ['milk, 2%', '2% milk', 'milk 2%', 'reduced fat milk', 'milk, reduced fat']
  },
  {
    foodName: 'Milk, 2%',
    aliases: ['milk, 2%', '2% milk', 'milk 2%', 'reduced fat milk', 'milk, reduced fat']
  },
  
  // Egg variations
  {
    foodName: 'Eggs, Large, Raw',
    aliases: ['eggs, large', 'large eggs', 'egg, large', 'large egg']
  },
  {
    foodName: 'Egg',
    aliases: ['egg', 'eggs', 'jumbo egg', 'jumbo eggs']
  },
  
  // Chicken variations
  {
    foodName: 'Chicken Breast, Raw (Skinless)',
    aliases: ['chicken breast, raw', 'chicken breast raw', 'chicken breasts, raw', 'chicken breasts raw', 'chicken breast, skinless', 'chicken breasts, skinless']
  },
  
  // Avocado variations
  {
    foodName: 'avocados, raw, California',
    aliases: ['avocado, sliced', 'avocado sliced', 'avocados, sliced', 'avocado, raw', 'avocado raw']
  },
  
  // Banana variations
  {
    foodName: 'bananas, raw',
    aliases: ['banana, sliced', 'banana sliced', 'bananas, sliced', 'banana, raw', 'banana raw']
  },
  
  // Sweet potato variations
  {
    foodName: 'sweet potato, cooked, baked in skin, without salt',
    aliases: ['sweet potato, mashed', 'sweet potato mashed', 'sweet potatoes, mashed', 'sweet potato, cooked', 'sweet potatoes, cooked']
  },
  
  // Salmon variations
  {
    foodName: 'salmon, Atlantic, farmed, cooked, dry heat',
    aliases: ['salmon, cooked', 'salmon cooked', 'cooked salmon', 'salmon, Atlantic, cooked']
  },
  
  // Ground beef cooked variations
  {
    foodName: 'beef, ground, 85% lean meat / 15% fat, patty, cooked, broiled',
    aliases: ['ground beef, cooked', 'ground beef cooked', 'beef, ground, cooked', 'cooked ground beef']
  },
  
  // Rice variations
  {
    foodName: 'rice, brown, long-grain, cooked',
    aliases: ['brown rice, cooked', 'brown rice cooked', 'rice, brown, cooked', 'cooked brown rice']
  },
  
  // Pasta variations
  {
    foodName: 'pasta, cooked, enriched, without added salt',
    aliases: ['pasta, cooked', 'pasta cooked', 'cooked pasta']
  },
  
  // Lentils variations
  {
    foodName: 'lentils, mature seeds, cooked, boiled, without salt',
    aliases: ['lentils, cooked', 'lentils cooked', 'cooked lentils', 'lentils, boiled']
  },
  
  // Black pepper variations
  {
    foodName: 'Black Pepper',
    aliases: ['black pepper', 'pepper, black', 'pepper black']
  },
  
  // Ginger variations
  {
    foodName: 'Ginger',
    aliases: ['ginger', 'ginger root', 'fresh ginger', 'ginger, fresh']
  },
  
  // Nori variations
  {
    foodName: 'Nori',
    aliases: ['nori', 'nori sheet', 'nori sheets', 'seaweed, nori']
  }
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log('🔧 Phase F: Adding Missing Aliases\n');
  console.log(`Mode: ${dryRun ? '🔍 DRY RUN' : '💾 LIVE RUN'}`);
  console.log('='.repeat(80));
  
  let aliasesAdded = 0;
  let foodsFound = 0;
  let foodsNotFound = 0;
  
  for (const { foodName, aliases } of ALIAS_ADDITIONS) {
    console.log(`\n📝 Food: ${foodName}`);
    
    // Find food by name (case-insensitive, partial match)
    const food = await prisma.food.findFirst({
      where: {
        name: {
          contains: foodName,
          mode: 'insensitive'
        }
      },
      include: {
        aliases: true
      }
    });
    
    if (!food) {
      console.log(`   ❌ Not found`);
      foodsNotFound++;
      continue;
    }
    
    foodsFound++;
    console.log(`   ✅ Found: ${food.name}`);
    
    // Get existing aliases
    const existingAliases = new Set(food.aliases.map(a => a.alias.toLowerCase()));
    
    // Add missing aliases
    let addedForThisFood = 0;
    for (const alias of aliases) {
      if (!existingAliases.has(alias.toLowerCase())) {
        console.log(`   ➕ Will add alias: "${alias}"`);
        
        if (!dryRun) {
          await prisma.foodAlias.create({
            data: {
              foodId: food.id,
              alias: alias
            }
          });
        }
        
        aliasesAdded++;
        addedForThisFood++;
      }
    }
    
    if (addedForThisFood === 0) {
      console.log(`   ✅ All aliases already exist`);
    }
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('📊 Summary:');
  console.log(`   ✅ Foods found: ${foodsFound}`);
  console.log(`   ❌ Foods not found: ${foodsNotFound}`);
  console.log(`   ➕ Aliases added: ${aliasesAdded}`);
  
  if (dryRun) {
    console.log('\n🔍 DRY RUN - No changes made. Run without --dry-run to apply.');
  } else {
    console.log('\n✅ Aliases added successfully!');
    console.log('\n🧪 Next Steps:');
    console.log('   1. Run: npm run eval');
    console.log('   2. Check for improvements in P@1');
  }
  
  await prisma.$disconnect();
}

main().catch(console.error);





#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/db';

interface CliOptions {
  outputPath?: string;
}

interface ManifestEntry {
  id: string;
  note?: string;
  source: string;
}

interface CategoryRule {
  slug: string;
  label: string;
  keywords: string[];
}

const CATEGORY_RULES: CategoryRule[] = [
  { slug: 'produce:vegetables', label: 'Produce – Vegetables', keywords: ['broccoli', 'spinach', 'kale', 'lettuce', 'greens', 'tomato', 'tomatoes', 'carrot', 'pepper', 'bell pepper', 'jalapeno', 'onion', 'garlic', 'ginger', 'mushroom', 'cucumber', 'zucchini', 'squash', 'cauliflower', 'eggplant', 'celery', 'potato', 'sweet potato', 'green bean', 'beans, green', 'cabbage', 'bok choy', 'brussels sprout', 'arugula', 'herb', 'parsley', 'cilantro', 'basil', 'dill', 'mint', 'chive'] },
  { slug: 'produce:fruits', label: 'Produce – Fruits', keywords: ['apple', 'banana', 'berries', 'strawberry', 'blueberry', 'raspberry', 'blackberry', 'grape', 'orange', 'clementine', 'lemon', 'lime', 'citrus', 'pineapple', 'mango', 'papaya', 'melon', 'watermelon', 'peach', 'pear', 'plum', 'kiwi', 'avocado', 'cherry'] },
  { slug: 'protein:chicken:breast', label: 'Protein – Chicken Breast', keywords: ['chicken breast', 'chicken breasts'] },
  { slug: 'protein:chicken:thigh', label: 'Protein – Chicken Thigh', keywords: ['chicken thigh', 'chicken thighs', 'boneless chicken thigh', 'chicken thigh meat'] },
  { slug: 'protein:chicken:wing', label: 'Protein – Chicken Wing', keywords: ['chicken wing', 'chicken wings', 'wingettes', 'drummettes'] },
  { slug: 'protein:chicken:drumstick', label: 'Protein – Chicken Drumstick', keywords: ['chicken drumstick', 'chicken drumsticks', 'chicken leg', 'chicken legs'] },
  { slug: 'protein:chicken:ground', label: 'Protein – Ground Chicken', keywords: ['ground chicken', 'minced chicken'] },
  { slug: 'protein:chicken:general', label: 'Protein – Chicken (Other)', keywords: ['rotisserie chicken', 'whole chicken', 'chicken thigh, skinless', 'chicken tender', 'chicken, cooked'] },
  { slug: 'protein:turkey', label: 'Protein – Turkey', keywords: ['turkey', 'ground turkey'] },
  { slug: 'protein:beef', label: 'Protein – Beef', keywords: ['beef', 'steak', 'sirloin', 'ground beef', 'chuck', 'ribeye', 'brisket'] },
  { slug: 'protein:pork', label: 'Protein – Pork', keywords: ['pork', 'bacon', 'ham', 'pulled pork'] },
  { slug: 'protein:seafood', label: 'Protein – Seafood', keywords: ['salmon', 'shrimp', 'tilapia', 'cod', 'tuna', 'halibut', 'seafood', 'scallop', 'crab'] },
  { slug: 'protein:eggs', label: 'Protein – Eggs', keywords: ['egg', 'eggs'] },
  { slug: 'protein:dairy', label: 'Protein – Dairy', keywords: ['milk', 'yogurt', 'cheese', 'cottage cheese', 'cream', 'butter', 'ghee'] },
  { slug: 'dairy:low-fat', label: 'Dairy – Low-Fat & Fat-Free', keywords: ['fat free', 'fat-free', 'low fat', 'low-fat', 'reduced fat', 'reduced-fat', 'light', 'part skim', 'part-skim', 'skim', 'nonfat', '0%', '1%', '2%'] },
  { slug: 'protein:plant', label: 'Protein – Plant-Based', keywords: ['tofu', 'tempeh', 'edamame', 'seitan', 'plant-based', 'soy protein'] },
  { slug: 'protein:supplements', label: 'Protein – Supplements', keywords: ['protein powder', 'whey protein', 'casein', 'collagen', 'protein bar', 'protein shake', 'meal replacement', 'plant protein', 'pea protein', 'keto protein'] },
  { slug: 'pantry:keto', label: 'Pantry – Keto Alternatives', keywords: ['keto', 'low carb', 'low-carb', 'carb balance', 'xtreme wellness', 'fathead', 'cloud bread', 'almond flour', 'coconut flour', 'psyllium husk', 'keto bread', 'keto tortilla', 'keto bun', 'keto wrap', 'erythritol', 'monk fruit', 'stevia', 'allulose', 'swerve', 'lakanto'] },
  { slug: 'pantry:legumes', label: 'Pantry – Beans & Legumes', keywords: ['beans', 'lentil', 'chickpea', 'garbanzo', 'black bean', 'kidney bean', 'split pea'] },
  { slug: 'pantry:grains', label: 'Pantry – Grains & Starches', keywords: ['rice', 'quinoa', 'oats', 'pasta', 'spaghetti', 'bread', 'tortilla', 'flour', 'cornmeal', 'couscous', 'barley', 'farro', 'pita', 'naan', 'wrap', 'bagel', 'bun'] },
  { slug: 'pantry:nuts', label: 'Pantry – Nuts & Seeds', keywords: ['almond', 'walnut', 'peanut', 'cashew', 'pecan', 'hazelnut', 'chia', 'flax', 'hemp seed', 'sunflower seed', 'pumpkin seed', 'sesame seed'] },
  { slug: 'pantry:nut-butters', label: 'Pantry – Nut Butters', keywords: ['almond butter', 'cashew butter', 'peanut butter', 'sunflower butter', 'tahini', 'powdered peanut', 'pb2', 'pbfit', 'nut butter', 'seed butter'] },
  { slug: 'pantry:canned', label: 'Pantry – Canned Goods', keywords: ['canned', 'can ', 'in can', 'tomato paste', 'tomato sauce', 'canned tomato', 'canned bean', 'canned corn', 'canned tuna', 'canned salmon', 'canned chicken', 'coconut milk', 'canned pumpkin', 'broth', 'stock', 'bone broth'] },
  { slug: 'pantry:oils', label: 'Pantry – Oils & Fats', keywords: [' oil', 'olive oil', 'canola oil', 'avocado oil', 'coconut oil', 'ghee', 'lard', 'sesame oil', 'peanut oil', 'sunflower oil', 'walnut oil', 'grapeseed oil'] },
  { slug: 'pantry:condiments', label: 'Pantry – Condiments & Sauces', keywords: ['soy sauce', 'tamari', 'mirin', 'vinegar', 'balsamic', 'apple cider vinegar', 'rice vinegar', 'hot sauce', 'chili sauce', 'ketchup', 'mustard', 'mayo', 'mayonnaise', 'sriracha', 'teriyaki', 'barbecue', 'bbq sauce', 'fish sauce', 'oyster sauce', 'hoisin', 'tahini', 'gochujang', 'miso', 'pesto', 'salsa', 'chimichurri', 'aioli', 'worcestershire', 'relish', 'dressing', 'vinaigrette', 'ponzu', 'harissa', 'tikka masala', 'marinara', 'peanut sauce'] },
  { slug: 'pantry:sweeteners', label: 'Pantry – Sweeteners', keywords: ['sugar', 'brown sugar', 'powdered sugar', 'confectioners', 'honey', 'maple', 'agave', 'syrup', 'molasses', 'stevia'] },
  { slug: 'baking:leaveners', label: 'Baking – Leaveners & Starches', keywords: ['baking powder', 'baking soda', 'yeast', 'cornstarch', 'arrowroot'] },
  { slug: 'baking:essentials', label: 'Baking – Essentials', keywords: ['flour', 'cocoa', 'chocolate chip', 'vanilla extract', 'shortening', 'cornmeal', 'cake mix'] },
  { slug: 'spices', label: 'Pantry – Spices & Seasonings', keywords: ['cinnamon', 'cumin', 'paprika', 'turmeric', 'oregano', 'thyme', 'rosemary', 'pepper', 'salt', 'seasoning', 'spice blend', 'garam masala', 'curry powder', 'italian seasoning', 'everything bagel', 'chili powder', 'smoked paprika', 'five spice', 'zaatar', 'herbes de provence'] },
  { slug: 'beverages', label: 'Beverages', keywords: ['coffee', 'tea', 'iced tea', 'matcha', 'latte', 'cappuccino', 'espresso', 'juice', 'smoothie', 'shake', 'kombucha', 'sparkling water', 'seltzer', 'lemonade', 'mocktail', 'cocktail', 'beer', 'wine', 'almond milk', 'oat milk', 'soy milk', 'plant milk'] },
  { slug: 'uncategorized', label: 'Uncategorized', keywords: [] },
];

const CATEGORY_LABELS = new Map(CATEGORY_RULES.map((rule) => [rule.slug, rule.label]));

const TARGET_CATEGORY_SLUGS = [
  'produce:vegetables',
  'produce:fruits',
  'protein:chicken:breast',
  'protein:chicken:thigh',
  'protein:chicken:ground',
  'protein:chicken:wing',
  'protein:chicken:drumstick',
  'protein:beef',
  'protein:pork',
  'protein:seafood',
  'pantry:condiments',
  'pantry:oils',
  'pantry:grains',
  'pantry:legumes',
  'dairy:low-fat',
  'pantry:keto',
  'pantry:canned',
  'protein:supplements',
  'pantry:nut-butters',
  'baking:leaveners',
  'baking:essentials',
  'spices',
];

const MANIFEST_FILES = [
  'data/fatsecret/bootstrap/gold.jsonl',
  'data/fatsecret/bootstrap/gold.high_usage.jsonl',
  'data/fatsecret/bootstrap/curated.jsonl',
  'data/fatsecret/bootstrap/proteins.jsonl',
  'data/fatsecret/bootstrap/condiments.jsonl',
  'data/fatsecret/bootstrap/spices.jsonl',
  'data/fatsecret/bootstrap/baking.jsonl',
  'data/fatsecret/bootstrap/dairy_lowfat.jsonl',
  'data/fatsecret/bootstrap/keto.jsonl',
  'data/fatsecret/bootstrap/canned.jsonl',
  'data/fatsecret/bootstrap/supplements.jsonl',
  'data/fatsecret/bootstrap/nut_butters.jsonl',
  'data/fatsecret/bootstrap/beverages.jsonl',
  'data/fatsecret/bootstrap/produce_herbs.jsonl',
  'data/fatsecret/bootstrap/breads_wraps.jsonl',
  'data/fatsecret/bootstrap/seafood_extra.jsonl',
  'data/fatsecret/bootstrap/chicken_variety.jsonl',
];

function parseArgs(): CliOptions {
  const options: CliOptions = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--output') {
      const next = args[i + 1];
      if (next) {
        options.outputPath = path.resolve(next);
        i += 1;
      }
    } else if (arg.startsWith('--output=')) {
      options.outputPath = path.resolve(arg.split('=')[1]);
    }
  }
  return options;
}

function readManifestEntries(): ManifestEntry[] {
  const entries = new Map<string, ManifestEntry>();
  for (const filePath of MANIFEST_FILES) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { fatsecretId?: string; note?: string; source?: string };
        const id = parsed.fatsecretId ?? parsed.id;
        if (!id) continue;
        const existing = entries.get(id);
        const note = parsed.note ?? existing?.note;
        const source = parsed.source ?? existing?.source ?? path.basename(filePath);
        entries.set(id, { id, note, source });
      } catch (error) {
        console.warn(`Failed to parse manifest line in ${filePath}:`, error);
      }
    }
  }
  return Array.from(entries.values());
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function keywordMatches(normalized: string, keyword: string) {
  const pattern = `\\b${escapeRegex(keyword.trim())}\\b`;
  const regex = new RegExp(pattern);
  return regex.test(normalized);
}

function categorize(text: string | undefined): string[] {
  if (!text) return ['uncategorized'];
  const normalized = text.toLowerCase();
  const hits = new Set<string>();
  for (const rule of CATEGORY_RULES) {
    if (rule.slug === 'uncategorized') continue;
    if (rule.keywords.some((keyword) => keywordMatches(normalized, keyword))) {
      hits.add(rule.slug);
    }
  }
  if (hits.size === 0) hits.add('uncategorized');
  return Array.from(hits);
}

async function main() {
  const options = parseArgs();
  const manifestEntries = readManifestEntries();

  const cachedFoods = await prisma.fatSecretFoodCache.findMany({
    select: { id: true, name: true, brandName: true },
  });
  const cachedMap = new Map(cachedFoods.map((food) => [food.id, food]));

  const lines: string[] = [];
  const push = (text = '') => {
    lines.push(text);
    console.log(text);
  };

  let cachedCount = 0;
  const categoryCounts = new Map<string, number>();
  const categorySamples = new Map<string, string[]>();
  const missingInCache: ManifestEntry[] = [];

  for (const entry of manifestEntries) {
    const cached = cachedMap.get(entry.id);
    if (!cached) {
      missingInCache.push(entry);
      continue;
    }
    cachedCount += 1;
    const label = entry.note ?? cached.name ?? '';
    const categories = categorize(label);
    for (const category of categories) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
      if (!categorySamples.has(category)) categorySamples.set(category, []);
      const samples = categorySamples.get(category)!;
      if (samples.length < 5) {
        const display = cached.brandName ? `${cached.name} (${cached.brandName})` : cached.name;
        samples.push(display ?? label ?? entry.id);
      }
    }
  }

  const missingTargets = TARGET_CATEGORY_SLUGS.filter((slug) => !categoryCounts.has(slug));

  push('FatSecret cache category coverage');
  push('================================');
  push(`Manifest entries (unique): ${manifestEntries.length}`);
  push(`Entries cached           : ${cachedCount}`);
  push(`Entries missing cache    : ${missingInCache.length}`);
  push();

  push('Category counts');
  push('---------------');
  const sortedCategories = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
  if (sortedCategories.length === 0) {
    push('- No hydrated manifest entries found');
    push();
  }
  for (const [slug, count] of sortedCategories) {
    const label = CATEGORY_LABELS.get(slug) ?? slug;
    const sampleText = categorySamples.get(slug)?.join(', ');
    push(`- ${label}: ${count}${sampleText ? ` (e.g., ${sampleText})` : ''}`);
  }
  push();

  if (missingTargets.length > 0) {
    push('Target categories with zero coverage');
    push('------------------------------------');
    missingTargets.forEach((slug) => push(`- ${CATEGORY_LABELS.get(slug) ?? slug}`));
    push();
  }

  if (missingInCache.length > 0) {
    push('Manifest foods missing from cache');
    push('---------------------------------');
    missingInCache.slice(0, 10).forEach((entry) => {
      push(`- ${entry.id}: ${entry.note ?? '(no note)'} [source=${entry.source}]`);
    });
    if (missingInCache.length > 10) {
      push(`...and ${missingInCache.length - 10} more`);
    }
    push();
  }

  if (options.outputPath) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
    fs.writeFileSync(options.outputPath, lines.join('\n'), 'utf-8');
    console.log(`\nWrote category report to ${options.outputPath}`);
  }
}

main()
  .catch((error) => {
    console.error('fatsecret-cache-category-report failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

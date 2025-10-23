/**
 * Deduplication utilities for USDA import
 */

import crypto from 'crypto';

/**
 * Canonicalize food name for deduplication
 */
export function canonicalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/\(.*?\)/g, '')    // drop parentheticals
    .replace(/[,.-]/g, ' ')    // replace punctuation with spaces
    .replace(/\s+/g, ' ')       // collapse multiple spaces
    .trim();
}

/**
 * Canonical name for stronger deduplication (matches the new saturation system)
 */
export function canonicalName(s: string): string {
  return s.toLowerCase()
    .replace(/\(.*?\)/g,'')
    .replace(/[^a-z0-9 ]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

/**
 * Create macro fingerprint for deduplication
 * Buckets values to handle small variations in nutrition data
 */
export function macroFingerprint(kcal100: number, protein: number, carbs: number, fat: number): string {
  const bucket = (x: number, size: number) => Math.round(x / size);
  
  // Bucket values to handle small variations
  const kcalBucket = bucket(kcal100, 5);      // 5 kcal buckets
  const proteinBucket = bucket(protein, 1);    // 1g protein buckets
  const carbsBucket = bucket(carbs, 1);       // 1g carb buckets
  const fatBucket = bucket(fat, 1);           // 1g fat buckets
  
  const key = `${kcalBucket}|${proteinBucket}|${carbsBucket}|${fatBucket}`;
  return crypto.createHash('md5').update(key).digest('hex').slice(0, 10);
}

/**
 * Round macros into buckets to detect near-duplicates (for saturation system)
 */
export function macroFingerprintSaturation(per100: {kcal100:number; protein100:number; carbs100:number; fat100:number}): string {
  const r = (n:number, step:number)=>Math.round(n/step)*step;
  return [
    r(per100.kcal100, 5),
    r(per100.protein100, 1),
    r(per100.carbs100, 1),
    r(per100.fat100, 1)
  ].join('|');
}

/**
 * Check if two foods are likely duplicates
 */
export function isLikelyDuplicate(
  name1: string, 
  name2: string, 
  kcal1: number, 
  kcal2: number,
  protein1: number,
  protein2: number,
  carbs1: number,
  carbs2: number,
  fat1: number,
  fat2: number
): boolean {
  const canonical1 = canonicalizeName(name1);
  const canonical2 = canonicalizeName(name2);
  
  // Exact name match
  if (canonical1 === canonical2) {
    return true;
  }
  
  // Similar name and very close nutrition
  const nameSimilarity = calculateSimilarity(canonical1, canonical2);
  const nutritionSimilarity = calculateNutritionSimilarity(
    kcal1, kcal2, protein1, protein2, carbs1, carbs2, fat1, fat2
  );
  
  return nameSimilarity > 0.8 && nutritionSimilarity > 0.9;
}

/**
 * Calculate string similarity (simple Jaccard similarity)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.split(' '));
  const words2 = new Set(str2.split(' '));
  
  const intersection = new Set([...words1].filter(x => words2.has(x)));
  const union = new Set([...words1, ...words2]);
  
  return intersection.size / union.size;
}

/**
 * Calculate nutrition similarity
 */
function calculateNutritionSimilarity(
  kcal1: number, kcal2: number,
  protein1: number, protein2: number,
  carbs1: number, carbs2: number,
  fat1: number, fat2: number
): number {
  const kcalDiff = Math.abs(kcal1 - kcal2) / Math.max(kcal1, kcal2, 1);
  const proteinDiff = Math.abs(protein1 - protein2) / Math.max(protein1, protein2, 1);
  const carbsDiff = Math.abs(carbs1 - carbs2) / Math.max(carbs1, carbs2, 1);
  const fatDiff = Math.abs(fat1 - fat2) / Math.max(fat1, fat2, 1);
  
  const avgDiff = (kcalDiff + proteinDiff + carbsDiff + fatDiff) / 4;
  return 1 - avgDiff; // Higher similarity = lower difference
}

/**
 * Generate aliases for a food name
 */
export function generateAliases(name: string): string[] {
  const aliases = new Set<string>();
  
  // Add canonical name
  aliases.add(canonicalizeName(name));
  
  // Add original name (lowercased)
  aliases.add(name.toLowerCase());
  
  // Singular/plural variants
  const words = name.toLowerCase().split(' ');
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word.endsWith('s') && word.length > 3) {
      // Try singular
      const singular = word.slice(0, -1);
      const variant = [...words];
      variant[i] = singular;
      aliases.add(variant.join(' '));
    } else if (!word.endsWith('s')) {
      // Try plural
      const plural = word + 's';
      const variant = [...words];
      variant[i] = plural;
      aliases.add(variant.join(' '));
    }
  }
  
  // Raw/cooked variants
  const rawVariants = ['raw', 'uncooked', 'fresh'];
  const cookedVariants = ['cooked', 'boiled', 'steamed', 'roasted'];
  
  for (const variant of rawVariants) {
    if (!name.toLowerCase().includes(variant)) {
      aliases.add(`${name.toLowerCase()} ${variant}`);
    }
  }
  
  for (const variant of cookedVariants) {
    if (!name.toLowerCase().includes(variant)) {
      aliases.add(`${name.toLowerCase()} ${variant}`);
    }
  }
  
  return Array.from(aliases).filter(alias => alias.length > 2);
}

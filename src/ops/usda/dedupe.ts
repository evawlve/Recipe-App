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
    .replace(/\(.*?\)/g,'')                                    // Remove parentheticals
    .replace(/,?\s*(from|for)\s+(kids?'?s?|children'?s?)\s+menu/gi, '') // Remove "from kids menu", "from kid's menu", etc.
    .replace(/,?\s*kids?'?s?\s+menu/gi, '')                   // Remove standalone "kids menu"
    .replace(/,?\s*kids?\s+meal/gi, '')                        // Remove "kids meal"
    .replace(/[^a-z0-9 ]+/g,' ')                              // Replace non-alphanumeric with spaces
    .replace(/\s+/g,' ')                                       // Collapse multiple spaces
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
 * Cross-dataset deduplication key (strict - includes macro fingerprint)
 * Combines canonical name, category, state, and macro fingerprint
 */
export function crossDatasetDedupeKey(
  name: string,
  categoryId: string | null,
  stateTag: string | null,
  macros: {kcal100:number; protein100:number; carbs100:number; fat100:number}
): string {
  const canonical = canonicalName(name);
  const macroFp = macroFingerprintSaturation(macros);
  return `${canonical}|${categoryId||''}|${stateTag||''}|${macroFp}`;
}

/**
 * Loose deduplication key for cross-dataset matching (ignores small macro differences)
 * This key is used to detect the SAME food across datasets, even if nutrition data varies slightly
 */
export function looseDedupeKey(
  name: string,
  categoryId: string | null,
  stateTag: string | null
): string {
  const canonical = canonicalName(name);
  return `${canonical}|${categoryId||''}|${stateTag||''}`;
}

/**
 * Check if two foods' macros are "close enough" to be considered the same food
 * Uses hybrid comparison: percentage-based for large values, absolute for small values
 */
export function areMacrosCloseEnough(
  macros1: {kcal100:number; protein100:number; carbs100:number; fat100:number},
  macros2: {kcal100:number; protein100:number; carbs100:number; fat100:number},
  tolerance: number = 0.15 // 15% tolerance for percentages
): boolean {
  /**
   * For small values (<2g or <20 kcal), use absolute difference
   * For larger values, use percentage difference
   * This prevents tiny differences (e.g., 0.59g vs 0.81g) from causing huge percentage diffs
   */
  const isCloseEnough = (a: number, b: number, absoluteThreshold: number, percentThreshold: number) => {
    const absDiff = Math.abs(a - b);
    
    // If both values are small, use absolute comparison
    if (Math.max(Math.abs(a), Math.abs(b)) < absoluteThreshold) {
      return absDiff <= absoluteThreshold * 0.5; // Allow 50% of threshold
    }
    
    // For larger values, use percentage comparison
    const max = Math.max(Math.abs(a), Math.abs(b));
    if (max === 0) return true;
    return (absDiff / max) <= percentThreshold;
  };
  
  // Calories: absolute threshold 20 kcal, percentage threshold 15%
  if (!isCloseEnough(macros1.kcal100, macros2.kcal100, 20, tolerance)) return false;
  
  // Protein: absolute threshold 2g, percentage threshold 15%
  if (!isCloseEnough(macros1.protein100, macros2.protein100, 2, tolerance)) return false;
  
  // Carbs: absolute threshold 2g, percentage threshold 15%
  if (!isCloseEnough(macros1.carbs100, macros2.carbs100, 2, tolerance)) return false;
  
  // Fat: absolute threshold 2g, percentage threshold 15%
  if (!isCloseEnough(macros1.fat100, macros2.fat100, 2, tolerance)) return false;
  
  return true;
}

/**
 * Dataset precedence for deduplication
 * Foundation > SR Legacy > others
 */
export function getDatasetPrecedence(dataType: string): number {
  if (dataType.includes('Foundation')) return 1;
  if (dataType.includes('SR Legacy')) return 2;
  if (dataType.includes('Survey')) return 3;
  return 999;
}

/**
 * Compare two food items to determine which should be kept
 * Returns true if item1 should be preferred over item2
 */
export function shouldPreferItem(
  item1: { dataType: string; description: string; portionCount?: number },
  item2: { dataType: string; description: string; portionCount?: number }
): boolean {
  const prec1 = getDatasetPrecedence(item1.dataType);
  const prec2 = getDatasetPrecedence(item2.dataType);
  
  // Prefer by dataset precedence first
  if (prec1 !== prec2) {
    return prec1 < prec2;
  }
  
  // Same dataset: prefer more portion info
  const portions1 = item1.portionCount || 0;
  const portions2 = item2.portionCount || 0;
  if (portions1 !== portions2) {
    return portions1 > portions2;
  }
  
  // Prefer shorter/cleaner description
  return item1.description.length < item2.description.length;
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

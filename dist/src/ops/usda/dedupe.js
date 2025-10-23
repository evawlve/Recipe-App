"use strict";
/**
 * Deduplication utilities for USDA import
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalizeName = canonicalizeName;
exports.macroFingerprint = macroFingerprint;
exports.isLikelyDuplicate = isLikelyDuplicate;
exports.generateAliases = generateAliases;
const crypto_1 = __importDefault(require("crypto"));
/**
 * Canonicalize food name for deduplication
 */
function canonicalizeName(name) {
    return name.toLowerCase()
        .replace(/\(.*?\)/g, '') // drop parentheticals
        .replace(/[,.-]/g, ' ') // replace punctuation with spaces
        .replace(/\s+/g, ' ') // collapse multiple spaces
        .trim();
}
/**
 * Create macro fingerprint for deduplication
 * Buckets values to handle small variations in nutrition data
 */
function macroFingerprint(kcal100, protein, carbs, fat) {
    const bucket = (x, size) => Math.round(x / size);
    // Bucket values to handle small variations
    const kcalBucket = bucket(kcal100, 5); // 5 kcal buckets
    const proteinBucket = bucket(protein, 1); // 1g protein buckets
    const carbsBucket = bucket(carbs, 1); // 1g carb buckets
    const fatBucket = bucket(fat, 1); // 1g fat buckets
    const key = `${kcalBucket}|${proteinBucket}|${carbsBucket}|${fatBucket}`;
    return crypto_1.default.createHash('md5').update(key).digest('hex').slice(0, 10);
}
/**
 * Check if two foods are likely duplicates
 */
function isLikelyDuplicate(name1, name2, kcal1, kcal2, protein1, protein2, carbs1, carbs2, fat1, fat2) {
    const canonical1 = canonicalizeName(name1);
    const canonical2 = canonicalizeName(name2);
    // Exact name match
    if (canonical1 === canonical2) {
        return true;
    }
    // Similar name and very close nutrition
    const nameSimilarity = calculateSimilarity(canonical1, canonical2);
    const nutritionSimilarity = calculateNutritionSimilarity(kcal1, kcal2, protein1, protein2, carbs1, carbs2, fat1, fat2);
    return nameSimilarity > 0.8 && nutritionSimilarity > 0.9;
}
/**
 * Calculate string similarity (simple Jaccard similarity)
 */
function calculateSimilarity(str1, str2) {
    const words1 = new Set(str1.split(' '));
    const words2 = new Set(str2.split(' '));
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    return intersection.size / union.size;
}
/**
 * Calculate nutrition similarity
 */
function calculateNutritionSimilarity(kcal1, kcal2, protein1, protein2, carbs1, carbs2, fat1, fat2) {
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
function generateAliases(name) {
    const aliases = new Set();
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
        }
        else if (!word.endsWith('s')) {
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

/**
 * Detect Serving Anomalies Script
 * 
 * Scans ai-generated-servings.json for potentially incorrect gram estimations:
 * - Suspiciously low weights for food items
 * - Suspiciously high weights for single items
 * - Mismatched serving descriptions (e.g., "medium" soup at 11g)
 */

import * as fs from 'fs';
import * as path from 'path';

interface ServingEntry {
    cacheType: string;
    foodId: string;
    foodName: string;
    brandName: string | null;
    servingDescription: string;
    grams: number;
    source: string;
    confidence: number | null;
    note: string | null;
    createdAt: string;
}

interface Anomaly {
    foodId: string;
    foodName: string;
    brandName: string | null;
    servingDescription: string;
    grams: number;
    source: string;
    issue: string;
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

// Define expected weight ranges for different serving types
const SERVING_EXPECTATIONS: Record<string, { min: number; max: number; description: string }> = {
    // Volume-based servings
    'cup': { min: 50, max: 350, description: '1 cup of most foods' },
    'tbsp': { min: 3, max: 25, description: '1 tbsp' },
    'tsp': { min: 1, max: 8, description: '1 tsp' },

    // Size-based servings for whole items
    'small': { min: 5, max: 500, description: 'small item' },
    'medium': { min: 10, max: 600, description: 'medium item' },
    'large': { min: 20, max: 800, description: 'large item' },

    // Count-based servings
    'piece': { min: 5, max: 500, description: '1 piece' },
    'slice': { min: 10, max: 100, description: '1 slice' },
    'scoop': { min: 20, max: 50, description: '1 scoop (protein powder)' },
};

// Foods that should have specific weight ranges
const FOOD_WEIGHT_RULES: Array<{
    pattern: RegExp;
    servingPatterns: RegExp[];
    minGrams: number;
    maxGrams: number;
    description: string;
}> = [
        // Soups/stews should be substantial
        {
            pattern: /soup|stew|chili|broth/i,
            servingPatterns: [/small/i, /medium/i, /large/i, /cup/i, /bowl/i],
            minGrams: 100,
            maxGrams: 600,
            description: 'Soup/stew servings should be 100-600g'
        },
        // Lasagna/casseroles
        {
            pattern: /lasagna|casserole|bake/i,
            servingPatterns: [/small/i, /medium/i, /large/i, /serving/i, /piece/i],
            minGrams: 100,
            maxGrams: 500,
            description: 'Lasagna/casserole servings should be 100-500g'
        },
        // Lettuce heads
        {
            pattern: /head.*lettuce|lettuce.*head/i,
            servingPatterns: [/head/i, /whole/i],
            minGrams: 200,
            maxGrams: 800,
            description: 'One lettuce head should be 200-800g'
        },
        // Scallions/green onions (per unit)
        {
            pattern: /scallion|green onion|spring onion/i,
            servingPatterns: [/^1$/, /small/i, /medium/i, /large/i, /scallion/i],
            minGrams: 5,
            maxGrams: 25,
            description: 'Single scallion should be 5-25g'
        },
        // Protein powder scoops
        {
            pattern: /protein|whey|isolate/i,
            servingPatterns: [/scoop/i],
            minGrams: 20,
            maxGrams: 50,
            description: 'Protein scoop should be 20-50g'
        },
        // Whole produce items - should not be tiny
        {
            pattern: /tomato|pepper|onion|apple|orange|banana|potato|carrot|zucchini/i,
            servingPatterns: [/^medium$/i, /^large$/i],
            minGrams: 50,
            maxGrams: 500,
            description: 'Medium/large produce should be 50-500g'
        },
    ];

function detectAnomalies(entries: ServingEntry[]): Anomaly[] {
    const anomalies: Anomaly[] = [];

    for (const entry of entries) {
        const { foodName, servingDescription, grams, source } = entry;
        const servingLower = servingDescription.toLowerCase();

        // Skip entries with null confidence from FDC source (these are verified)
        if (source === 'fdc' && entry.confidence === null) {
            continue;
        }

        // Check food-specific rules
        for (const rule of FOOD_WEIGHT_RULES) {
            if (rule.pattern.test(foodName)) {
                const matchesServing = rule.servingPatterns.some(p => p.test(servingDescription));
                if (matchesServing) {
                    if (grams < rule.minGrams) {
                        anomalies.push({
                            ...entry,
                            issue: `Too low: ${grams}g for "${servingDescription}" of ${foodName}. ${rule.description}`,
                            severity: grams < rule.minGrams / 5 ? 'HIGH' : 'MEDIUM'
                        });
                    } else if (grams > rule.maxGrams) {
                        anomalies.push({
                            ...entry,
                            issue: `Too high: ${grams}g for "${servingDescription}" of ${foodName}. ${rule.description}`,
                            severity: grams > rule.maxGrams * 3 ? 'HIGH' : 'MEDIUM'
                        });
                    }
                }
            }
        }

        // General anomaly detection for extremely low weights
        if (grams < 5 && !servingLower.includes('tsp') && !servingLower.includes('pinch') &&
            !servingLower.includes('dash') && !servingLower.includes('packet') &&
            !servingLower.includes('zest') && !servingLower.includes('ml')) {
            // Check if it's a size-based serving that shouldn't be this low
            if (/small|medium|large|piece|slice|serving/i.test(servingDescription)) {
                anomalies.push({
                    ...entry,
                    issue: `Extremely low weight: ${grams}g for "${servingDescription}" seems too small`,
                    severity: 'HIGH'
                });
            }
        }

        // Detect implausibly high single-item weights (>5kg for single items)
        if (grams > 5000 && /^1\s|single|piece|medium|large|small/i.test(servingDescription)) {
            // Exception for whole roasts, turkeys, etc.
            if (!/whole|roast|turkey|ham|rib/i.test(foodName)) {
                anomalies.push({
                    ...entry,
                    issue: `Very high weight: ${grams}g for a single serving seems excessive`,
                    severity: 'MEDIUM'
                });
            }
        }
    }

    return anomalies;
}

function main() {
    const logsDir = path.join(__dirname, '..', 'logs');
    const inputFile = path.join(logsDir, 'ai-generated-servings.json');
    const outputFile = path.join(logsDir, 'serving-anomalies.json');
    const summaryFile = path.join(logsDir, 'serving-anomalies-summary.txt');

    console.log('Loading ai-generated-servings.json...');
    const entries: ServingEntry[] = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
    console.log(`Loaded ${entries.length} entries`);

    console.log('Scanning for anomalies...');
    const anomalies = detectAnomalies(entries);

    // Sort by severity (HIGH first) then by grams
    anomalies.sort((a, b) => {
        const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
            return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return a.grams - b.grams;
    });

    // Write full anomaly data
    fs.writeFileSync(outputFile, JSON.stringify(anomalies, null, 2));
    console.log(`\nWrote ${anomalies.length} anomalies to ${outputFile}`);

    // Create summary
    const highCount = anomalies.filter(a => a.severity === 'HIGH').length;
    const mediumCount = anomalies.filter(a => a.severity === 'MEDIUM').length;
    const lowCount = anomalies.filter(a => a.severity === 'LOW').length;

    let summary = `AI-Generated Servings Anomaly Report
=====================================
Generated: ${new Date().toISOString()}

Total Entries Scanned: ${entries.length}
Total Anomalies Found: ${anomalies.length}

By Severity:
  HIGH:   ${highCount}
  MEDIUM: ${mediumCount}
  LOW:    ${lowCount}

=== HIGH SEVERITY ISSUES ===
`;

    for (const a of anomalies.filter(a => a.severity === 'HIGH')) {
        summary += `
[${a.foodId}] ${a.foodName}
  Brand: ${a.brandName || 'N/A'}
  Serving: "${a.servingDescription}" = ${a.grams}g
  Source: ${a.source}
  Issue: ${a.issue}
`;
    }

    summary += `
=== MEDIUM SEVERITY ISSUES ===
`;

    for (const a of anomalies.filter(a => a.severity === 'MEDIUM').slice(0, 50)) {
        summary += `
[${a.foodId}] ${a.foodName}
  Serving: "${a.servingDescription}" = ${a.grams}g
  Issue: ${a.issue}
`;
    }

    if (anomalies.filter(a => a.severity === 'MEDIUM').length > 50) {
        summary += `\n... and ${anomalies.filter(a => a.severity === 'MEDIUM').length - 50} more MEDIUM severity issues (see JSON file)\n`;
    }

    fs.writeFileSync(summaryFile, summary);
    console.log(`Wrote summary to ${summaryFile}`);

    // Print quick overview
    console.log('\n=== QUICK OVERVIEW ===');
    console.log(`HIGH severity: ${highCount}`);
    console.log(`MEDIUM severity: ${mediumCount}`);
    console.log(`LOW severity: ${lowCount}`);

    if (highCount > 0) {
        console.log('\n=== TOP HIGH SEVERITY ISSUES ===');
        for (const a of anomalies.filter(a => a.severity === 'HIGH').slice(0, 10)) {
            console.log(`  ${a.foodName} | "${a.servingDescription}" = ${a.grams}g`);
            console.log(`    → ${a.issue}`);
        }
    }
}

main();

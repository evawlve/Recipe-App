#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n📊 Global Cache Coverage Analysis\n');
    console.log('='.repeat(60) + '\n');

    // Get all cached mappings
    const cached = await (prisma as any).globalIngredientMapping.findMany({
        orderBy: { confidence: 'desc' }
    });

    console.log(`Total Cached Ingredients: ${cached.length}\n`);

    // Confidence breakdown
    const highConf = cached.filter((m: any) => m.confidence >= 0.8);
    const medConf = cached.filter((m: any) => m.confidence >= 0.7 && m.confidence < 0.8);
    const lowConf = cached.filter((m: any) => m.confidence < 0.7);

    console.log('📈 Confidence Distribution:\n');
    console.log(`  High (≥0.8): ${highConf.length} (${(highConf.length / cached.length * 100).toFixed(1)}%)`);
    console.log(`  Medium (0.7-0.79): ${medConf.length} (${(medConf.length / cached.length * 100).toFixed(1)}%)`);
    console.log(`  Low (<0.7): ${lowConf.length} (${(lowConf.length / cached.length * 100).toFixed(1)}%)`);

    // Auto-mapped percentage (>= 0.7 threshold)
    const autoMappable = cached.filter((m: any) => m.confidence >= 0.7 || m.isUserOverride);
    console.log(`\n✅ Auto-Mappable (≥0.7 or override): ${autoMappable.length} (${(autoMappable.length / cached.length * 100).toFixed(1)}%)\n`);

    // Usage stats
    const used = cached.filter((m: any) => m.usageCount > 0);
    const avgUsage = cached.reduce((sum: number, m: any) => sum + m.usageCount, 0) / cached.length;

    console.log('📊 Usage Statistics:\n');
    console.log(`  Used at least once: ${used.length} (${(used.length / cached.length * 100).toFixed(1)}%)`);
    console.log(`  Average usage: ${avgUsage.toFixed(1)}x per ingredient`);

    // Most used
    const topUsed = [...cached].sort((a: any, b: any) => b.usageCount - a.usageCount).slice(0, 10);
    console.log(`\n🔥 Top 10 Most Used:\n`);
    topUsed.forEach((m: any, i: number) => {
        console.log(`  ${i + 1}. "${m.normalizedName}" - ${m.usageCount}x (conf: ${(m.confidence * 100).toFixed(0)}%)`);
    });

    // Low confidence items
    if (lowConf.length > 0) {
        console.log(`\n⚠️  Items Below 0.7 Threshold (${lowConf.length} total):\n`);
        lowConf.slice(0, 20).forEach((m: any, i: number) => {
            console.log(`  ${i + 1}. "${m.normalizedName}"`);
            console.log(`     Confidence: ${(m.confidence * 100).toFixed(1)}% | Source: ${m.source} | Used: ${m.usageCount}x`);
            console.log(`     Reason: ${analyzeWhyLowConfidence(m)}\n`);
        });

        if (lowConf.length > 20) {
            console.log(`  ... and ${lowConf.length - 20} more\n`);
        }
    }

    // Source breakdown
    const fatsecret = cached.filter((m: any) => m.source === 'fatsecret');
    const fdc = cached.filter((m: any) => m.source === 'fdc');

    console.log('📦 Source Distribution:\n');
    console.log(`  FatSecret: ${fatsecret.length} (${(fatsecret.length / cached.length * 100).toFixed(1)}%)`);
    console.log(`  FDC (USDA): ${fdc.length} (${(fdc.length / cached.length * 100).toFixed(1)}%)\n`);

    console.log('='.repeat(60));
    console.log(`\n💡 Summary:\n`);
    console.log(`  • ${autoMappable.length}/${cached.length} ingredients will auto-map (${(autoMappable.length / cached.length * 100).toFixed(0)}%)`);
    console.log(`  • ${lowConf.length} ingredients need review or re-mapping`);
    console.log(`  • Average confidence: ${(cached.reduce((sum: number, m: any) => sum + m.confidence, 0) / cached.length * 100).toFixed(1)}%`);
    console.log();
}

function analyzeWhyLowConfidence(mapping: any): string {
    const conf = mapping.confidence;

    if (conf < 0.5) {
        return 'Very low match - might be ambiguous or uncommon ingredient';
    } else if (conf < 0.6) {
        return 'Low match - possibly brand name, prep phrase, or unusual serving';
    } else {
        return 'Slightly below threshold - could benefit from exact match boost';
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

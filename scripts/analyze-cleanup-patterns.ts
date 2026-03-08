#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n📊 Cleanup Pattern Performance Dashboard\n');
    console.log('='.repeat(60) + '\n');

    // Get all patterns with stats
    const patterns = await prisma.ingredientCleanupPattern.findMany({
        orderBy: [
            { usageCount: 'desc' }
        ],
        include: {
            _count: {
                select: { appliedTo: true }
            }
        }
    });

    // Calculate summary stats
    const totalApplications = patterns.reduce((sum, p) => sum + p.usageCount, 0);
    const totalSuccesses = patterns.reduce((sum, p) => sum + p.successCount, 0);
    const totalFailures = patterns.reduce((sum, p) => sum + p.failureCount, 0);
    const overallSuccessRate = totalSuccesses + totalFailures > 0
        ? (totalSuccesses / (totalSuccesses + totalFailures)) * 100
        : 0;

    const aiLearnedCount = patterns.filter(p => p.source === 'AI_LEARNED').length;
    const manualCount = patterns.filter(p => p.source === 'MANUAL').length;

    console.log('📈 Overall Statistics:\n');
    console.log(`  Total Patterns: ${patterns.length}`);
    console.log(`    - Manual: ${manualCount}`);
    console.log(`    - AI Learned: ${aiLearnedCount}`);
    console.log(`  Total Applications: ${totalApplications}`);
    console.log(`  Overall Success Rate: ${overallSuccessRate.toFixed(1)}%`);
    console.log(`  Successful Cleanups: ${totalSuccesses}`);
    console.log(`  Failed Cleanups: ${totalFailures}\n`);

    // Estimate AI savings
    const estimatedAiCallsSaved = totalApplications;
    const estimatedCostSaved = estimatedAiCallsSaved * 0.0002; // $0.0002 per call

    console.log('💰 Estimated AI Savings:\n');
    console.log(`  AI Calls Avoided: ${estimatedAiCallsSaved}`);
    console.log(`  Cost Saved: $${estimatedCostSaved.toFixed(4)}`);
    console.log(`  (Assuming $0.0002 per AI call)\n`);

    console.log('='.repeat(60) + '\n');

    // Top performers
    console.log('🏆 Top 15 Most Used Patterns:\n');
    patterns.slice(0, 15).forEach((p, i) => {
        const sr = p.successRate !== null ? `${(p.successRate * 100).toFixed(0)}%` : 'N/A';
        const badge = p.source === 'AI_LEARNED' ? '🤖' : '✍️';

        console.log(`${i + 1}. ${badge} ${p.description || 'No description'}`);
        console.log(`   Pattern: "${p.pattern}"`);
        console.log(`   Type: ${p.patternType} | Source: ${p.source}`);
        console.log(`   Usage: ${p.usageCount}x | Success: ${sr} | Confidence: ${p.confidence.toFixed(2)}\n`);
    });

    // Pattern type breakdown
    console.log('='.repeat(60) + '\n');
    console.log('📋 Pattern Type Breakdown:\n');

    const typeGroups = patterns.reduce((acc, p) => {
        if (!acc[p.patternType]) {
            acc[p.patternType] = { count: 0, usage: 0 };
        }
        acc[p.patternType].count++;
        acc[p.patternType].usage += p.usageCount;
        return acc;
    }, {} as Record<string, { count: number; usage: number }>);

    Object.entries(typeGroups)
        .sort((a, b) => b[1].usage - a[1].usage)
        .forEach(([type, stats]) => {
            console.log(`  ${type}:`);
            console.log(`    Patterns: ${stats.count} | Total Usage: ${stats.usage}x\n`);
        });

    // Low performers (candidates for review)
    const lowPerformers = patterns.filter(p =>
        p.usageCount > 5 &&
        p.successRate !== null &&
        p.successRate < 0.3
    );

    if (lowPerformers.length > 0) {
        console.log('='.repeat(60) + '\n');
        console.log('⚠️  Low Performing Patterns (Consider Removing):\n');
        lowPerformers.forEach(p => {
            console.log(`- ${p.description}`);
            console.log(`  Pattern: "${p.pattern}"`);
            console.log(`  Success Rate: ${(p.successRate! * 100).toFixed(1)}% (${p.successCount}/${p.successCount + p.failureCount})`);
            console.log(`  Recommendation: ${p.successRate! < 0.1 ? '🔴 Remove' : '🟡 Review'}\n`);
        });
    }

    // Recent activity
    const recentApplications = await prisma.ingredientCleanupApplication.findMany({
        orderBy: { appliedAt: 'desc' },
        take: 10,
        include: {
            pattern: {
                select: {
                    description: true,
                    pattern: true
                }
            }
        }
    });

    if (recentApplications.length > 0) {
        console.log('='.repeat(60) + '\n');
        console.log('🕐 Recent Pattern Applications:\n');
        recentApplications.forEach((app, i) => {
            const status = app.mappingSucceeded ? '✅' : '❌';
            console.log(`${i + 1}. ${status} "${app.rawInput}" → "${app.cleanedOutput}"`);
            console.log(`   Pattern: ${app.pattern.description}`);
            console.log(`   Applied: ${app.appliedAt.toLocaleString()}\n`);
        });
    }

    // Recommendations
    console.log('='.repeat(60) + '\n');
    console.log('💡 Recommendations:\n');

    if (aiLearnedCount === 0) {
        console.log('  - No AI-learned patterns yet. Run auto-mapping on more recipes to learn patterns.');
    } else if (aiLearnedCount < 10) {
        console.log(`  - ${aiLearnedCount} AI-learned patterns. Continue importing recipes to build pattern library.`);
    } else {
        console.log(`  - ${aiLearnedCount} AI-learned patterns. Good coverage!`);
    }

    if (lowPerformers.length > 0) {
        console.log(`  - ${lowPerformers.length} low-performing patterns detected. Review and consider removing.`);
    }

    if (overallSuccessRate < 70) {
        console.log('  - Overall success rate is low. Consider adjusting confidence thresholds.');
    } else if (overallSuccessRate > 90) {
        console.log('  - Excellent success rate! System is performing well.');
    }

    console.log('\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

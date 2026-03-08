#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🧪 Testing Cleanup Pattern Migration\n');

    try {
        // Test 1: Check if tables exist
        console.log('1️⃣  Checking if tables exist...');
        const patterns = await prisma.ingredientCleanupPattern.findMany();
        console.log(`   ✅ Found ${patterns.length} cleanup patterns\n`);

        // Test 2: Verify enums work
        console.log('2️⃣  Checking enum values...');
        const enumTest = await prisma.ingredientCleanupPattern.create({
            data: {
                pattern: '^test_enum_check$',
                patternType: 'MEASUREMENT_PREFIX',
                replacement: '',
                source: 'MANUAL',
                confidence: 0.5
            }
        });
        console.log(`   ✅ Enum types working correctly\n`);

        // Clean up test pattern
        await prisma.ingredientCleanupPattern.delete({
            where: { id: enumTest.id }
        });

        // Test 3: Check initial seeded patterns
        console.log('3️⃣  Verifying initial patterns...');
        const measurementPatterns = patterns.filter(p => p.patternType === 'MEASUREMENT_PREFIX');
        const prepPatterns = patterns.filter(p => p.patternType === 'PREP_PHRASE');
        const artifactPatterns = patterns.filter(p => p.patternType === 'PARSING_ARTIFACT');
        const sizePatterns = patterns.filter(p => p.patternType === 'SIZE_PHRASE');

        console.log(`   Measurement Prefix: ${measurementPatterns.length}`);
        console.log(`   Prep Phrases: ${prepPatterns.length}`);
        console.log(`   Parsing Artifacts: ${artifactPatterns.length}`);
        console.log(`   Size Phrases: ${sizePatterns.length}`);
        console.log(`   ✅ Total: ${patterns.length} patterns\n`);

        // Test 4: Display some patterns
        console.log('4️⃣  Sample patterns:\n');
        patterns.slice(0, 5).forEach((p, i) => {
            console.log(`   ${i + 1}. ${p.description}`);
            console.log(`      Pattern: "${p.pattern}"`);
            console.log(`      Type: ${p.patternType} | Confidence: ${p.confidence}\n`);
        });

        console.log('✅ Migration test passed!\n');
        console.log('📝 Next steps:');
        console.log('   1. Run: npx prisma generate');
        console.log('   2. Restart your dev server');
        console.log('   3. Test cleanup patterns with: npx ts-node scripts/test-cleanup-system.ts\n');

    } catch (error) {
        console.error('❌ Migration test failed:', error);
        console.log('\n💡 Did you apply the migration in Supabase?');
        console.log('   Check: prisma/migrations/20241124184000_add_ingredient_cleanup_patterns/README.md');
        process.exitCode = 1;
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());

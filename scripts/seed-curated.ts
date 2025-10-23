#!/usr/bin/env ts-node

import { seedCuratedFromFile } from '@/ops/curated/seed-curated';

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry-run');
  const file = args.find(arg => !arg.startsWith('--')) || 'data/curated/pack-basic.json';
  
  console.log(`🌱 Curated Seed Script`);
  console.log(`📁 File: ${file}`);
  if (dry) {
    console.log('🔍 DRY RUN MODE - No data will be imported');
  }
  
  const res = await seedCuratedFromFile(file, { dryRun: dry });
  
  console.log('\n📈 Seed Results:');
  console.log(`  ✅ Created: ${res.created}`);
  console.log(`  🔄 Updated: ${res.updated}`);
  console.log(`  📏 Units Created: ${res.unitCreated}`);
  console.log(`  🏷️  Aliases Created: ${res.aliCreated}`);
  
  if (dry) {
    console.log('\n🔍 This was a dry run. Use without --dry-run to actually import.');
  } else {
    console.log('\n🎉 Seeding completed successfully!');
  }
}

// Run the script
if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

#!/usr/bin/env ts-node

import { seedCuratedFromFile } from '@/ops/curated/seed-curated';
import fs from 'fs';
import path from 'path';

(async () => {
  const arg = process.argv[2] || 'data/curated';
  const root = path.resolve(arg);

  const files = fs.readdirSync(root)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(root, f));

  let totalCreated = 0, totalUpdated = 0, totalUnits = 0, totalAliases = 0;

  for (const f of files) {
    console.log(`🌱 Processing: ${f}`);
    const res = await seedCuratedFromFile(f, { dryRun: false });
    totalCreated += res.created; totalUpdated += res.updated;
    totalUnits += res.unitCreated; totalAliases += res.aliCreated;
  }

  console.log('\n📈 Batch Results:');
  console.log(`  ✅ Created: ${totalCreated}`);
  console.log(`  🔄 Updated: ${totalUpdated}`);
  console.log(`  📏 Units Created: ${totalUnits}`);
  console.log(`  🏷️  Aliases Created: ${totalAliases}`);
  console.log(`  📦 Packs Processed: ${files.length}`);
})();

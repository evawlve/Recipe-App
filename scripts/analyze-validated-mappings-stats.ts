import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const directUrl = process.env.DIRECT_URL;
if (!directUrl) { console.error('❌ DIRECT_URL not set'); process.exit(1); }
const prisma = new PrismaClient({ datasources: { db: { url: directUrl } } });

async function main() {
  console.log('📊 Analyzing ValidatedMapping table (this might take a minute)...');
  
  // 1. Total counts & Brands
  const total = await prisma.validatedMapping.count();
  
  const brandedCount = await prisma.validatedMapping.count({
    where: { brandName: { not: null, not: '' } }
  });

  const genericCount = total - brandedCount;

  // 2. Source distribution
  const sources = await prisma.validatedMapping.groupBy({
    by: ['source'],
    _count: { source: true },
    orderBy: { _count: { source: 'desc' } }
  });

  // 3. Top Brands
  const topBrands = await prisma.validatedMapping.groupBy({
    by: ['brandName'],
    where: { brandName: { not: null, not: '' } },
    _count: { brandName: true },
    orderBy: { _count: { brandName: 'desc' } },
    take: 20
  });

  // 4. Most heavily mapped targets (foods that have the most ingredients pointing to them)
  const topTargets = await prisma.validatedMapping.groupBy({
    by: ['foodName', 'brandName'],
    _count: { foodName: true },
    orderBy: { _count: { foodName: 'desc' } },
    take: 20
  });

  // 5. Check for exact normalizedForm duplicates
  const duplicateNormalized = await prisma.$queryRaw`
    SELECT "normalizedForm", COUNT(*) as count 
    FROM "ValidatedMapping" 
    GROUP BY "normalizedForm" 
    HAVING COUNT(*) > 1 
    ORDER BY count DESC 
    LIMIT 10;
  `;

  // 6. Produce items estimate (FDC items with no brand often include raw produce)
  const fdcGenericCount = await prisma.validatedMapping.count({
    where: { source: 'fdc', brandName: null }
  });

  console.log('\n==========================================');
  console.log('📈 VALIDATED MAPPINGS ANALYSIS');
  console.log('==========================================');
  console.log(`Total Mappings: ${total.toLocaleString()}`);
  console.log(`Branded Items:  ${brandedCount.toLocaleString()} (${((brandedCount/total)*100).toFixed(1)}%)`);
  console.log(`Generic Items:  ${genericCount.toLocaleString()} (${((genericCount/total)*100).toFixed(1)}%)`);
  
  console.log('\n🌍 SOURCES');
  for (const s of sources) {
    console.log(`- ${s.source}: ${s._count.source.toLocaleString()}`);
  }

  console.log('\n🏢 TOP 15 BRANDS');
  for (const b of topBrands.slice(0, 15)) {
    console.log(`- ${b.brandName}: ${b._count.brandName.toLocaleString()} items`);
  }

  console.log('\n🎯 TOP 15 MOST MAPPED FOODS (Catch-alls)');
  for (const t of topTargets.slice(0, 15)) {
    const brand = t.brandName ? `(${t.brandName})` : '(Generic)';
    console.log(`- ${t.foodName} ${brand}: ${t._count.foodName.toLocaleString()} incoming ingredients`);
  }

  console.log('\n👯 TOP EXACT DUPLICATES (Same normalizedForm mapped multiple times)');
  for (const d of duplicateNormalized as any[]) {
    console.log(`- "${d.normalizedForm}": ${Number(d.count)} times`);
  }

  console.log('\n🥦 PRODUCE ESTIMATE');
  console.log(`- Unbranded FDC Items (often fresh produce / pantry staples): ${fdcGenericCount.toLocaleString()}`);

  console.log('\n==========================================');
}

main().catch(console.error).finally(() => prisma.$disconnect());

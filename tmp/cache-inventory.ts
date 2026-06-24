import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const count = await prisma.validatedMapping.count();
    const branded = await prisma.validatedMapping.count({ where: { brandName: { not: null } } });
    const bySource = await prisma.validatedMapping.groupBy({ by: ['source'], _count: true });
    const highConf = await prisma.validatedMapping.count({ where: { aiConfidence: { gte: 0.9 } } });
    const fdc = await prisma.fdcFoodCache.count();
    const fdcServing = await prisma.fdcServingCache.count();
    const fsServing = await prisma.fatSecretServingCache.count();
    const offServing = await prisma.openFoodFactsServingCache.count();

    console.log('=== Cache Inventory ===');
    console.log(`ValidatedMapping total:   ${count.toLocaleString()}`);
    console.log(`  branded (brandName≠null): ${branded.toLocaleString()}`);
    console.log(`  high confidence (≥0.9):   ${highConf.toLocaleString()}`);
    console.log(`  by source:`, bySource.map(r => `${r.source}=${r._count}`).join(', '));
    console.log(`FdcFoodCache:             ${fdc.toLocaleString()}`);
    console.log(`FdcServingCache:          ${fdcServing.toLocaleString()}`);
    console.log(`FatSecretServingCache:    ${fsServing.toLocaleString()}`);
    console.log(`OpenFoodFactsServingCache: ${offServing.toLocaleString()}`);
    await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });

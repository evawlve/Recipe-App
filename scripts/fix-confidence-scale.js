// One-off repair: clamp FoodMapping.aiConfidence to [0,1] (bug: LLM-scale values like 1.9 were cached verbatim)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const bad = await prisma.foodMapping.findMany({
        where: { aiConfidence: { gt: 1.0 } },
        select: { normalizedForm: true, foodName: true, aiConfidence: true },
    });
    console.log(`Rows with aiConfidence > 1.0: ${bad.length}`);
    for (const r of bad) console.log(`  ${r.aiConfidence.toFixed(2)}  ${r.normalizedForm} -> ${r.foodName}`);

    if (bad.length > 0) {
        const res = await prisma.$executeRaw`UPDATE "FoodMapping" SET "aiConfidence" = LEAST("aiConfidence", 1.0) WHERE "aiConfidence" > 1.0`;
        console.log(`Clamped ${res} rows.`);
    }

    const low = await prisma.foodMapping.count({ where: { aiConfidence: { lt: 0 } } });
    if (low > 0) {
        const res = await prisma.$executeRaw`UPDATE "FoodMapping" SET "aiConfidence" = 0 WHERE "aiConfidence" < 0`;
        console.log(`Raised ${res} negative rows to 0.`);
    }
}

main().finally(() => prisma.$disconnect());

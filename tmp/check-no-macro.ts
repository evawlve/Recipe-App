import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
    // Sample 5 of the FDC entries that the dry run says "has no usable nutrients"
    const testIds = [168757, 170273, 167560, 2023754, 169624];
    const rows = await p.fdcFoodCache.findMany({
        where: { id: { in: testIds } },
        select: { id: true, description: true, nutrients: true }
    });

    for (const r of rows) {
        const n = r.nutrients as Record<string, unknown> ?? {};
        const keys = Object.keys(n);
        console.log(`\n[${r.id}] ${r.description.slice(0,50)}`);
        console.log(`  Total nutrient keys: ${keys.length}`);
        console.log(`  Keys: ${keys.slice(0,10).join(', ')}`);
        console.log(`  1008(kcal): ${n['1008']}`);
        console.log(`  1003(protein): ${n['1003']}`);
        console.log(`  1005(carbs): ${n['1005']}`);
        console.log(`  1004(fat): ${n['1004']}`);
        // Check if maybe it uses named keys
        console.log(`  'calories': ${n['calories']}`);
        console.log(`  'energy': ${n['energy']}`);
        // Print first 5 entries raw
        const first5 = Object.entries(n).slice(0, 5);
        console.log(`  First 5 entries:`, first5);
    }
}

main().catch(console.error).finally(() => p.$disconnect());

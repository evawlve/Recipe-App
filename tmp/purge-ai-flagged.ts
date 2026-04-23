import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
    const purgeFile = process.argv[2];
    if (!purgeFile) {
        console.error('Usage: purge-ai-flagged.ts <purge-list.json>');
        process.exit(1);
    }

    const list = JSON.parse(fs.readFileSync(purgeFile, 'utf-8')) as Array<{
        id: string; rawIngredient: string; foodName: string; reason: string;
    }>;

    console.log(`🗑️  Purging ${list.length} AI-flagged ValidatedMapping entries...\n`);

    let purged = 0;
    for (const entry of list) {
        try {
            await p.validatedMapping.delete({ where: { id: entry.id } });
            console.log(`  ✅ Deleted: "${entry.rawIngredient}" → "${entry.foodName}"`);
            console.log(`     Reason: ${entry.reason}`);
            purged++;
        } catch (err) {
            console.warn(`  ⚠️  Could not delete ${entry.id}: ${(err as Error).message}`);
        }
    }

    const remaining = await p.validatedMapping.count();
    console.log(`\n✅ Purged ${purged}/${list.length} entries.`);
    console.log(`   ValidatedMapping now has ${remaining} entries.`);
}

main().catch(console.error).finally(() => p.$disconnect());

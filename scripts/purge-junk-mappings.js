// User-approved one-off (2026-07-17): delete the 7 cached mappings that were saved with
// 1-10-scale LLM confidence AND map to wrong products (junk hijacks documented in
// sync-docs/mapping_eval_harness.md). Deleting a FoodMapping row just re-triggers a
// fresh mapping through the fixed pipeline on next lookup.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const JUNK = [
    'avocado',        // -> 100 Percent Pure Avocado Oil
    'an avocado',     // -> Dip extra whipped vegan avocado ranch
    'garlic',         // -> "vampire slayer" garlic cheddar
    'cilantro',       // -> 90 Second Cilantro Lime Rice
    'carrot',         // -> 12 gummy carrots
    'egg',            // -> 1 Dozen Farm Fresh Eggs (zero-macro)
    'onion red',      // -> 5/8 Beer Bartered Onion Rings
];

async function main() {
    const rows = await prisma.foodMapping.findMany({
        where: { normalizedForm: { in: JUNK } },
        select: { normalizedForm: true, foodName: true },
    });
    for (const r of rows) console.log(`deleting: ${r.normalizedForm} -> ${r.foodName}`);
    const res = await prisma.foodMapping.deleteMany({ where: { normalizedForm: { in: JUNK } } });
    console.log(`Deleted ${res.count} junk cached mappings.`);
}

main().finally(() => prisma.$disconnect());

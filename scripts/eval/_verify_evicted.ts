/**
 * _verify_evicted.ts — read-only post-eviction check, on a SEPARATE connection.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_verify_evicted.ts <keys.json> --expect-count <n>
 *
 * Passes only if FoodMapping's live count equals <n> AND none of the keys is
 * still present. Exit 0 = ok, 2 = failed / error. Writes nothing.
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { parseKeysText } from './_evict_rows';

export function verifyEvicted(
    expectCount: number,
    liveCount: number,
    presentKeys: string[],
): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    if (liveCount !== expectCount) {
        reasons.push(`count check failed: FoodMapping has ${liveCount} rows, expected ${expectCount}`);
    }
    if (presentKeys.length) {
        reasons.push(`presence check failed: ${presentKeys.length} evicted key(s) still present: ${presentKeys.slice(0, 5).join(' | ')}`);
    }
    return { ok: reasons.length === 0, reasons };
}

async function main(): Promise<number> {
    const argv = process.argv.slice(2);
    const usage = 'usage: _verify_evicted.ts <keys.json> --expect-count <n>';
    if (argv.length !== 3 || argv[1] !== '--expect-count' || !/^\d+$/.test(argv[2])) {
        console.error(`REFUSING: ${usage}`);
        return 2;
    }
    let text: string;
    try { text = fs.readFileSync(argv[0], 'utf8'); } catch (e) {
        console.error(`REFUSING: cannot read keys file ${argv[0]}: ${(e as Error).message}`);
        return 2;
    }
    const parsed = parseKeysText(text);
    if (!parsed.ok) {
        console.error(`REFUSING: ${parsed.reason}`);
        return 2;
    }
    const prisma = new PrismaClient();
    try {
        const live = await prisma.foodMapping.count();
        const rows = await prisma.foodMapping.findMany({
            where: { normalizedForm: { in: parsed.keys } },
            select: { normalizedForm: true },
        });
        const verdict = verifyEvicted(Number(argv[2]), live, rows.map(r => r.normalizedForm));
        if (!verdict.ok) {
            for (const r of verdict.reasons) console.error(`VERIFY FAIL: ${r}`);
            return 2;
        }
        console.log(`VERIFY OK: FoodMapping ${live} rows; none of ${parsed.keys.length} key(s) present.`);
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}

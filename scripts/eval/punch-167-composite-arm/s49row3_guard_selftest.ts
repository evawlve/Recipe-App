/**
 * s49row3_guard_selftest.ts — prove the strengthened write guard intercepts the
 * raw AiNormalizeCache useCount bump BEFORE any mapper call is made.
 *
 * ZERO WRITE RISK BY CONSTRUCTION: the only key it touches is a random string
 * that cannot exist, so even a total guard failure updates 0 rows.
 */
const MUTATING = new Set(['create','createMany','createManyAndReturn','update','updateMany','upsert','delete','deleteMany','executeRaw','executeRawUnsafe']);
const RAW_ACTIONS = new Set(['queryRaw', 'queryRawUnsafe']);
const MUTATING_SQL = /^\s*(UPDATE|INSERT|DELETE|TRUNCATE|ALTER|DROP|CREATE)\b/i;
const suppressed: Record<string, number> = {};
const seenRaw: string[] = [];

function rawSqlOf(args: any): string {
    try {
        if (!args) return '';
        if (typeof args === 'string') return args;
        if (Array.isArray(args)) {
            const first = args[0];
            if (typeof first === 'string') return first;
            if (first && Array.isArray(first.strings)) return first.strings.join(' ');
            if (first && Array.isArray(first)) return first.join(' ');
            if (first && typeof first.sql === 'string') return first.sql;
            if (first && typeof first.text === 'string') return first.text;
        }
        if (typeof args.sql === 'string') return args.sql;
        if (Array.isArray(args.strings)) return args.strings.join(' ');
        return JSON.stringify(args).slice(0, 400);
    } catch { return ''; }
}

const { prisma } = require('@/lib/db');
prisma.$use(async (params: any, next: any) => {
    if (MUTATING.has(params.action)) {
        const k = `${params.model ?? 'raw'}.${params.action}`;
        suppressed[k] = (suppressed[k] ?? 0) + 1;
        return null;
    }
    if (RAW_ACTIONS.has(params.action)) {
        const sql = rawSqlOf(params.args);
        seenRaw.push(`${params.action} :: ${sql.replace(/\s+/g, ' ').slice(0, 120)}`);
        if (MUTATING_SQL.test(sql)) {
            suppressed[`raw.${params.action}:MUTATING`] = (suppressed[`raw.${params.action}:MUTATING`] ?? 0) + 1;
            return null;
        }
    }
    return next(params);
});

async function main() {
    const { getAiNormalizeCache } = require('@/lib/mapping/validated-mapping-helpers');
    const bogus = `s49row3-nonexistent-${Math.random().toString(36).slice(2)}-key`;

    console.warn('--- test 1: a raw SELECT must PASS THROUGH ---');
    const sel = await prisma.$queryRaw`SELECT 1 as one`;
    console.warn('   raw SELECT returned:', JSON.stringify(sel));

    console.warn('--- test 2: getAiNormalizeCache on a key that cannot exist ---');
    const r = await getAiNormalizeCache(bogus);
    console.warn('   returned:', JSON.stringify(r));

    console.warn('');
    console.warn('RAW STATEMENTS SEEN BY THE MIDDLEWARE:');
    for (const s of seenRaw) console.warn('   ' + s);
    console.warn('');
    console.warn('SUPPRESSED:', JSON.stringify(suppressed));
    const gotRaw = Object.keys(suppressed).some(k => k.startsWith('raw.queryRaw'));
    console.warn('');
    console.warn(gotRaw
        ? 'PASS: the raw UPDATE ... RETURNING was INTERCEPTED. winner-diff does NOT do this.'
        : 'FAIL: the raw UPDATE was NOT intercepted — do NOT run the mapper with this guard.');
    await prisma.$disconnect();
}
main().then(() => process.exit(0)).catch(e => { console.error('ERR', e?.message ?? e); process.exit(1); });

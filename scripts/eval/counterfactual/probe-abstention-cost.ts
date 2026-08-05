/* Scratch probe: what does dropping the abstention confidence to 0.78 cost in cache admission? */
import fs from 'fs';
import { assessSubThresholdAdmission } from '../../../src/lib/mapping/sub-threshold-admission';
import { detectBrandInQuery } from '../../../src/lib/mapping/brand-detector';

const NEW = Number(process.argv[3] ?? 0.78);
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tally: Record<string, number> = {};
const drops: string[] = [];
for (const r of rows) {
    const n = r.nut;
    const per100 = n && n.perGrams > 0 ? {
        kcal: (n.calories / n.perGrams) * 100,
        protein: (n.protein / n.perGrams) * 100,
        carbs: (n.carbs / n.perGrams) * 100,
        fat: (n.fat / n.perGrams) * 100,
    } : undefined;
    const bd = detectBrandInQuery(r.raw);
    const res = assessSubThresholdAdmission({
        rawLine: r.raw,
        confidence: NEW,
        brandDetection: { isBranded: bd.isBranded, matchedBrand: bd.matchedBrand },
        foodName: r.name ?? '',
        brandName: r.brand ?? null,
        nutrientsPer100g: per100,
    });
    const k = res.admit ? 'ADMIT (insertOnly)' : `DROP:${res.reason}`;
    tally[k] = (tally[k] ?? 0) + 1;
    if (!res.admit) drops.push(`  ${res.reason}  ${JSON.stringify(r.raw)} -> ${JSON.stringify(r.name)} [${r.foodId}] brand=${JSON.stringify(r.brand)}`);
}
console.log(`n=${rows.length} at new confidence ${NEW}`);
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`);
console.log('--- drops');
console.log([...new Set(drops)].join('\n'));

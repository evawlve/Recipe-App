#!/usr/bin/env ts-node
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const papaparse_1 = __importDefault(require("papaparse"));
const zod_1 = require("zod");
const seed_schema_1 = require("@/ops/curated/seed-schema");
const category_defaults_1 = require("@/ops/curated/category-defaults");
const Row = zod_1.z.object({
    id: zod_1.z.string().min(2),
    name: zod_1.z.string().min(2),
    brand: zod_1.z.string().optional().nullable(),
    categoryId: zod_1.z.string().optional().nullable(),
    densityGml: zod_1.z.string().optional().nullable(),
    kcal100: zod_1.z.string().optional().nullable(),
    protein100: zod_1.z.string().optional().nullable(),
    carbs100: zod_1.z.string().optional().nullable(),
    fat100: zod_1.z.string().optional().nullable(),
    fiber100: zod_1.z.string().optional().nullable(),
    sugar100: zod_1.z.string().optional().nullable(),
    aliases: zod_1.z.string().optional().nullable(),
    verification: zod_1.z.string().optional().nullable(), // verified|unverified|suspect
    popularity: zod_1.z.string().optional().nullable(),
    units: zod_1.z.string().optional().nullable(), // JSON or blank
});
function numOrNull(s) {
    if (s == null || s === '')
        return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
function parseUnits(raw, categoryId) {
    if (raw && raw.trim().length) {
        try {
            return JSON.parse(raw);
        }
        catch { }
    }
    if (categoryId && category_defaults_1.CATEGORY_DEFAULTS[categoryId]?.units) {
        return category_defaults_1.CATEGORY_DEFAULTS[categoryId].units;
    }
    return [];
}
(async function main() {
    const csvPath = process.argv[2];
    const outPath = process.argv[3] || 'data/curated/pack-generated.json';
    if (!csvPath) {
        console.error('Usage: ts-node --transpile-only scripts/curated-from-csv.ts <input.csv> [output.json]');
        process.exit(1);
    }
    const csv = fs_1.default.readFileSync(path_1.default.resolve(csvPath), 'utf-8');
    const { data, errors } = papaparse_1.default.parse(csv, { header: true, skipEmptyLines: true });
    if (errors.length) {
        console.error('CSV parse errors:', errors.slice(0, 3));
        process.exit(1);
    }
    const rows = data.map((r) => Row.parse(r));
    const items = rows.map((r) => {
        const categoryId = r.categoryId ?? null;
        const density = numOrNull(r.densityGml) ?? category_defaults_1.CATEGORY_DEFAULTS[categoryId ?? '']?.densityGml ?? null;
        const aliases = (r.aliases ?? '')
            .split(';')
            .map(s => s.trim())
            .filter(Boolean);
        const obj = {
            id: r.id,
            name: r.name,
            brand: r.brand ?? null,
            categoryId,
            densityGml: density,
            kcal100: numOrNull(r.kcal100) ?? 0,
            protein100: numOrNull(r.protein100) ?? 0,
            carbs100: numOrNull(r.carbs100) ?? 0,
            fat100: numOrNull(r.fat100) ?? 0,
            fiber100: numOrNull(r.fiber100),
            sugar100: numOrNull(r.sugar100),
            units: parseUnits(r.units ?? null, categoryId),
            aliases,
            verification: r.verification ?? 'verified',
            popularity: Number(numOrNull(r.popularity) ?? 1),
        };
        return obj;
    });
    const pack = {
        meta: { name: path_1.default.basename(outPath, '.json'), version: 1 },
        items,
    };
    // Validate with your CuratedPackSchema
    const valid = seed_schema_1.CuratedPackSchema.parse(pack);
    fs_1.default.mkdirSync(path_1.default.dirname(outPath), { recursive: true });
    fs_1.default.writeFileSync(outPath, JSON.stringify(valid, null, 2));
    console.log(`Wrote ${valid.items.length} items → ${outPath}`);
})();

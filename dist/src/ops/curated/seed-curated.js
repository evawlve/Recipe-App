"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedCuratedFromFile = seedCuratedFromFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("@/lib/db");
const seed_schema_1 = require("./seed-schema");
const logger_1 = require("@/lib/logger");
function canonicalize(s) {
    return s.toLowerCase().replace(/\(.*?\)/g, '').replace(/[,.-]/g, ' ').replace(/\s+/g, ' ').trim();
}
async function seedCuratedFromFile(filePath, { dryRun = false } = {}) {
    const abs = path_1.default.resolve(process.cwd(), filePath);
    const raw = JSON.parse(fs_1.default.readFileSync(abs, 'utf-8'));
    const parsed = seed_schema_1.CuratedPackSchema.parse(raw);
    let created = 0, updated = 0, aliCreated = 0, unitCreated = 0;
    for (const it of parsed.items) {
        const name = it.name.trim();
        const exists = await db_1.prisma.food.findUnique({ where: { id: it.id } });
        if (!exists) {
            if (!dryRun) {
                await db_1.prisma.food.create({
                    data: {
                        id: it.id,
                        name,
                        brand: it.brand ?? null,
                        categoryId: it.categoryId ?? null,
                        source: 'template',
                        verification: it.verification,
                        densityGml: it.densityGml ?? null,
                        kcal100: it.kcal100,
                        protein100: it.protein100,
                        carbs100: it.carbs100,
                        fat100: it.fat100,
                        fiber100: it.fiber100 ?? null,
                        sugar100: it.sugar100 ?? null,
                        popularity: it.popularity,
                        units: it.units.length ? { create: it.units.map(u => ({ label: u.label, grams: u.grams })) } : undefined
                    }
                });
            }
            created++;
        }
        else {
            // Light-touch update to keep curated truth
            if (!dryRun) {
                await db_1.prisma.food.update({
                    where: { id: it.id },
                    data: {
                        name,
                        brand: it.brand ?? null,
                        categoryId: it.categoryId ?? null,
                        verification: it.verification,
                        densityGml: it.densityGml ?? null,
                        kcal100: it.kcal100,
                        protein100: it.protein100,
                        carbs100: it.carbs100,
                        fat100: it.fat100,
                        fiber100: it.fiber100 ?? null,
                        sugar100: it.sugar100 ?? null,
                        popularity: it.popularity
                    }
                });
                // Ensure at least listed units exist (idempotent-ish)
                for (const u of it.units) {
                    const hit = await db_1.prisma.foodUnit.findFirst({ where: { foodId: it.id, label: u.label } });
                    if (!hit) {
                        await db_1.prisma.foodUnit.create({ data: { foodId: it.id, label: u.label, grams: u.grams } });
                        unitCreated++;
                    }
                }
            }
            updated++;
        }
        // Aliases
        for (const a of it.aliases) {
            const alias = canonicalize(a);
            if (!alias)
                continue;
            const have = await db_1.prisma.foodAlias.findFirst({ where: { foodId: it.id, alias } });
            if (!have && !dryRun) {
                await db_1.prisma.foodAlias.create({ data: { foodId: it.id, alias } });
                aliCreated++;
            }
        }
    }
    logger_1.logger.info('curated_seed summary', { feature: 'curated_seed', step: 'summary', file: filePath, created, updated, unitCreated, aliCreated });
    return { created, updated, unitCreated, aliCreated };
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CuratedPackSchema = exports.CuratedItemSchema = exports.UnitSchema = void 0;
const zod_1 = require("zod");
exports.UnitSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    grams: zod_1.z.number().positive()
});
exports.CuratedItemSchema = zod_1.z.object({
    id: zod_1.z.string().min(2),
    name: zod_1.z.string().min(2),
    brand: zod_1.z.string().nullable().optional(),
    categoryId: zod_1.z.string().nullable().optional(),
    densityGml: zod_1.z.number().positive().nullable().optional(),
    kcal100: zod_1.z.number().min(0).max(1200),
    protein100: zod_1.z.number().min(0).max(200),
    carbs100: zod_1.z.number().min(0).max(250),
    fat100: zod_1.z.number().min(0).max(200),
    fiber100: zod_1.z.number().min(0).max(100).nullable().optional(),
    sugar100: zod_1.z.number().min(0).max(200).nullable().optional(),
    units: zod_1.z.array(exports.UnitSchema).default([]),
    aliases: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    verification: zod_1.z.enum(['verified', 'unverified', 'suspect']).default('verified'),
    popularity: zod_1.z.number().int().min(0).max(100).default(1)
});
exports.CuratedPackSchema = zod_1.z.object({
    meta: zod_1.z.object({ name: zod_1.z.string(), version: zod_1.z.number().int().min(1) }),
    items: zod_1.z.array(exports.CuratedItemSchema)
});

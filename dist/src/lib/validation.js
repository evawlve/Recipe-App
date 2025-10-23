"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recipeUpdateSchema = exports.recipeApiSchema = exports.recipeCreateSchema = void 0;
const zod_1 = require("zod");
exports.recipeCreateSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
    servings: zod_1.z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
    bodyMd: zod_1.z.string().min(1, "Instructions are required"),
    ingredients: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().min(1, "Ingredient name is required"),
        qty: zod_1.z.number().positive("Quantity must be positive"),
        unit: zod_1.z.string().min(1, "Unit is required"),
    })).min(1, "At least one ingredient is required"),
    localFiles: zod_1.z.array(zod_1.z.instanceof(File)).optional().default([]),
    tags: zod_1.z.array(zod_1.z.string().min(1).max(24)).max(10).default([]),
});
// Schema for API requests (without File objects)
exports.recipeApiSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
    servings: zod_1.z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
    bodyMd: zod_1.z.string().min(1, "Instructions are required"),
    ingredients: zod_1.z.array(zod_1.z.object({
        name: zod_1.z.string().min(1, "Ingredient name is required"),
        qty: zod_1.z.number().positive("Quantity must be positive"),
        unit: zod_1.z.string().min(1, "Unit is required"),
    })).min(1, "At least one ingredient is required"),
    photos: zod_1.z.array(zod_1.z.object({
        s3Key: zod_1.z.string(),
        width: zod_1.z.number().int().positive(),
        height: zod_1.z.number().int().positive(),
    })).optional().default([]),
    tags: zod_1.z.array(zod_1.z.string().min(1).max(24)).max(10).default([]),
});
// Schema for recipe updates
exports.recipeUpdateSchema = zod_1.z.object({
    title: zod_1.z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters").optional(),
    servings: zod_1.z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100").optional(),
    bodyMd: zod_1.z.string().min(1, "Instructions are required").optional(),
    ingredients: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string().optional(),
        name: zod_1.z.string().min(1, "Ingredient name is required"),
        qty: zod_1.z.number().positive("Quantity must be positive"),
        unit: zod_1.z.string().min(1, "Unit is required"),
    })).min(1, "At least one ingredient is required").optional(),
    tags: zod_1.z.array(zod_1.z.string().min(1).max(24)).max(10).optional(),
});

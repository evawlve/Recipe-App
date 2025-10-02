import { z } from "zod";

export const recipeCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  servings: z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
  bodyMd: z.string().min(1, "Instructions are required"),
  ingredients: z.array(
    z.object({
      name: z.string().min(1, "Ingredient name is required"),
      qty: z.number().positive("Quantity must be positive"),
      unit: z.string().min(1, "Unit is required"),
    })
  ).min(1, "At least one ingredient is required"),
  localFiles: z.array(z.instanceof(File)).optional().default([]),
});

// Schema for API requests (without File objects)
export const recipeApiSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  servings: z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
  bodyMd: z.string().min(1, "Instructions are required"),
  ingredients: z.array(
    z.object({
      name: z.string().min(1, "Ingredient name is required"),
      qty: z.number().positive("Quantity must be positive"),
      unit: z.string().min(1, "Unit is required"),
    })
  ).min(1, "At least one ingredient is required"),
  photos: z.array(
    z.object({
      s3Key: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
  ).optional().default([]),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;

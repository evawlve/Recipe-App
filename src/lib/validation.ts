import { z } from "zod";

export const recipeCreateSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  servings: z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
  bodyMd: z.string().min(1, "Instructions are required"),
  prepTime: z.enum(["<15 min", "15-30 min", "30-45 min", "45min - 1hr", "1hr+"]).optional(),
  ingredients: z.array(
    z.object({
      name: z.string().min(1, "Ingredient name is required"),
      qty: z.number().positive("Quantity must be positive"),
      unit: z.string().default(""), // Allow empty string for countable items (eggs, apples, etc.)
      original: z.string().optional(),
    })
  ).min(1, "At least one ingredient is required"),
  localFiles: z.array(z.instanceof(File)).optional().default([]),
  tags: z.array(z.string().min(1).max(24)).max(10).default([]),
  // New tag classification fields
  mealType: z.array(z.string()).min(1, "Meal type is required"),
  cuisine: z.array(z.string()).default([]),
  method: z.array(z.string()).default([]),
  diet: z.array(z.string()).default([]),
});

// Schema for API requests (without File objects)
export const recipeApiSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  servings: z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100"),
  bodyMd: z.string().min(1, "Instructions are required"),
  prepTime: z.enum(["<15 min", "15-30 min", "30-45 min", "45min - 1hr", "1hr+"]).optional(),
  ingredients: z.array(
    z.object({
      name: z.string().min(1, "Ingredient name is required"),
      qty: z.number().positive("Quantity must be positive"),
      unit: z.string().default(""), // Allow empty string for countable items (eggs, apples, etc.)
      original: z.string().optional(),
    })
  ).min(1, "At least one ingredient is required"),
  photos: z.array(
    z.object({
      s3Key: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
  ).optional().default([]),
  tags: z.array(z.string().min(1).max(24)).max(10).default([]),
  // New tag classification fields
  mealType: z.array(z.string()).min(1, "Meal type is required"),
  cuisine: z.array(z.string()).default([]),
  method: z.array(z.string()).default([]),
  diet: z.array(z.string()).default([]),
});

export type RecipeCreateInput = z.infer<typeof recipeCreateSchema>;

// Schema for recipe updates
export const recipeUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title must be less than 200 characters").optional(),
  servings: z.number().int().min(1, "Servings must be at least 1").max(100, "Servings must be less than 100").optional(),
  bodyMd: z.string().min(1, "Instructions are required").optional(),
  prepTime: z.enum(["<15 min", "15-30 min", "30-45 min", "45min - 1hr", "1hr+"]).optional(),
  ingredients: z.array(
    z.object({
      id: z.string().optional(),
      name: z.string().min(1, "Ingredient name is required"),
      qty: z.number().positive("Quantity must be positive"),
      unit: z.string().default(""), // Allow empty string for countable items (eggs, apples, etc.)
      original: z.string().optional(),
    })
  ).min(1, "At least one ingredient is required").optional(),
  tags: z.array(z.string().min(1).max(24)).max(10).optional(),
  photos: z.array(
    z.object({
      s3Key: z.string(),
      width: z.number().int().positive(),
      height: z.number().int().positive(),
    })
  ).optional(),
});

export type RecipeUpdateInput = z.infer<typeof recipeUpdateSchema>;

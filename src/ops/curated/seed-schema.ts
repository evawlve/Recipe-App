import { z } from 'zod';

export const UnitSchema = z.object({
  label: z.string().min(1),
  grams: z.number().positive()
});

export const CuratedItemSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  brand: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  densityGml: z.number().positive().nullable().optional(),
  kcal100: z.number().min(0).max(1200),
  protein100: z.number().min(0).max(200),
  carbs100: z.number().min(0).max(250),
  fat100: z.number().min(0).max(200),
  fiber100: z.number().min(0).max(100).nullable().optional(),
  sugar100: z.number().min(0).max(200).nullable().optional(),
  units: z.array(UnitSchema).default([]),
  aliases: z.array(z.string().min(1)).default([]),
  verification: z.enum(['verified','unverified','suspect']).default('verified'),
  popularity: z.number().int().min(0).max(100).default(1)
});

export const CuratedPackSchema = z.object({
  meta: z.object({ name: z.string(), version: z.number().int().min(1) }),
  items: z.array(CuratedItemSchema)
});

export type CuratedItem = z.infer<typeof CuratedItemSchema>;
export type CuratedPack = z.infer<typeof CuratedPackSchema>;
export type Unit = z.infer<typeof UnitSchema>;

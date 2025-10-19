/**
 * Minimal FDC types for USDA bulk import
 */

export interface FdcFood {
  fdcId: number;
  description: string;
  dataType: string;
  foodCode?: string;
  publishedDate?: string;
  brandOwner?: string;
  ingredients?: string;
  marketCountry?: string;
  foodNutrients?: FdcNutrient[];
}

export interface FdcNutrient {
  nutrient: {
    id: number;
    number: string;
    name: string;
    rank: number;
    unitName: string;
  };
  amount: number;
}

export interface UsdaRow {
  id: number;
  description: string;
  brand?: string;
  ingredients?: string;
  nutrients: {
    kcal?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    fiber?: number;
    sugar?: number;
  };
}

export interface ImportResult {
  created: number;
  skipped: number;
  errors: number;
}

export interface ImportOptions {
  dryRun?: boolean;
  batchSize?: number;
  skipDuplicates?: boolean;
}

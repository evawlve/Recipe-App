import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { mapIngredientWithFallback } from "@/lib/fatsecret/map-ingredient-with-fallback";
import { deriveServingOptions } from "@/lib/units/servings";
import { buildServingOptionsForCacheFood, getCachedFoodWithRelations } from "@/lib/fatsecret/cache-search";
import { parseIngredientLine } from "@/lib/parse/ingredient-line";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

function detectMealType(line: string): 'breakfast' | 'lunch' | 'dinner' | 'snacks' | undefined {
  const lower = line.toLowerCase();
  if (/\b(breakfast|morning)\b/.test(lower)) return 'breakfast';
  if (/\b(lunch|midday)\b/.test(lower)) return 'lunch';
  if (/\b(dinner|supper|evening)\b/.test(lower)) return 'dinner';
  if (/\b(snack|snacks|afternoon|night)\b/.test(lower)) return 'snacks';
  return undefined;
}

export async function POST(request: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
      process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
      process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  let user = await getCurrentUser();
  let userId = user?.id;

  if (!userId && process.env.NODE_ENV === 'development') {
    const mockUser = await prisma.user.findFirst();
    if (mockUser) {
      userId = mockUser.id;
    }
  }

  if (!userId) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  try {
    const { text } = await request.json();

    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: "Missing or invalid 'text' field" }, { status: 400 });
    }

    // Split input into lines
    const lines = text
      .split(/[\n,;]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0);

    const parsedResults = await Promise.all(
      lines.map(async (line) => {
        try {
          const mapped = await mapIngredientWithFallback(line, { minConfidence: 0.4 });
          
          if (!mapped || 'status' in mapped) {
            return {
              rawText: line,
              error: "Could not map item",
            };
          }

          const parsedLine = parseIngredientLine(line);
          const detectedMeal = detectMealType(line);

          // Retrieve serving options
          let servingOptions: Array<{ label: string; grams: number }> = [];

          if (mapped.source === 'fatsecret' || mapped.source === 'cache') {
            const foodRecord = await getCachedFoodWithRelations(mapped.foodId);
            if (foodRecord) {
              const { servingOptions: opts } = buildServingOptionsForCacheFood(foodRecord as any);
              servingOptions = opts;
            }
          } else if (mapped.source === 'fdc') {
            const fdcId = parseInt(mapped.foodId.replace('fdc:', ''), 10);
            if (Number.isFinite(fdcId)) {
              const fdcFood = await prisma.fdcFoodCache.findUnique({
                where: { id: fdcId },
                include: { servings: true }
              });
              if (fdcFood) {
                const units = fdcFood.servings.map(s => ({ label: s.description, grams: s.grams }));
                servingOptions = deriveServingOptions({
                  units,
                  densityGml: null,
                  categoryId: null
                });
              }
            }
          } else if (mapped.source === 'ai_generated') {
            const aiFood = await prisma.aiGeneratedFood.findUnique({
              where: { id: mapped.foodId },
              include: { servings: true }
            });
            if (aiFood) {
              const units = aiFood.servings.map(s => ({ label: s.label, grams: s.grams }));
              servingOptions = deriveServingOptions({
                units,
                densityGml: null,
                categoryId: null
              });
            }
          } else if (mapped.source === 'openfoodfacts') {
            const offFood = await prisma.openFoodFactsCache.findUnique({
              where: { id: mapped.foodId },
              include: { servings: true }
            });
            if (offFood) {
              const units = offFood.servings.map(s => ({ label: s.description, grams: s.grams }));
              servingOptions = deriveServingOptions({
                units,
                densityGml: null,
                categoryId: null
              });
            }
          }

          if (servingOptions.length === 0) {
            servingOptions.push({ label: '100 g', grams: 100 });
            if (mapped.grams && mapped.servingDescription) {
              servingOptions.push({ label: mapped.servingDescription, grams: mapped.grams });
            }
          }

          return {
            rawText: line,
            foodName: mapped.foodName,
            brandName: mapped.brandName ?? null,
            foodId: mapped.foodId,
            source: mapped.source,
            matchConfidence: mapped.confidence,
            servingConfidence: mapped.confidence,
            mealType: detectedMeal,
            quantity: parsedLine?.qty ?? 1,
            unit: parsedLine?.unit ?? 'serving',
            grams: mapped.grams,
            nutrition: {
              calories: mapped.kcal,
              protein: mapped.protein,
              carbs: mapped.carbs,
              fat: mapped.fat,
            },
            servingOptions,
          };
        } catch (err: any) {
          console.error(`Error parsing line "${line}":`, err);
          return {
            rawText: line,
            error: err.message || "Parse failure",
          };
        }
      })
    );

    return NextResponse.json({
      success: true,
      results: parsedResults,
    });
  } catch (error: any) {
    console.error("Diary parse error:", error);
    return NextResponse.json({ error: error.message || "Failed to parse text" }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
    process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  try {
    const { callStructuredLlm } = await import('@/lib/ai/structured-client');
    const { parseIngredientLine } = await import('@/lib/parse/ingredient-line');
    const { mapIngredientWithFallback } = await import('@/lib/fatsecret/map-ingredient-with-fallback');
    const { resolveFoodDetails } = await import('@/lib/nlp/resolve-payload');

    const body = await req.json();
    const { text } = body;
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'text field is required and must be a string' }, { status: 400 });
    }

    const NLP_SPLIT_SCHEMA = {
      name: 'nlp_split',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                rawText: { type: 'string' },
                mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snacks'] }
              },
              required: ['rawText', 'mealType']
            }
          }
        },
        required: ['items']
      },
      strict: true
    };

    const SYSTEM_PROMPT = `You are a nutrition assistant that splits unstructured text describing meals/foods into individual food items with their quantities and units, and identifies the meal type (breakfast, lunch, dinner, or snacks).
Example: "2 scrambled eggs and 1 slice of wheat toast for breakfast"
Output:
{
  "items": [
    {"rawText": "2 scrambled eggs", "mealType": "breakfast"},
    {"rawText": "1 slice of wheat toast", "mealType": "breakfast"}
  ]
}
If no meal type is explicitly specified or implied, default to 'snacks'.`;

    const llmResult = await callStructuredLlm({
      schema: NLP_SPLIT_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: `Unstructured text: "${text}"`,
      purpose: 'parse',
    });

    if (llmResult.status === 'error') {
      return NextResponse.json({ error: 'Failed to segment text' }, { status: 500 });
    }

    const items = (llmResult.content?.items as Array<{ rawText: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks' }>) || [];
    const parsedItems = [];

    for (const item of items) {
      const rawText = item.rawText;
      const mealType = item.mealType;

      const parsed = parseIngredientLine(rawText);
      const qty = parsed?.qty ?? 1;
      const unit = parsed?.unit ?? '';

      const mapped = await mapIngredientWithFallback(rawText);
      if (!mapped || 'status' in mapped) {
        parsedItems.push({
          rawText,
          foodName: parsed?.name ?? rawText,
          brandName: null,
          foodId: undefined,
          source: 'ai_estimated' as const,
          matchConfidence: 0.0,
          servingConfidence: 0.0,
          mealType,
          quantity: qty,
          unit,
          grams: 0,
          nutrition: {
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            fiber: 0,
            sugar: 0,
            sodium: 0,
          },
          nutritionPer100g: {
            kcal100: 0,
            protein100: 0,
            carbs100: 0,
            fat100: 0,
            fiber100: 0,
            sugar100: 0,
            sodium100: 0,
          },
          servingOptions: [],
        });
        continue;
      }

      const details = await resolveFoodDetails(mapped.foodId, mapped.servingDescription);

      const scale = mapped.grams / 100;
      const nutrition = {
        calories: Number(mapped.kcal.toFixed(1)),
        protein: Number(mapped.protein.toFixed(1)),
        carbs: Number(mapped.carbs.toFixed(1)),
        fat: Number(mapped.fat.toFixed(1)),
        fiber: Number(((details.nutritionPer100g.fiber100 ?? 0) * scale).toFixed(1)),
        sugar: Number(((details.nutritionPer100g.sugar100 ?? 0) * scale).toFixed(1)),
        sodium: Number(((details.nutritionPer100g.sodium100 ?? 0) * scale).toFixed(1)),
      };

      const mappedSource = (mapped as any).source;
      let standardSource: 'fatsecret' | 'fdc' | 'openfoodfacts' | 'ai_estimated' = 'fatsecret';
      if (mappedSource === 'fdc') {
        standardSource = 'fdc';
      } else if (mappedSource === 'openfoodfacts') {
        standardSource = 'openfoodfacts';
      } else if (mappedSource === 'ai_generated' || mappedSource === 'ai_estimated') {
        standardSource = 'ai_estimated';
      }

      parsedItems.push({
        rawText,
        foodName: mapped.foodName,
        brandName: mapped.brandName ?? null,
        foodId: mapped.foodId,
        source: standardSource,
        matchConfidence: mapped.confidence,
        servingConfidence: mapped.confidence,
        servingWarning: mapped.aiValidation?.approved === false ? mapped.aiValidation.reason : undefined,
        mealType,
        quantity: qty,
        unit,
        grams: mapped.grams,
        nutrition,
        nutritionPer100g: details.nutritionPer100g,
        servingOptions: details.servingOptions,
      });
    }

    return NextResponse.json(parsedItems);
  } catch (error) {
    console.error('NLP Parse error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function POST(req: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Check API Key first (Dev bypass)
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.DEV_API_KEY || 'adminAPI_dev_key_bypass';
  
  let isDevBypass = false;

  if (apiKey && apiKey === expectedApiKey) {
    isDevBypass = true;
  }

  let userId: string | null = null;
  let userEmail: string | null = null;

  if (!isDevBypass) {
    // If not local dev bypass, we authenticate using Supabase JWT Bearer token
    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized: Missing or invalid token' }, { status: 401 });
    }
    const token = authHeader.substring(7);

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized: Invalid authentication session' }, { status: 401 });
      }
      userId = user.id;
      userEmail = user.email || null;

      // Check if user email qualifies for dev/test bypass (e.g. google_test_user@kindahealthy.com)
      if (userEmail && (
        userEmail === 'google_test_user@kindahealthy.com' ||
        userEmail.endsWith('@google.com') ||
        userEmail.includes('test') ||
        userEmail.includes('dev') ||
        userEmail === 'diego@example.com'
      )) {
        isDevBypass = true;
      }
    } catch (err) {
      return NextResponse.json({ error: 'Unauthorized: Auth service validation failed' }, { status: 401 });
    }
  }

  // Rate Limiting Enforcement (skipped for dev/test bypass users)
  if (!isDevBypass && userId) {
    try {
      const now = new Date();
      const oneMinuteAgo = new Date(now.getTime() - 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Perform parallel count queries using Prisma
      const [recentRequests, dailyRequests] = await Promise.all([
        prisma.nlpRequestLog.count({
          where: {
            userId,
            createdAt: { gte: oneMinuteAgo }
          }
        }),
        prisma.nlpRequestLog.count({
          where: {
            userId,
            createdAt: { gte: oneDayAgo }
          }
        })
      ]);

      if (recentRequests >= 3) {
        return NextResponse.json({
          error: 'Too many requests. Please wait a minute before making another food log attempt.'
        }, { status: 429 });
      }

      if (dailyRequests >= 20) {
        return NextResponse.json({
          error: 'Daily NLP log limit reached (20 logs). Please try again tomorrow!'
        }, { status: 429 });
      }

      // Log this request
      await prisma.nlpRequestLog.create({
        data: {
          userId
        }
      });
    } catch (dbErr) {
      console.error('NLP Parse Rate Limiter DB Error:', dbErr);
      // Fail open in case of DB tracking error to avoid blocking active users
    }
  }

  try {
    // Validate required environment variables at request time
    const requiredEnv = ['DATABASE_URL', 'FATSECRET_CLIENT_ID', 'FATSECRET_CLIENT_SECRET'];
    const missingEnv = requiredEnv.filter(name => !process.env[name]);
    if (missingEnv.length > 0) {
      console.error('NLP Parse API Error: Missing environment variables:', missingEnv);
      return NextResponse.json({
        error: `Configuration error: missing environment variables: ${missingEnv.join(', ')}`
      }, { status: 500 });
    }

    const { callStructuredLlm } = await import('@/lib/ai/structured-client');
    const { parseIngredientLine } = await import('@/lib/parse/ingredient-line');
    const { mapIngredientWithFallback } = await import('@/lib/mapping/map-ingredient-with-fallback');
    const { resolveFoodDetails } = await import('@/lib/nlp/resolve-payload');

    const body = await req.json();
    const { text, items: inputItems } = body;
    if ((!text || typeof text !== 'string') && (!inputItems || !Array.isArray(inputItems))) {
      return NextResponse.json({ error: 'Either "text" (string) or "items" (array) field is required' }, { status: 400 });
    }

    let items: Array<{ rawText: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks'; brand?: string; normalizedForm?: string }> = [];

    if (inputItems && Array.isArray(inputItems)) {
      items = inputItems.map(item => {
        if (typeof item === 'string') {
          return { rawText: item, mealType: 'snacks' as const, brand: '', normalizedForm: '' };
        } else if (item && typeof item === 'object') {
          const rawText = 'rawText' in item && typeof item.rawText === 'string' ? item.rawText : '';
          const mealType = 'mealType' in item && typeof item.mealType === 'string' && ['breakfast', 'lunch', 'dinner', 'snacks'].includes(item.mealType)
            ? (item.mealType as 'breakfast' | 'lunch' | 'dinner' | 'snacks')
            : 'snacks' as const;
          const brand = 'brand' in item && typeof item.brand === 'string' ? item.brand : '';
          const normalizedForm = 'normalizedForm' in item && typeof item.normalizedForm === 'string' ? item.normalizedForm : '';
          return { rawText, mealType, brand, normalizedForm };
        }
        return null;
      }).filter((x): x is { rawText: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks'; brand: string; normalizedForm: string } => x !== null && x.rawText.trim() !== '');
    } else {
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
                  mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snacks'] },
                  brand: { type: 'string' },
                  normalizedForm: { type: 'string' }
                },
                required: ['rawText', 'mealType', 'brand', 'normalizedForm']
              }
            }
          },
          required: ['items']
        },
        strict: true
      };

      const SYSTEM_PROMPT = `You are a nutrition assistant that splits unstructured text describing meals/foods into individual food items with their quantities and units, and identifies the meal type (breakfast, lunch, dinner, or snacks).

For each food item:
- "rawText": The original chunk of text describing the food item (e.g. "2 scrambled eggs", "a cup of whole milk").
- "mealType": The meal type ("breakfast", "lunch", "dinner", "snacks"). Default to 'snacks' if not specified or implied.
- "brand": The explicit brand name if mentioned (e.g., "Heinz", "Quaker"). If no brand is mentioned, set this to an empty string "".
- "normalizedForm": The simplified, canonical base food name. Remove quantities and units, but KEEP cooking/prep style modifiers (e.g., "scrambled", "grilled", "toasted", "whole") and sub-categories (e.g., "egg", "wheat toast", "whole milk") so the food type is specific. (Examples: "2 scrambled eggs" -> "scrambled eggs", "a cup of whole milk" -> "whole milk", "1 tbsp of Heinz ketchup" -> "ketchup").

Example: "2 scrambled eggs and 1 slice of wheat toast for breakfast"
Output:
{
  "items": [
    {"rawText": "2 scrambled eggs", "mealType": "breakfast", "brand": "", "normalizedForm": "scrambled eggs"},
    {"rawText": "1 slice of wheat toast", "mealType": "breakfast", "brand": "", "normalizedForm": "wheat toast"}
  ]
}`;

      const llmResult = await callStructuredLlm({
        schema: NLP_SPLIT_SCHEMA,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Unstructured text: "${text}"`,
        purpose: 'parse',
      });

      if (llmResult.status === 'error') {
        return NextResponse.json({ error: 'Failed to segment text' }, { status: 500 });
      }

      items = (llmResult.content?.items as Array<{ rawText: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks'; brand: string; normalizedForm: string }>) || [];
    }
    // Map all items concurrently — each mapping is independent, and identical
    // items are deduplicated by the pipeline's in-flight lock.
    const parsedItems = await Promise.all(items.map(async (item) => {
      const rawText = item.rawText;
      const mealType = item.mealType;
      const brand = item.brand;
      const normalizedForm = item.normalizedForm;

      const parsed = parseIngredientLine(rawText);
      const qty = parsed?.qty ?? 1;
      const unit = parsed?.unit ?? '';

      const mapped = await mapIngredientWithFallback(rawText, {
        brand: brand || undefined,
        normalizedForm: normalizedForm || undefined
      });
      if (!mapped || 'status' in mapped) {
        return {
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
        };
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

      return {
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
      };
    }));

    return NextResponse.json(parsedItems);
  } catch (error) {
    console.error('NLP Parse error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

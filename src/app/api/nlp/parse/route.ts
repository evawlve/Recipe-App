import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

type ParsedInputItem = {
  rawText: string;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks';
  brand: string;
  normalizedForm: string;
};

const MEAL_SUFFIX = /\s*(?:for|at|as)\s+(breakfast|lunch|dinner|snacks?)\s*\.?\s*$/i;
const MULTI_ITEM_SIGNALS = /[,;\n+&]|\b(?:and|with|plus)\b/i;

/**
 * Short text with no list separators describes exactly one food item; the
 * LLM split would echo it back after seconds of latency. Returns the item
 * (with any trailing "for breakfast"-style meal marker extracted) when the
 * text is unambiguously single-item, or null to fall through to the LLM.
 */
function singleItemFromText(text: string): ParsedInputItem | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return null;

  let mealType: ParsedInputItem['mealType'] = 'snacks';
  let rawText = trimmed;
  const mealMatch = trimmed.match(MEAL_SUFFIX);
  if (mealMatch) {
    const meal = mealMatch[1].toLowerCase();
    mealType = meal === 'snack' ? 'snacks' : (meal as ParsedInputItem['mealType']);
    rawText = trimmed.slice(0, mealMatch.index).trim();
  }

  if (rawText.length === 0 || MULTI_ITEM_SIGNALS.test(rawText)) return null;
  if (rawText.split(/\s+/).length > 6) return null;

  return { rawText, mealType, brand: '', normalizedForm: '' };
}

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
    const requiredEnv = ['DATABASE_URL'];
    const missingEnv = requiredEnv.filter(name => !process.env[name]);
    if (missingEnv.length > 0) {
      console.error('NLP Parse API Error: Missing environment variables:', missingEnv);
      return NextResponse.json({
        error: `Configuration error: missing environment variables: ${missingEnv.join(', ')}`
      }, { status: 500 });
    }

    const { segmentTextWithAi } = await import('@/lib/nlp/ai-segmenter');
    const { canonicalizeSegLine } = await import('@/lib/nlp/seg-line-key');
    const { lookupSegmentationCache, writeSegmentationCache } = await import('@/lib/nlp/segmentation-cache');
    const { forceSegmentText } = await import('@/lib/nlp/heuristic-segmenter');
    const { parseIngredientLine } = await import('@/lib/parse/ingredient-line');
    const { mapIngredientWithFallback } = await import('@/lib/mapping/map-ingredient-with-fallback');
    const { resolveFoodDetails } = await import('@/lib/nlp/resolve-payload');

    const body = await req.json();
    const { text, items: inputItems } = body;
    if ((!text || typeof text !== 'string') && (!inputItems || !Array.isArray(inputItems))) {
      return NextResponse.json({ error: 'Either "text" (string) or "items" (array) field is required' }, { status: 400 });
    }

    // Cold-run flag for cache audits (Phase 0 flywheel): bypasses BOTH
    // FoodMapping cache layers so cold-vs-warm parity runs measure the full
    // pipeline. Admin-only — regular users must never pay cold latency.
    const noCache = isDevBypass &&
      (req.nextUrl.searchParams.get('nocache') === '1' || body.nocache === true);

    let items: Array<{ rawText: string; mealType: 'breakfast' | 'lunch' | 'dinner' | 'snacks'; brand?: string; normalizedForm?: string }> = [];

    // Segmentation-cache outcome for telemetry: true = split served from
    // SegmentationCache, false = AI segmentation ran, null = this request
    // never reached AI segmentation (item-form input / single-item fast path).
    let segCacheHit: boolean | null = null;

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
    } else if (singleItemFromText(text)) {
      // Short text with no separators is one food item — the LLM split would
      // return it unchanged after ~1-5s. Skip straight to mapping.
      items = [singleItemFromText(text)!];
    } else {
      // AI-first segmentation (prompt/model/schema live in
      // src/lib/nlp/ai-segmenter.ts, versioned by SEG_PARSER_VERSION): the
      // cheap LLM splitter is the unconditional first step for any
      // multi-token / delimited log; the deterministic heuristic survives
      // only as forceSegmentText, the fallback when the LLM errors or
      // exceeds its deadline.
      //
      // SegmentationCache sits in front of the LLM: an identical repeat line
      // (canonicalized: case/whitespace/trailing-punctuation only — digits
      // preserved) serves the cached split in ~ms instead of re-paying the
      // ~2-4s LLM call. Fail-open: any cache error behaves as a miss. Only
      // successful, complete LLM parses are written back — heuristic
      // fallback splits are never cached. The admin nocache cold-run flag
      // bypasses the cache in BOTH directions (no read, no write) so parity
      // runs measure the full pipeline without mutating cache state.
      console.log('[nlp-parse] AI-first segmentation');

      const lineKey = canonicalizeSegLine(text);
      const cachedSegments = noCache ? null : await lookupSegmentationCache(lineKey);

      if (cachedSegments) {
        segCacheHit = true;
        items = cachedSegments;
        console.log(`[nlp-parse] segmentation cache HIT (${cachedSegments.length} items) — LLM skipped`);
      } else {
        segCacheHit = false;
        const aiItems = await segmentTextWithAi(text);
        if (aiItems) {
          items = aiItems;
          if (!noCache) {
            // Write-through (fail-open inside; a few ms before mapping starts).
            await writeSegmentationCache(lineKey, aiItems);
          }
        } else {
          // LLM failed/timed out/returned nothing usable — degraded split,
          // deliberately NOT cached.
          items = forceSegmentText(text);
        }
      }
    }
    // Per-line telemetry rows (MappingEventLog), written in one createMany
    // after mapping. Fail-open: telemetry must never break a user request.
    type EventRow = {
      rawLine: string; normalizedForm: string | null; cacheHit: string | null;
      cacheEscape: string | null; foodId: string | null; foodName: string | null;
      brandName: string | null; source: string | null; confidence: number | null;
      servingTier: string | null; grams: number | null; totalKcal: number | null;
      latencyMs: number; noCache: boolean; segCacheHit: boolean | null;
    };
    const eventRows: EventRow[] = [];
    const telemetryEnabled = process.env.MAPPING_EVENT_LOG_ENABLED !== 'false';

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

      const telemetry: import('@/lib/mapping/map-ingredient-with-fallback').MappingTelemetry = {};
      const mapStart = Date.now();
      const mapped = await mapIngredientWithFallback(rawText, {
        brand: brand || undefined,
        normalizedForm: normalizedForm || undefined,
        skipCache: noCache,
        telemetry,
      });
      const mapLatencyMs = Date.now() - mapStart;
      const isMapped = !!mapped && !('status' in mapped);
      if (telemetryEnabled) {
        eventRows.push({
          rawLine: rawText,
          normalizedForm: telemetry.normalizedForm ?? null,
          cacheHit: telemetry.cacheHit ?? null,
          cacheEscape: telemetry.cacheEscape ?? null,
          foodId: isMapped ? (mapped as any).foodId : null,
          foodName: isMapped ? (mapped as any).foodName : null,
          brandName: isMapped ? ((mapped as any).brandName ?? null) : null,
          source: isMapped ? (mapped as any).source : null,
          confidence: isMapped ? (mapped as any).confidence : null,
          servingTier: isMapped ? ((mapped as any).servingTier ?? null) : null,
          grams: isMapped ? (mapped as any).grams : null,
          totalKcal: isMapped ? (mapped as any).kcal : null,
          latencyMs: mapLatencyMs,
          noCache,
          segCacheHit,
        });
      }

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
        matchConfidence: Math.max(0, Math.min(1, mapped.confidence)),
        servingConfidence: Math.max(0, Math.min(1, mapped.confidence)),
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

    // One round trip for all lines; awaited so serverless runtimes can't kill
    // the write after the response, but failures never fail the request.
    if (eventRows.length > 0) {
      try {
        await prisma.mappingEventLog.createMany({ data: eventRows });
      } catch (telemetryErr) {
        console.warn('[nlp-parse] MappingEventLog write failed (non-fatal):', telemetryErr);
      }
    }

    return NextResponse.json(parsedItems);
  } catch (error) {
    console.error('NLP Parse error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

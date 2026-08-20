import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { prisma } from '@/lib/db';
// Statically imported, unlike everything else this handler uses: write-policy.ts imports
// only `node:async_hooks`, so it costs nothing at module load and the route must be able
// to open the scope before the first dynamic import inside the handler.
import { runWithWritePolicy, currentWriteReceipt } from '@/lib/write-policy';

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

  // Check API Key first (Dev bypass — fails closed: unset/empty DEV_API_KEY authorizes nothing)
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.DEV_API_KEY;
  
  let isDevBypass = false;

  if (expectedApiKey && apiKey && apiKey === expectedApiKey) {
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

      // Check if user email qualifies for the dev/test bypass. Exact matches and the review
      // domain ONLY — the 'test'/'dev' substring checks were removed 2026-08-20: any real
      // user whose address contained either substring skipped rate limiting.
      if (userEmail && (
        userEmail === 'google_test_user@kindahealthy.com' ||
        userEmail.endsWith('@google.com') ||
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
    const {
      resolveFoodDetails, isDegenerateNutrition, per100gFromBilledMacros,
      isPer100gInconsistentWithBilled,
    } = await import('@/lib/nlp/resolve-payload');
    const { isSyntheticGramsTier, portionProvenanceForTier } = await import('@/lib/mapping/serving-ai-tiers');
    const { logger } = await import('@/lib/logger');

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

    // Companion to nocache: this request PERSISTS NOTHING IT COMPUTES. Admin-only.
    //
    // nocache alone still saved every line, so a cold audit rewrote the cache it
    // was auditing — one cold golden run on 2026-08-02 changed 20 rows and added
    // 3 over freshly agent-screened rows. Deliberately a SEPARATE flag rather
    // than implied by nocache: some cold runs (a warm-from-cold) do want the write.
    //
    // WIDENED 2026-08-18 (P6). It used to gate exactly one write, FoodMapping, via
    // `skipSave` below — so a "read-only" measurement run still wrote FdcServing,
    // OffServing, AiGeneratedServing and SegmentationCache rows through the
    // hydration lane, self-warming the AI-serving tiers it was there to measure.
    // It now ALSO opens a request-scoped write policy (see the wrap further down)
    // that refuses those at their writers. Every existing sender already meant the
    // wide thing: scripts/eval/run-eval.ts ("a cold run cannot rewrite the cache it
    // measures"), scripts/eval/probe-classify-seeds.ts, and mobile's
    // EXPO_PUBLIC_SUPPRESS_MAPPING_WRITES.
    //
    // STILL WRITTEN under nosave, on purpose: MappingEventLog (the measurement
    // itself), the FoodMapping usedCount/lastUsedAt bumps on a warm READ, and the
    // upstream mirrors (FatSecretFood, OffFood, AiGeneratedFood, LearnedSynonym) —
    // caches of other people's data, not rows this request computed.
    const noSave = isDevBypass &&
      (req.nextUrl.searchParams.get('nosave') === '1' || body.nosave === true);

    // Diagnostic echo for the golden eval (2026-08-17): put `servingTier` and
    // `cacheHit` on each response item. DEV-BYPASS ONLY, and only when asked —
    // without the flag the response is byte-identical to before this existed
    // (pinned by route.debug-echo.test.ts). `servingTier` is a pipeline taxonomy
    // the client may never read ("it may never say WHY"); the honest client field
    // is `portionEstimated` below. It is here because the tier is otherwise
    // written to MappingEventLog only, and scripts/eval/run-eval.ts is
    // deliberately dependency-free — it sends `debug=1` in --nocache mode and
    // scores `expectServingTier` off this field.
    const debugEcho = isDevBypass &&
      (req.nextUrl.searchParams.get('debug') === '1' || body.debug === true);

    // ============================================================
    // REQUEST-SCOPED WRITE POLICY (nosave=1)
    // ============================================================
    // Everything from the segmentation split to the response runs inside ONE
    // AsyncLocalStorage scope, so `nosave=1` can mean the wide thing — "this request
    // persists nothing it computed" — without a policy argument threaded through the
    // twelve production call sites of `hydrateAndSelectServing()` and the one inside
    // `build-fatsecret-result.ts` that no argument can reach. The writers consult the
    // scope themselves (`isWriteSuppressed()` in fdc-ai-backfill.ts, ai-backfill.ts,
    // ambiguous-unit-backfill.ts, segmentation-cache.ts); nothing between here and them
    // changed.
    //
    // The outer try/catch stays OUTSIDE this wrap: a throw must still be caught by the
    // handler's own 500 branch, and the policy must be off by the time it is.
    async function runParse(): Promise<NextResponse> {
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
        funnelStage: string | null; dropReason: string | null;
      };
      const eventRows: EventRow[] = [];
      const telemetryEnabled = process.env.MAPPING_EVENT_LOG_ENABLED !== 'false';

      // ONE LLM-nutrition allowance for this whole REQUEST, created here and
      // shared by every item below. Per-request, not per-item: a 20-item meal
      // must not be able to fire dozens of nutrition calls. Because it is created
      // inside the handler it dies with the response — nothing latches, which is
      // what makes the golden eval immune to whatever ran in this process before
      // it (the old module-scope counter is why a warm run could red the gate).
      const { createAiNutritionBudget } = await import('@/lib/mapping/ai-nutrition-backfill');
      const { AI_NUTRITION_MAX_PER_REQUEST, AI_NUTRITION_HYDRATION_MAX_PER_REQUEST } =
        await import('@/lib/mapping/config');
      const nutritionBudget = createAiNutritionBudget(AI_NUTRITION_MAX_PER_REQUEST);
      // The SECOND, separate allowance: hydration/enrichment inside buildOffResult.
      // It must not draw on the pool above. Exhausting the last-resort pool
      // degrades a line that had no match anyway; exhausting hydration DELETES an
      // OFF candidate that already won retrieval, so the record this request
      // writes as a sticky FoodMapping row would depend on the Promise.all
      // interleaving of the other items — a non-deterministic cache identity.
      const hydrationBudget = createAiNutritionBudget(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST);

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
        // PER-LINE SCOPE, nested inside the request scope. It inherits whatever the
        // request suppressed (a nested `suppress: []` cannot un-suppress — see
        // write-policy.ts) and adds only this line's text, so a refusal recorded deep in
        // the mapper says WHICH line it belonged to. The refusal list and the counters are
        // the request's, shared by reference, which is why one read after Promise.all is
        // enough. `skipSave` is unchanged and still does its own narrower job: FoodMapping.
        const mapped = await runWithWritePolicy({ suppress: [], line: rawText }, () =>
          mapIngredientWithFallback(rawText, {
            brand: brand || undefined,
            normalizedForm: normalizedForm || undefined,
            skipCache: noCache,
            skipSave: noSave,
            telemetry,
            aiNutritionBudget: nutritionBudget,
            aiHydrationBudget: hydrationBudget,
          }),
        );
        const mapLatencyMs = Date.now() - mapStart;
        const isMapped = !!mapped && !('status' in mapped);
        // One read of the tier for the telemetry row and the debug echo alike. The
        // serving-tier census (src/lib/mapping/__tests__/serving-tier-census.test.ts)
        // knows this exact expression as the route's pass-through.
        const servingTier: string | null = isMapped ? ((mapped as any).servingTier ?? null) : null;
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
            servingTier,
            grams: isMapped ? (mapped as any).grams : null,
            totalKcal: isMapped ? (mapped as any).kcal : null,
            latencyMs: mapLatencyMs,
            noCache,
            segCacheHit,
            // Funnel taxonomy (sprint F1). A line the mapper never classified
            // (it threw, or returned a 'pending' lock status) has no stage.
            funnelStage: telemetry.funnelStage ?? null,
            dropReason: telemetry.dropReason ?? null,
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
            funnelStage: telemetry.funnelStage,
            dropReason: telemetry.dropReason,
            // Debug echo (dev bypass + debug=1 only): null tier, whichever cache
            // layer answered. Same shape as the mapped branch so a scorer can read
            // the KEY as "the echo is on".
            ...(debugEcho ? { servingTier, cacheHit: telemetry.cacheHit ?? null } : {}),
          };
        }

        const details = await resolveFoodDetails(mapped.foodId, mapped.servingDescription);

        // `nutrition` below reads mapped.* (authoritative for this line) while
        // nutritionPer100g came wholly from the food-row re-read. When the row
        // isn't there yet — every first sighting of a fatsecret food, which is
        // persisted by a background task — that split shipped correct serving
        // calories next to kcal100: 0, and the client rescales by kcal100. Fall
        // back to the line's own macros so the two can't contradict each other.
        //
        // The same split reappears whenever the two are merely INCONSISTENT
        // rather than absent (funnel fix 5). A record billed from its own
        // per-serving macros — FatSecret's "1 serving" restaurant rows — carries
        // grams that are only an energy-density estimate, so a tall flat white
        // bills its true 170 kcal while kcal100 x grams says 42. Whichever number
        // the client happens to use then decides the calorie count, and changing
        // the portion silently switches it to the wrong one. The billed macros are
        // authoritative, so re-derive per-100g from them and the invariant
        // per100g x grams == billed holds by construction at any portion.
        const inconsistent = isPer100gInconsistentWithBilled(details.nutritionPer100g, mapped);
        const derivedPer100g = isDegenerateNutrition(details.nutritionPer100g) || inconsistent
          ? per100gFromBilledMacros(mapped)
          : null;
        const nutritionPer100g = derivedPer100g
          ? { ...details.nutritionPer100g, ...derivedPer100g }
          : details.nutritionPer100g;
        if (derivedPer100g) {
          logger.debug('parse.per100g_derived_from_billed', {
            foodId: mapped.foodId, foodName: mapped.foodName, grams: mapped.grams,
          });
        }

        const scale = mapped.grams / 100;
        const nutrition = {
          calories: Number(mapped.kcal.toFixed(1)),
          protein: Number(mapped.protein.toFixed(1)),
          carbs: Number(mapped.carbs.toFixed(1)),
          fat: Number(mapped.fat.toFixed(1)),
          // SCALED FROM THE MERGED BLOCK, not from `details.nutritionPer100g`.
          // These three used to read the raw resolver output while the response
          // shipped the merged one a few lines down, so the billed micros were
          // structurally unable to see any repair applied above them — a divergence
          // that cost nothing only because `per100gFromBilledMacros()` happens to
          // return no micro keys today. Reading the same object the client is sent
          // is the invariant; that it is currently a no-op is an accident, not a
          // guarantee. `sodium100` is GRAMS per 100 g on every branch, so `sodium`
          // here is grams too — see ResolvedNutritionPer100g in resolve-payload.ts.
          fiber: Number(((nutritionPer100g.fiber100 ?? 0) * scale).toFixed(1)),
          sugar: Number(((nutritionPer100g.sugar100 ?? 0) * scale).toFixed(1)),
          sodium: Number(((nutritionPer100g.sodium100 ?? 0) * scale).toFixed(1)),
        };

        // Provenance is the RESOLVED RECORD's (`details.source`, derived from the foodId prefix
        // in resolve-payload.ts), never `mapped.source` — that field is the PIPELINE STAGE, not
        // a provider. It takes eight values (`ai`, `ai_generated`, `cache`, `early_cache`,
        // `fatsecret`, `fdc`, `full_pipeline`, `openfoodfacts`) and the chain here handled four,
        // so `ai`, `cache`, `early_cache` and `full_pipeline` every one fell through to a
        // `'fatsecret'` default. That badged an outright AI estimate (`source: 'ai'`,
        // map-ingredient-with-fallback.ts:2112) as FatSecret-supplied data. Unknown values floor
        // to 'ai_estimated' — the only non-badging member of the contract union — so a new
        // pipeline stage can never again promote itself to a provider claim by default.
        //
        // `mapped.panelFromAi` OVERRIDES the resolved record, and it is the one case
        // where the foodId prefix is an actively wrong answer rather than an unknown
        // one. `buildOffResult()`'s AI-nutrition backfill returns an `off_` id whose
        // entire per-100g panel came from the model, so the prefix says
        // "openfoodfacts" about numbers OFF never supplied. Under-attribution is the
        // safe direction — rendering nothing is always true — so it floors to
        // `ai_estimated` rather than picking a provider.
        const STANDARD_SOURCES = ['fatsecret', 'fdc', 'openfoodfacts', 'ai_estimated'] as const;
        type StandardSource = typeof STANDARD_SOURCES[number];
        const standardSource: StandardSource =
          mapped.panelFromAi
            ? 'ai_estimated'
            : (STANDARD_SOURCES as readonly string[]).includes(details.source)
              ? (details.source as StandardSource)
              : 'ai_estimated';

        const portionProvenance = portionProvenanceForTier(mapped.servingTier);

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
          nutritionPer100g,
          servingOptions: details.servingOptions,
          // TRUE when `grams` above is a placeholder, not a weight — so `nutritionPer100g`
          // is that placeholder read back rather than a density, and every gram- or
          // volume-denominated portion the client offers is fabricated from it.
          //
          // It has to be said on the wire because the client CANNOT infer it. The only
          // in-band tell would be `grams`, and this population is not the flat-100 g
          // signature `assessMappingSignal()` already watches for — measured, 8 of 777
          // events land on exactly 100 g, so that badge misses 99% of it. Sourced from
          // `mapped.servingTier` through the owned predicate rather than a name match,
          // because the honest and the fabricated halves differ by one suffix
          // (`fs_serving_macros_only` vs `..._est`) and were one string until 2026-08-14.
          //
          // Omitted (not `false`) when the weight is real, so a client on an older build
          // reads exactly what it read before. Owner:
          // sync-docs/reports/2026-08-14_the-empty-panel-serving-is-synthetic.md (mobile).
          ...(isSyntheticGramsTier((mapped as { servingTier?: string | null }).servingTier)
            ? { portionEstimated: true as const }
            : {}),
          // WHERE THE GRAMS CAME FROM, when it was not this record and not the user:
          // `'borrowed'` — another product's label or a generic table
          // (BORROWED_OR_DEFAULTED_SERVING_TIERS, 16 tiers); `'floor'` — every rung
          // failed and the pipeline billed a flat 100 g x qty knowing it had nothing
          // (FLOOR_SERVING_TIERS, 9 tiers). Both lists and the ONE derivation live in
          // serving-ai-tiers.ts; this route only reads `mapped.servingTier` through
          // it, so a tier moving list moves the wire without a route edit.
          //
          // The client CANNOT infer this either. Mobile's flat-100 rule badged only
          // the qty = 1 floors and none of the borrowed rows — 236 g of a sibling
          // SKU's serving is indistinguishable from 236 g read off this label — and
          // this field is what lets that inference retire without regressing the
          // floor half. It says the serving AXIS only: no accuracy claim, no cause
          // beyond the word.
          //
          // `portionEstimated` above is UNCHANGED (its population and consumers are
          // its own); a #314 row carries both, and a client reading both gives
          // `portionEstimated` precedence. Omitted (never `null`) when the tier is in
          // neither list, so every honest row stays byte-identical on the wire.
          // Owner: sync-docs/reports/2026-08-17_can-the-badge-be-aimed.md §6 (mobile),
          // and the plan that named the field, 2026-08-17_ultracode-execution-plan-2.md Lane D.
          ...(portionProvenance ? { portionProvenance } : {}),
          // Funnel taxonomy (sprint F1) — diagnostic class IDs, additive. Lets
          // offline warm batches (scripts/eval/warm-cache.ts) read each seed's
          // funnel outcome straight off the response instead of re-deriving it
          // from MappingEventLog. Clients ignore unknown fields.
          funnelStage: telemetry.funnelStage,
          dropReason: telemetry.dropReason,
          // Debug echo — dev bypass + debug=1 only; absent (not null) otherwise, so
          // the response is byte-identical for every real client. See `debugEcho`.
          ...(debugEcho ? { servingTier, cacheHit: telemetry.cacheHit ?? null } : {}),
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

      // The receipt is read ONCE, here, after Promise.all: every per-item scope shares
      // this request's counters and refusal list by reference, so this single read sees
      // everything every line did. It rides on a HEADER, never in the body — the body is
      // a bare ARRAY that `scripts/eval/run-eval.ts` and `scripts/eval/probe-classify-seeds.ts`
      // both check with `Array.isArray()`, and an extra property on an array is dropped by
      // JSON.stringify anyway. Dev bypass + nosave only, so no real client ever sees it.
      //
      // READ `consulted` FIRST. `refused: []` with `consulted: 0` does NOT mean "nothing
      // was refused" — it means no writer ever saw the policy, which is the fail-open the
      // globalThis instance in write-policy.ts exists to prevent. Zero consultations next
      // to an AI serving tier on the same response is a structural RED.
      const response = NextResponse.json(parsedItems);
      const receipt = noSave ? currentWriteReceipt() : null;
      if (receipt) response.headers.set('X-Write-Receipt', JSON.stringify(receipt));
      return response;
    }

    return runWithWritePolicy(
      { suppress: noSave ? ['aiServing', 'segmentationCache'] : [] },
      runParse,
    );
  } catch (error) {
    console.error('NLP Parse error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

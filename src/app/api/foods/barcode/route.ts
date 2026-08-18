import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Check API Key
  const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
  const expectedApiKey = process.env.DEV_API_KEY || 'adminAPI_dev_key_bypass';
  if (!apiKey || apiKey !== expectedApiKey) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { lookupFatSecretBarcode } = await import('@/lib/mapping/barcode');
    const { ensureFoodCached } = await import('@/lib/mapping/cache');
    const { getOffProductByBarcode } = await import('@/lib/openfoodfacts/client');
    const { hydrateOffCandidate } = await import('@/lib/openfoodfacts/hydrate');
    const { resolveFoodDetails } = await import('@/lib/nlp/resolve-payload');

    const { searchParams } = new URL(req.url);
    const code = searchParams.get('code');

    if (!code || !code.trim()) {
      return NextResponse.json({ error: 'code query parameter is required' }, { status: 400 });
    }

    const trimmedCode = code.trim();

    type ResolvedDetails = Awaited<ReturnType<typeof resolveFoodDetails>>;
    let foodId: string | null = null;
    let details: ResolvedDetails | null = null;

    // 1. Try FatSecret first
    const fsResult = await lookupFatSecretBarcode(trimmedCode);
    if (fsResult && fsResult.foodId) {
      // The `fs_` prefix is load-bearing. resolveFoodDetails dispatches PURELY on the id
      // prefix (`fdc_` / `off_` / `fs_`) and falls through to an AiGeneratedFood lookup
      // otherwise, while lookupFatSecretBarcode returns a BARE numeric id
      // (`client.ts`, `id: String(raw.food_id)`). AiGeneratedFood.id is a cuid, so a
      // numeric id can never match it: the unprefixed call resolved nothing and shipped a
      // 200 carrying `name: ''`, all-zero nutrition and `servingOptions: []`. Verified on
      // the live DB — `95103` resolves to name '' / 0 kcal, `fs_95103` to
      // 'Original Potato Crisps' / 536 kcal / 12 serving options.
      //
      // ensureFoodCached still takes the BARE id (it keys AiGeneratedFood) and is
      // deliberately called with NO `client` option: passing one makes it fetch live and
      // write FatSecret data into AiGeneratedFood under `aiModel: 'fatsecret-live-import'`,
      // which cache-search now surfaces as `ai_generated` / `ai_estimated` — real
      // FatSecret data relabelled as an AI estimate. Fix the prefix, not the transport.
      const fsFoodId = `fs_${fsResult.foodId}`;
      await ensureFoodCached(fsResult.foodId);
      const resolved = await resolveFoodDetails(fsFoodId);
      // Resolved-ness is judged on the NAME, never on the nutrition. All-zero macros are a
      // legitimate value, not a miss — FatSecretFood 4041569 'Coke Zero (Can)' really is
      // 0 kcal / 0 protein / 0 carbs / 0 fat — so gating on isDegenerateNutrition here
      // would throw away a correct hit. An empty name is the unambiguous "matched no row".
      if (resolved.name) {
        foodId = fsFoodId;
        details = resolved;
      }
    }

    // 2. Fall back to OpenFoodFacts — reached both when FatSecret has no hit at all AND
    //    when a FatSecret hit resolved to nothing, so an unresolvable FatSecret id can no
    //    longer shadow a healthy OFF answer with an empty 200.
    if (!details) {
      const offProduct = await getOffProductByBarcode(trimmedCode);
      if (offProduct) {
        const offId = `off_${offProduct.code}`;
        await hydrateOffCandidate({
          id: offId,
          name: offProduct.product_name || 'OpenFoodFacts Product',
          rawData: offProduct,
        });
        const resolved = await resolveFoodDetails(offId);
        if (resolved.name) {
          foodId = offId;
          details = resolved;
        }
      }
    }

    // 3. Nothing resolved. A 404 is the contract; an empty 200 is the defect.
    if (!foodId || !details) {
      return NextResponse.json({ error: 'Food not found for barcode' }, { status: 404 });
    }

    const responsePayload = {
      id: foodId,
      name: details.name,
      brand: details.brandName,
      source: details.source,
      nutritionPer100g: details.nutritionPer100g,
      servingOptions: details.servingOptions,
      // TRUE when resolveFoodDetails recovered this record's nutrition from a
      // serving row because its per-100g panel was empty — a FatSecret record
      // with per-serving macros and no weight. The figures are then a
      // self-consistency term computed against an INVENTED weight (kcal / 2.0),
      // not a density, and `servingOptions` here is the fabricated metric set
      // rather than the record's own portion. Surfaced because
      // recoverMacroOnlyServing()'s header requires the pair to travel together
      // and this route, unlike /api/nlp/parse, has no mapper result carrying
      // `servingTier` to derive it from.
      //
      // Omitted (not `false`) when the panel is real, so existing responses stay
      // byte-identical. NOT a portion fix: this route still offers a fabricated
      // `100 g` for these records, and a consumer that trusts it would log ~200
      // kcal for any of them. Wire the flag into the UI before giving this route
      // a client. Owner of the class:
      // sync-docs/reports/2026-08-15_the-search-lane-billed-zero-on-chain-records.md (mobile).
      ...(details.portionEstimated ? { portionEstimated: true as const } : {}),
      // Passed through from resolveFoodDetails(), which can set it on exactly one
      // branch — the macro-only recovery above, where the tier is known and is a
      // BORROWED_OR_DEFAULTED member, so the value here is always `'borrowed'` and
      // travels with `portionEstimated`. This route has no mapper result and so
      // no other `servingTier` to read; a barcode hit that resolved through its
      // own label ships no field, which is "no claim", not "own weight". Same
      // omit-when-absent rule as the flag above. Owner of the field:
      // serving-ai-tiers.ts, `portionProvenanceForTier()`.
      ...(details.portionProvenance ? { portionProvenance: details.portionProvenance } : {}),
    };

    return NextResponse.json(responsePayload);
  } catch (error) {
    console.error('Barcode lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

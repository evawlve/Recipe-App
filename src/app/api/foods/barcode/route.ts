import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/auth/request-auth';
import { isNoSaveTester } from '@/lib/nlp/nosave-testers';
import {
  runWithWritePolicy,
  currentWriteReceipt,
  type WritePolicyOptions,
} from '@/lib/write-policy';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.BUILD_TIME === 'true') {
    return NextResponse.json({ error: "Not available during build" }, { status: 503 });
  }

  // Who is calling — the dev key (bypass; fails closed on an unset/empty DEV_API_KEY) or a
  // Supabase JWT bearer, through the shared chokepoint. Key + bearer and NO cookie, the
  // /api/foods/search shape rather than /api/foods/[id]'s: nothing in the web app fetches
  // this route (`grep -rn 'foods/barcode' src/` finds only this file and its tests), so a
  // cookie leg would be a credential nobody presents. The 401 body is the one this route
  // has always sent, so no client sees a new string.
  //
  // Before this the route was one of the four key-only production routes, which made it
  // unreachable from the keyless alpha client: every scan from a release build was a 401.
  const auth = await authenticateRequest(req, { accept: ['key', 'bearer'] });
  if (!auth.via) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // WHO may ask this route not to persist what it computed. Deliberately NARROWER than
  // /api/nlp/parse's rule, and deliberately not a copy of it: that route's inline
  // `@google.com` / `diego@example.com` allowlist is a RATE-LIMIT bypass that also grants
  // nosave, it is inline there because doc-check claim `dev-bypass-email-substring-removed`
  // greps that file, and a second copy here would be a second owner of it. The mechanism
  // built for device sittings is NOSAVE_TESTER_EMAILS (src/lib/nlp/nosave-testers.ts,
  // exact addresses, fail-closed when unset), so this route accepts exactly that plus the
  // dev key. Any other caller's `nosave=1` is silently ignored — the same fail-closed
  // shape as the parse route, one leg shorter.
  //
  // GET-only, so the query parameter is the whole surface: there is no body to read
  // `nosave: true` from.
  const noSave =
    (auth.via === 'key' || isNoSaveTester(auth.email)) &&
    req.nextUrl.searchParams.get('nosave') === '1';

  // REQUEST-SCOPED WRITE POLICY (nosave=1). This route's only two write sites are the
  // OffFood and OffServing upserts inside hydrateOffCandidate() — measured 2026-08-27:
  // `ensureFoodCached(id)` reaches its own writes ONLY via `options.client`, which this
  // route deliberately never passes (see the comment at the call), and nothing else on
  // either branch writes. `offMirror` is the class those two upserts consult; the parse
  // lane reaches the same writer and does not ask for it, so its mirroring is unchanged.
  const policy: WritePolicyOptions = { suppress: noSave ? ['offMirror'] : [] };

  try {
    return await runWithWritePolicy(policy, async () => {
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
      // Did OpenFoodFacts itself answer for this barcode? Read only by the 404 branch, to
      // tell "nobody has this product" from "we have it upstream and declined to keep it".
      let offProductFound = false;

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
        // That missing option is also why this whole branch persists NOTHING and needs no
        // write guard: `upsertFoodFromDetails()` in cache.ts is unreachable without it.
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
          offProductFound = true;
          const offId = `off_${offProduct.code}`;
          // The one write site on this route, and it is CACHE-FIRST: a barcode already in
          // the OffFood mirror returns from the row and upserts nothing, which is the
          // common case against a 1,085,526-row mirror. Under `nosave=1` the upserts are
          // refused inside the writer and the returned shape is computed all the same —
          // but resolveFoodDetails() below reads OffFood, so a barcode we have NEVER
          // mirrored then resolves to nothing. That is the 404 branch's second case.
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
        // Two different facts, one status. A suppressed request that found the product
        // upstream and refused to keep it is NOT "food not found for barcode" — saying so
        // would send a sitting hunting a lookup defect that is its own `nosave=1`. The
        // status stays 404 (the client's behaviour is identical: there is no card either
        // way) and the `code` carries the distinction. Keyed on the receipt, so the
        // message is true because a write was actually refused, not because a flag is set.
        const refusedReceipt = currentWriteReceipt();
        if (noSave && offProductFound && refusedReceipt && refusedReceipt.refusedTotal > 0) {
          return withReceipt(
            NextResponse.json(
              {
                error: 'Barcode found upstream but not persisted under nosave=1',
                code: 'nosave_not_persisted',
              },
              { status: 404 },
            ),
            noSave,
          );
        }
        return withReceipt(
          NextResponse.json({ error: 'Food not found for barcode' }, { status: 404 }),
          noSave,
        );
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

      return withReceipt(NextResponse.json(responsePayload), noSave);
    });
  } catch (error) {
    console.error('Barcode lookup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * Echo the request-scoped write receipt on `X-Write-Receipt`, exactly as /api/nlp/parse
 * does, and only for a request that actually asked for suppression — an ordinary scan
 * ships no new header and is byte-identical to before.
 *
 * WHAT `consulted` MEANS HERE, which is narrower than on /api/nlp/parse. This route reaches
 * the guard at most once per request, and only on a FRESH OpenFoodFacts hydrate: a FatSecret
 * hit has no write site at all, and an OFF barcode already in the mirror returns cache-first
 * BEFORE the guard. So `consulted: 0` is the normal reading for both and is not by itself the
 * fail-open write-policy.ts warns about.
 *
 * The falsifier that does work is at the route's own contract: under `nosave=1` a barcode
 * absent from OffFood MUST come back 404 `nosave_not_persisted`. A 200 for such a barcode
 * means the guard was not seen and a row was written — the fail-open, in the one shape this
 * route can actually show.
 */
function withReceipt(response: NextResponse, noSave: boolean): NextResponse {
  if (!noSave) return response;
  const receipt = currentWriteReceipt();
  if (receipt) response.headers.set('X-Write-Receipt', JSON.stringify(receipt));
  return response;
}

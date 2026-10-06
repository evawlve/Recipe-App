import { type NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth/request-auth";
import { getSupabaseAuthClient } from "@/lib/supabase/admin";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

/**
 * DELETE /api/account/delete — delete the calling user's account.
 *
 * Who may call it: a Supabase bearer (the mobile app, `Authorization: Bearer <access_token>`)
 * or the web app's cookie session. NOT the dev key: it names no user, and a deletion must
 * name a person.
 *
 * Order matters, and it is the reverse of the pre-2026-10 route:
 *   1. the Supabase auth user is deleted FIRST — it is the thing both stores require gone,
 *      and the user's real data (profile, meals, logs, streaks …) cascades from `auth.users`
 *      on the Supabase side. A failure here is a failure of the request: 503 when no admin
 *      client can be built, 502 when Supabase refuses or the call throws. Nothing else is
 *      touched, and the client sees a non-2xx with a string `error`.
 *   2. ONLY then the Prisma cleanup, which is the parked web recipe app's data. A mobile-only
 *      user has no Prisma `User` row (nothing on the bearer path creates one), so a missing
 *      row is the normal case — 200 with `appDataFound: false`, never a 404. A failed
 *      transaction is reported as `appDataDeleted: false` on a 200, because the auth user is
 *      already gone and a 500 would tell the app nothing happened.
 *
 * Two things the 2026-10-05 review of that order added, both after the auth deletion:
 *   - The caller's `NlpRequestLog` rows are scrubbed (`requestLogRowsDeleted`). That table is
 *     the parse route's rate-limit counter — a timestamp per paid parse, no text — keyed on
 *     the Supabase user id with NO relation to `User`, so nothing cascades it, and a mobile
 *     user (no `User` row) has no other backend row at all. It runs UNCONDITIONALLY once the
 *     auth deletion succeeded, before and independently of the `User` lookup, in its own
 *     try/catch: a failure is `requestLogRowsDeleted: null` and a warning, never a non-2xx,
 *     and it never changes `appDataFound`, `appDataDeleted` or `appDataError`. It does NOT
 *     run when the auth deletion failed or was never attempted.
 *   - NOTHING after the auth deletion may end in the outer 500. The Prisma import and the
 *     `User` lookup used to sit outside any inner try, so a database failure there returned
 *     "Please try again" over an account that was already gone (the retry is a 401). They now
 *     report like the transaction does: 200, `authDeleted: true`, `appDataDeleted: false`, an
 *     `appDataError` string. When the import or the lookup itself failed, whether a `User` row
 *     exists is unknown, and `appDataFound` is `null` for that case only — it stays `true` /
 *     `false` when the lookup answered. If the import failed the scrub could not run either:
 *     `requestLogRowsDeleted: null`. The outer catch remains for failures BEFORE the auth
 *     deletion.
 *
 * Every non-2xx body carries `error` as a string (what the web card and the app read) and a
 * machine `reason`.
 */
export async function DELETE(req: NextRequest) {
  try {
    // Skip execution during build time - more comprehensive check
    if (process.env.NEXT_PHASE === 'phase-production-build' || 
        process.env.BUILD_TIME === 'true' ||
        process.env.NODE_ENV === 'production' && process.env.VERCEL === '1' && !process.env.VERCEL_ENV ||
        typeof window === 'undefined' && process.env.NODE_ENV === 'production' && !process.env.DATABASE_URL) {
      return NextResponse.json({ error: "Not available during build" }, { status: 503 });
    }

    const auth = await authenticateRequest(req, { accept: ['bearer', 'cookie'] });
    if (!auth.via) {
      if (auth.reason === 'auth_unavailable') {
        return NextResponse.json({ error: "Authentication unavailable", reason: auth.reason }, { status: 503 });
      }
      return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
    }
    // Unreachable at runtime ('key' is not accepted, and only 'key' has a null userId); it exists
    // so `auth.userId` is a `string` below.
    if (!auth.userId) {
      return NextResponse.json({ error: "Unauthorized", reason: 'missing_credentials' }, { status: 401 });
    }
    const userId = auth.userId;

    // (1) The admin client. With only the anon key Supabase refuses `admin.deleteUser`, and
    // that refusal is surfaced in step (2) — never hidden behind a 200.
    const client = getSupabaseAuthClient();
    if (!client) {
      return NextResponse.json({ error: "Auth deletion unavailable", reason: 'auth_unavailable' }, { status: 503 });
    }

    // (2) Delete the Supabase auth user. Nothing else has been touched yet.
    try {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) {
        console.warn('[account.delete] Supabase auth deletion refused:', error.message);
        return NextResponse.json(
          { error: "Auth deletion failed", reason: 'auth_delete_failed', detail: error.message },
          { status: 502 },
        );
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn('[account.delete] Supabase auth deletion threw:', detail);
      return NextResponse.json(
        { error: "Auth deletion failed", reason: 'auth_delete_failed', detail },
        { status: 502 },
      );
    }

    // (3) Everything from here on is AFTER the auth deletion and is reported on a 200: the
    // account is already gone, and a non-2xx would make the app say "try again" (into a 401).
    let requestLogRowsDeleted: number | null = null;
    let appDataFound: boolean | null = false;
    let appDataDeleted = false;
    let appDataError: string | undefined;

    // The Prisma client — the parked web recipe app's rows and the parse route's rate-limit
    // counter. Loaded here, not at module scope, so the build-time guard above runs before
    // Prisma is instantiated. A failed import is a failed cleanup, not a failed request.
    let prisma: Awaited<typeof import("@/lib/db")>["prisma"] | undefined;
    try {
      ({ prisma } = await import("@/lib/db"));
    } catch (err) {
      appDataFound = null;
      appDataError = err instanceof Error ? err.message : String(err);
      console.warn('[account.delete] app-data cleanup failed after auth deletion:', appDataError);
    }

    if (prisma) {
      // (3a) The scrub: the caller's `NlpRequestLog` rows. Unconditional — a mobile-only user
      // has no `User` row, and this is the one backend row they do have. Its own try/catch: a
      // failure changes neither the status nor whether (3b) runs.
      try {
        const { count } = await prisma.nlpRequestLog.deleteMany({ where: { userId } });
        requestLogRowsDeleted = count;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.warn('[account.delete] request-log scrub failed after auth deletion:', detail);
      }

      // (3b) The web app's rows. The lookup is guarded so a database failure here is reported
      // like a failed transaction, never thrown to the outer catch; when it is the LOOKUP that
      // failed, whether a `User` row exists is unknown: `appDataFound: null`.
      const lookup = await (async () => {
        try {
          const row = await prisma.user.findUnique({
            where: { id: userId },
            include: {
              recipes: {
                include: {
                  photos: true,
                  ingredients: true,
                  nutrition: true,
                  tags: true,
                  comments: true,
                  likes: true,
                  collections: true,
                }
              },
              collections: true,
              comments: true,
              likes: true,
              followedBy: true,
              following: true,
            }
          });
          return { ok: true as const, row };
        } catch (err) {
          return { ok: false as const, err };
        }
      })();

      if (!lookup.ok) {
        appDataFound = null;
        appDataError = lookup.err instanceof Error ? lookup.err.message : String(lookup.err);
        console.warn('[account.delete] app-data cleanup failed after auth deletion:', appDataError);
      } else if (lookup.row) {
        const userData = lookup.row;
        appDataFound = true;
        try {
          // Start transaction to delete all user data
          await prisma.$transaction(async (tx) => {
            // Delete all user's recipes and related data
            for (const recipe of userData.recipes) {
              // Delete recipe photos from S3 (if needed)
              // Note: You might want to add S3 cleanup here
              
              // Delete recipe-related data
              await tx.ingredient.deleteMany({ where: { recipeId: recipe.id } });
              await tx.nutrition.deleteMany({ where: { recipeId: recipe.id } });
              await tx.photo.deleteMany({ where: { recipeId: recipe.id } });
              await tx.recipeTag.deleteMany({ where: { recipeId: recipe.id } });
              await tx.collectionRecipe.deleteMany({ where: { recipeId: recipe.id } });
              await tx.comment.deleteMany({ where: { recipeId: recipe.id } });
              await tx.like.deleteMany({ where: { recipeId: recipe.id } });
            }

            // Delete user's recipes
            await tx.recipe.deleteMany({ where: { authorId: userId } });

            // Delete user's collections
            await tx.collectionRecipe.deleteMany({ 
              where: { collection: { userId } } 
            });
            await tx.collection.deleteMany({ where: { userId } });

            // Delete user's comments
            await tx.comment.deleteMany({ where: { userId } });

            // Delete user's likes
            await tx.like.deleteMany({ where: { userId } });

            // Delete follow relationships
            await tx.follow.deleteMany({ where: { followerId: userId } });
            await tx.follow.deleteMany({ where: { followingId: userId } });

            // Finally, delete the user record
            await tx.user.delete({ where: { id: userId } });
          });
          appDataDeleted = true;
        } catch (err) {
          // The auth user is already gone: report it on the 200, never as a 500 that would make
          // the app think nothing happened.
          appDataDeleted = false;
          appDataError = err instanceof Error ? err.message : String(err);
          console.warn('[account.delete] app-data cleanup failed after auth deletion:', appDataError);
        }
      }
    }

    return NextResponse.json({ 
      success: true, 
      authDeleted: true,
      requestLogRowsDeleted,
      appDataFound,
      appDataDeleted,
      ...(appDataError !== undefined ? { appDataError } : {}),
      message: "Account and all associated data deleted successfully",
      redirectTo: "/?message=" + encodeURIComponent("Your account has been deleted successfully.")
    });

  } catch (error) {
    console.error("Error deleting user account:", error);
    return NextResponse.json({ 
      error: "Failed to delete account. Please try again." 
    }, { status: 500 });
  }
}

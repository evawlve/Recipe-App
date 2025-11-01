import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

interface SearchSuggestion {
  label: string;
  q: string;
  support?: string;
}

interface UserSuggestion {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarKey: string | null;
  followerCount: number;
}

export async function GET(request: NextRequest) {
  // Skip execution during build time
  if (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    (process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV) ||
    process.env.BUILD_TIME === 'true'
  ) {
    return NextResponse.json({ error: 'Not available during build' }, { status: 503 });
  }

  // Import only when not in build mode
  const { prisma } = await import('@/lib/db');

  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim();

  try {

    if (!q || q.length < 2) {
      return NextResponse.json({
        query: q || '',
        searches: [],
        users: [],
      });
    }

    const lowerQ = q.toLowerCase();

    // ============= RECIPE SEARCHES =============
    // Use raw SQL for optimal performance with trigram search
    const recipeSearchesRaw = await prisma.$queryRaw<
      Array<{
        title: string;
        tag_labels: string;
        like_count: bigint;
        view_count: bigint;
        prefix_score: number;
        trgm_score: number;
        popularity_score: number;
        final_score: number;
      }>
    >(
      Prisma.sql`
        WITH recipe_data AS (
          SELECT 
            r.title,
            COALESCE(
              STRING_AGG(DISTINCT t.label, ', ' ORDER BY t.label), 
              ''
            ) AS tag_labels,
            COUNT(DISTINCT l."userId") AS like_count,
            COUNT(DISTINCT rv.id) AS view_count,
            -- Prefix match score (3x weight)
            CASE 
              WHEN LOWER(r.title) LIKE ${lowerQ + '%'} THEN 3.0 
              ELSE 0.0 
            END AS prefix_score,
            -- Trigram similarity score (2x weight)
            (SIMILARITY(LOWER(r.title), ${lowerQ}) * 2.0) AS trgm_score
          FROM "Recipe" r
          LEFT JOIN "RecipeTag" rt ON r.id = rt."recipeId"
          LEFT JOIN "Tag" t ON rt."tagId" = t.id
          LEFT JOIN "Like" l ON r.id = l."recipeId"
          LEFT JOIN "RecipeView" rv ON r.id = rv."recipeId"
          WHERE 
            LOWER(r.title) LIKE ${lowerQ + '%'}
            OR SIMILARITY(LOWER(r.title), ${lowerQ}) > 0.2
          GROUP BY r.id, r.title
        )
        SELECT 
          title,
          tag_labels,
          like_count,
          view_count,
          prefix_score,
          trgm_score,
          -- Normalize popularity (log scale to prevent dominance)
          (LOG(1 + like_count::numeric + view_count::numeric / 10.0) / 10.0)::numeric AS popularity_score,
          (prefix_score + trgm_score + LOG(1 + like_count::numeric + view_count::numeric / 10.0) / 10.0)::numeric AS final_score
        FROM recipe_data
        ORDER BY final_score DESC
        LIMIT 5
      `
    );

    const searches: SearchSuggestion[] = recipeSearchesRaw.map((row) => ({
      label: row.title,
      q: row.title.toLowerCase(),
      support: row.tag_labels || undefined,
    }));

    // ============= USER ACCOUNTS =============
    const usersRaw = await prisma.$queryRaw<
      Array<{
        id: string;
        username: string | null;
        displayName: string | null;
        avatarKey: string | null;
        follower_count: bigint;
        prefix_score: number;
        trgm_score: number;
        follower_score: number;
        final_score: number;
      }>
    >(
      Prisma.sql`
        WITH user_data AS (
          SELECT 
            u.id,
            u.username,
            u."displayName",
            u."avatarKey",
            COUNT(DISTINCT f."followerId") AS follower_count,
            -- Prefix match on username or displayName (3x weight)
            CASE 
              WHEN LOWER(u.username) LIKE ${lowerQ + '%'} THEN 3.0
              WHEN LOWER(u."displayName") LIKE ${lowerQ + '%'} THEN 2.5
              ELSE 0.0 
            END AS prefix_score,
            -- Trigram similarity (2x weight, check both username and displayName)
            GREATEST(
              COALESCE(SIMILARITY(LOWER(u.username), ${lowerQ}), 0),
              COALESCE(SIMILARITY(LOWER(u."displayName"), ${lowerQ}), 0)
            ) * 2.0 AS trgm_score
          FROM "User" u
          LEFT JOIN "Follow" f ON u.id = f."followingId"
          WHERE 
            u.username IS NOT NULL
            AND (
              LOWER(u.username) LIKE ${lowerQ + '%'}
              OR LOWER(u."displayName") LIKE ${lowerQ + '%'}
              OR COALESCE(SIMILARITY(LOWER(u.username), ${lowerQ}), 0) > 0.2
              OR COALESCE(SIMILARITY(LOWER(u."displayName"), ${lowerQ}), 0) > 0.2
            )
          GROUP BY u.id, u.username, u."displayName", u."avatarKey"
        )
        SELECT 
          id,
          username,
          "displayName",
          "avatarKey",
          follower_count,
          prefix_score,
          trgm_score,
          -- Normalize follower count (log scale)
          (LOG(1 + follower_count::numeric) / 10.0)::numeric AS follower_score,
          (prefix_score + trgm_score + LOG(1 + follower_count::numeric) / 10.0)::numeric AS final_score
        FROM user_data
        ORDER BY final_score DESC
        LIMIT 8
      `
    );

    const users: UserSuggestion[] = usersRaw.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      avatarKey: row.avatarKey,
      followerCount: Number(row.follower_count),
    }));

    return NextResponse.json({
      query: q,
      searches,
      users,
    });
  } catch (error) {
    console.error('Search suggest error:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        query: q || '',
        searches: [],
        users: [],
      },
      { status: 500 }
    );
  }
}


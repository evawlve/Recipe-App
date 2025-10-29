import { NextRequest, NextResponse } from 'next/server';
function updateRecentViewsCookie(req: NextRequest, response: Response, recipeId: string) {
  const cookie = req.cookies.get('ms_recent');
  let recentIds: string[] = [];
  
  if (cookie?.value) {
    try {
      recentIds = cookie.value.split(',').filter(Boolean);
    } catch {
      recentIds = [];
    }
  }
  
  // Add new recipe ID to the front, remove duplicates, limit to 50
  recentIds = [recipeId, ...recentIds.filter(id => id !== recipeId)].slice(0, 50);
  
  // Set the updated cookie
  response.headers.set('Set-Cookie', `ms_recent=${recentIds.join(',')}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  const { id: recipeId } = await params;
  const sessionId = req.cookies.get('ms_session')?.value;
  
  if (!sessionId) {
    return Response.json({ ok: false }, { status: 400 });
  }

  try {
    const user = await getCurrentUser().catch(() => null);
    const since = new Date(Date.now() - 8 * 60 * 60 * 1000); // 8 hours ago

    // Quick exists check - dedup per (recipeId, sessionId) for 8 hours
    const exists = await prisma.recipeView.findFirst({
      where: { 
        recipeId, 
        sessionId, 
        createdAt: { gte: since } 
      },
      select: { id: true },
    });
    
    if (exists) {
      return Response.json({ ok: true });
    }

    // Create new view record
    await prisma.recipeView.create({
      data: { 
        recipeId, 
        sessionId, 
        userId: user?.id ?? null 
      },
    });
    
    // Update recent views cookie
    const response = Response.json({ ok: true });
    updateRecentViewsCookie(req, response, recipeId);
    
    return response;
  } catch (error) {
    console.error('Error tracking view:', error);
    return Response.json({ ok: false }, { status: 500 });
  }
}

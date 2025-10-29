import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
export async function GET(req: NextRequest) {
	// Skip execution during build time
	if (process.env.NEXT_PHASE === 'phase-production-build' || 
	    process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
	    process.env.BUILD_TIME === 'true') {
		return NextResponse.json({ error: "Not available during build" }, { status: 503 });
	}

	// Import only when not in build mode
	const { prisma } = await import("@/lib/db");
	const { getCurrentUser } = await import("@/lib/auth");
	
  const since = new Date(Date.now() - 30*24*3600*1000);
  const rows = await prisma.recipe.findMany({
    where: { createdAt: { gte: since } },
    include: { 
      _count: { select: { likes: true, comments: true } }, 
      photos: { take: 1 }, 
      author: {
        select: {
          id: true,
          name: true,
          username: true,
          avatarUrl: true,
        }
      }, 
      tags: { include: { tag: true } } 
    },
    orderBy: { createdAt: 'desc' },
    take: 200 // candidate window
  });

  const scored = rows
    .map(r => ({ r, s: (r._count.likes||0) + 2*(r._count.comments||0) }))
    .sort((a,b)=>b.s-a.s || +b.r.createdAt - +a.r.createdAt)
    .slice(0, 12)
    .map(x => x.r);

  return Response.json({ items: scored });
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' || 
      process.env.NODE_ENV === 'production' && !process.env.VERCEL_ENV ||
      process.env.BUILD_TIME === 'true') {
    return Response.json({ error: "Not available during build" }, { status: 503 });
  }

  try {
    // Import only when not in build mode
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1`;
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'db' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  // Skip execution during build time
  if (process.env.NEXT_PHASE === 'phase-production-build' || 
      process.env.BUILD_TIME === 'true') {
    return Response.json({ error: "Not available during build" }, { status: 503 });
  }

  try {
    // Import only when not in build mode
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1`;
    return Response.json({ ok: true });
  } catch (e: any) {
    // Anonymous route: a Prisma connection error names the DB host and port, so the
    // detail goes to the server log only (2026-09-24 security review).
    console.error('[health] db ping failed:', e?.message ?? e);
    return Response.json({ ok: false, error: 'db' }, { status: 500 });
  }
}

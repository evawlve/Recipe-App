export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function GET() {
  try {
    // Import only when not in build mode
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1`;
    return Response.json({ ok: true });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message ?? 'db' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';

export async function POST(req: Request, { params }: any) {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.error('BUILD_PHASE_POST_HIT', { url: '/api/recipes/[id]/__save', params });
    return new Response('Not available during build', { status: 503 });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}



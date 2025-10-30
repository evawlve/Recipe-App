import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  const start = Date.now();
  const secret = req.headers.get('x-cron-secret');
  if (!secret || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { logger } = await import('@/lib/logger');
  const { buildSimilarities } = await import('@/lib/recipes/build-similar');

  logger.info('cron_similar_start');
  try {
    const result = await buildSimilarities({ lookbackDays: 30, topK: 20 });
    const ms = Date.now() - start;
    logger.info('cron_similar_end', { durationMs: ms, ...result });
    return NextResponse.json({ ok: true, durationMs: ms, ...result });
  } catch (error: any) {
    const ms = Date.now() - start;
    logger.error('cron_similar_error', { durationMs: ms, error: error?.message ?? String(error) });
    return NextResponse.json({ ok: false, error: 'Similar build failed' }, { status: 500 });
  }
}



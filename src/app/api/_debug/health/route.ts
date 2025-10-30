import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // 1) DB ping
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1 as ok`;
  } catch (e: any) {
    return NextResponse.json({ ok: false, at: 'db', error: String(e) }, { status: 500 });
  }

  // 2) Supabase auth ping (read-only cookie adapter)
  try {
    // NOTE: cookies() is async in Next 15
    const c = await cookies();

    // Prefer the new helper package
    const { createServerClient } = await import('@supabase/ssr');

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) {
            return c.get(name)?.value;
          },
          // No-ops in a route handler; we're just probing
          set() {},
          remove() {},
        },
      }
    );

    const { data, error } = await supabase.auth.getUser();
    return NextResponse.json({
      ok: true,
      user: data?.user ? { id: data.user.id, email: data.user.email } : null,
      authError: error?.message ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, at: 'auth', error: String(e) }, { status: 500 });
  }
}



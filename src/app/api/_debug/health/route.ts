import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  // DB ping
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1 as ok`;
  } catch (e: any) {
    return NextResponse.json({ ok: false, at: 'db', error: String(e) }, { status: 500 });
  }

  // Supabase ping (cookie read is optional; we just prove auth client initializes)
  try {
    const c = await cookies();
    const { createServerClient } = await import('@supabase/ssr');
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get(name: string) { return c.get(name)?.value; },
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



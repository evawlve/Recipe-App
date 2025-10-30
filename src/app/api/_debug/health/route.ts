export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const { prisma } = await import('@/lib/db');
    await prisma.$queryRaw`select 1 as ok`; // DB ping
  } catch (e: any) {
    return Response.json({ ok: false, at: 'db', error: String(e) }, { status: 500 });
  }

  try {
    const { cookies } = await import('next/headers');
    const { createServerClient } = await import('@supabase/ssr');

    const c = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          get: (name: string) => c.get(name)?.value,
          set: () => {},
          remove: () => {},
        },
      }
    );

    const { data: { user }, error } = await supabase.auth.getUser();
    return Response.json({ ok: true, user: user ? { id: user.id, email: user.email } : null, error });
  } catch (e: any) {
    return Response.json({ ok: false, at: 'auth', error: String(e) }, { status: 500 });
  }
}



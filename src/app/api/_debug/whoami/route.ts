import { NextResponse } from "next/server";

import { cookies } from "next/headers";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const revalidate = 0;

export async function GET() {

  const c = await cookies();

  const sbUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL;

  const sbAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!sbUrl || !sbAnon) {

    return NextResponse.json({ ok:false, at:"env", error:"Missing SUPABASE envs" }, { status:500 });

  }

  try {

    const { createServerClient } = await import("@supabase/ssr");

    const supabase = createServerClient(sbUrl, sbAnon, {

      cookies: {

        get: (name: string) => c.get(name)?.value,

        set: () => {},

        remove: () => {},

      },

    });

    const { data: { user }, error } = await supabase.auth.getUser();

    return NextResponse.json({

      ok:true,

      user: user ? { id:user.id, email:user.email } : null,

      authError: error?.message ?? null,

      cookieKeys: c.getAll().map(k => k.name).filter(n => n.startsWith("sb-")),

    });

  } catch (e:any) {

    return NextResponse.json({ ok:false, at:"supabase", error:String(e) }, { status:500 });

  }

}

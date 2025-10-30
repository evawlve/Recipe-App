import { NextResponse } from "next/server";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";

export const revalidate = 0;

function mask(url?: string) {

  if (!url) return null;

  try {

    const u = new URL(url);

    return { host:u.host, pathname:u.pathname, search:u.search };

  } catch { return "invalid"; }

}

export async function GET() {

  return NextResponse.json({

    NODE_ENV: process.env.NODE_ENV,

    SITE_URL: process.env.NEXT_PUBLIC_SITE_URL ?? null,

    DATABASE_URL: mask(process.env.DATABASE_URL),

    DIRECT_URL: mask(process.env.DIRECT_URL),

    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? "set" : "missing",

    SUPABASE_ANON: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? "set" : "missing",

  });

}
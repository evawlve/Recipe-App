import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
	const pick = (k: string) => (process.env[k] ? 'present' : 'missing');
	return NextResponse.json({
		NEXT_PUBLIC_SUPABASE_URL: pick('NEXT_PUBLIC_SUPABASE_URL'),
		NEXT_PUBLIC_SUPABASE_ANON_KEY: pick('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
		SUPABASE_SERVICE_ROLE_KEY: pick('SUPABASE_SERVICE_ROLE_KEY'),
		DATABASE_URL: pick('DATABASE_URL'),
		NODE_ENV: process.env.NODE_ENV,
		RUNTIME: 'nodejs-route',
	});
}



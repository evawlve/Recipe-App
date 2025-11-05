import { NextResponse } from "next/server";
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    throw new Error("Debug: forced failure");
  } catch (e) {
    // Sentry disabled
    // Sentry.captureException(e);
    console.error('Error:', e);
    return NextResponse.json({ ok: true, sent: true });
  }
}



import { NextResponse } from "next/server";
// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    throw new Error("Sentry API oops test");
  } catch (err) {
    // Sentry disabled
    // Sentry.captureException(err);
    console.error('Error:', err);
    // rethrow so it shows as unhandled, too
    throw err as Error;
  }
}



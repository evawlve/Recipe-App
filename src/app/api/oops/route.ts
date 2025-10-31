import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    throw new Error("Sentry API oops test");
  } catch (err) {
    Sentry.captureException(err);
    // rethrow so it shows as unhandled, too
    throw err as Error;
  }
}



import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    throw new Error("Debug: forced failure");
  } catch (e) {
    Sentry.captureException(e);
    return NextResponse.json({ ok: true, sent: true });
  }
}



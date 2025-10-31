import * as Sentry from "@sentry/nextjs";

export async function withSpan<T>(name: string, fn: () => Promise<T>) {
  return Sentry.startSpan({ name }, fn);
}



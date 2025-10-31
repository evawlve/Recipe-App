import * as Sentry from "@sentry/nextjs";

export async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    Sentry.captureException(err);
    return null;
  }
}



// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";

export async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    // Sentry disabled
    // Sentry.captureException(err);
    console.error('Error in safe function:', err);
    return null;
  }
}



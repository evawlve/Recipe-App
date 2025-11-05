// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";

export async function withSpan<T>(name: string, fn: () => Promise<T>) {
  // Sentry disabled - just execute the function
  return fn();
}



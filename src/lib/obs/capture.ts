// Sentry disabled - can be re-enabled in the future
// import * as Sentry from "@sentry/nextjs";

export function capture(err: unknown, context?: Record<string, any>) {
  // Sentry disabled - just log to console
  console.error('Error captured:', err, context);
}



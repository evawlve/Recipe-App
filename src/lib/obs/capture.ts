import * as Sentry from "@sentry/nextjs";

export function capture(err: unknown, context?: Record<string, any>) {
  if (context) Sentry.setContext("extra", context);
  Sentry.captureException(err);
}



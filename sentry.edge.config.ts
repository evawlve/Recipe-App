import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: (() => {
    const fromEnv = Number(process.env.SENTRY_TRACES_SAMPLE_RATE);
    if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
    const isProd = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    return isProd ? 0.15 : 1.0;
  })(),
  profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0),
  enableLogs: process.env.NODE_ENV !== "production",
  sendDefaultPii: process.env.NODE_ENV === "production" ? false : undefined,
});

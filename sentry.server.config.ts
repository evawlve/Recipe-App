import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // Performance / tracing:
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.05), // 5% default
  profilesSampleRate: Number(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? 0), // optional, 0–0.1 typical
  // Logging in dev only:
  enableLogs: process.env.NODE_ENV !== "production",
  // If you want to limit where trace headers propagate:
  // tracePropagationTargets: [/^https:\/\/yourdomain\.vercel\.app$/],
});

/**
 * Structured JSON logger.
 *
 * WHY THIS DOES NOT USE `console.*`
 * ---------------------------------
 * `next.config.ts` sets `compiler.removeConsole: { exclude: ['error','warn'] }`
 * for production builds. SWC applies that at BUILD time by deleting the matching
 * `console.<method>(...)` call expressions outright — so every `console.info` and
 * `console.debug` in this file was removed from the deployed bundle. Measured
 * consequence (2026-08-01, box `~/Recipe-App/logs/next-start.log`): 0 lines
 * carrying `"level":"info"` out of 976,124, against 9,128 warn and 67 error
 * (`grep -o '"level":"[a-z]*"' next-start.log | sort | uniq -c`).
 * `logger.info('ai_nutrition.batch_cap_reached', ...)` was therefore unloggable in
 * production, and the cap exhausting was only ever visible because a downstream
 * `logger.warn` happened to carry the reason in its payload.
 *
 * `process.stdout.write` / `process.stderr.write` are not `console` member calls,
 * so `removeConsole` does not match them and cannot strip them. Do NOT "simplify"
 * this back to `console.*` — that reintroduces the exact silent failure above.
 * Both streams land in the same file: the `recipe-api` unit points StandardOutput
 * and StandardError at the same `append:` path.
 *
 * LEVELS
 * ------
 * Volume is bounded by a runtime `LOG_LEVEL` threshold — changing it needs a
 * restart, not a rebuild. It defaults to `warn` in production, which reproduces
 * today's measured volume exactly, and to `debug` elsewhere. `LOG_LEVEL=warn` was
 * already set in a box `.env` while NO code read it — the project's own
 * instrument-fail-open class. It is read here now.
 *
 * `audit` is the exception: gate / cap / decision events that must be observable
 * whatever the threshold is. It bypasses the threshold entirely rather than
 * sitting at the top of the numeric ordering, so it cannot be silenced by raising
 * LOG_LEVEL. Keep the audit set small — it is a channel for decisions with
 * cache-level blast radius, not a second info.
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "audit";

type LogContext = Record<string, unknown> | undefined;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  // Never compared against the threshold — see `log()`. Present only so every
  // LogLevel has an entry.
  audit: 99,
};

/**
 * Resolve the numeric threshold once, at module load. `silent` suppresses every
 * threshold-gated level; `audit` still gets through by design.
 */
function resolveThreshold(): number {
  const raw = (process.env.LOG_LEVEL || "").trim().toLowerCase();
  if (raw === "silent" || raw === "off" || raw === "none") return Number.POSITIVE_INFINITY;
  if (raw === "debug") return LEVEL_ORDER.debug;
  if (raw === "info") return LEVEL_ORDER.info;
  if (raw === "warn" || raw === "warning") return LEVEL_ORDER.warn;
  if (raw === "error") return LEVEL_ORDER.error;
  // Unset or unrecognised: keep production at today's measured volume.
  return process.env.NODE_ENV === "production" ? LEVEL_ORDER.warn : LEVEL_ORDER.debug;
}

const THRESHOLD = resolveThreshold();

function normalize(value: unknown) {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function format(level: LogLevel, msg: string, ctx?: LogContext) {
  // `level`, `msg` and `ts` are written LAST so a context key can never shadow
  // them. `"level":"<x>"` is the field every operator greps on — a call site that
  // happened to pass `level` in its context would silently corrupt exactly the
  // signal this module exists to keep trustworthy. Context still owns every other
  // key, and this keeps the file one JSON object per line.
  const merged: Record<string, unknown> = ctx ? { ...ctx } : {};
  merged.level = level;
  merged.msg = msg;
  merged.ts = new Date().toISOString();
  return JSON.stringify(merged);
}

function log(level: LogLevel, msg: string, ctx?: LogContext) {
  // `audit` is deliberately checked BEFORE the threshold, not ranked above it.
  if (level !== "audit" && LEVEL_ORDER[level] < THRESHOLD) return;

  const normalized = ctx
    ? Object.fromEntries(Object.entries(ctx).map(([k, v]) => [k, normalize(v)]))
    : undefined;
  const line = format(level, msg, normalized) + "\n";

  if (level === "debug" || level === "info") {
    process.stdout.write(line);
  } else {
    process.stderr.write(line);
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => log("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
  /**
   * Non-suppressible decision channel. Use for gate / cap / refusal events whose
   * blast radius is a cached identity or a silently disabled code path — never
   * for per-request progress, which is what `info` is for.
   */
  audit: (msg: string, ctx?: LogContext) => log("audit", msg, ctx),
};

type LogLevel = "debug" | "info" | "warn" | "error";

type LogContext = Record<string, unknown> | undefined;

function format(level: LogLevel, msg: string, ctx?: LogContext) {
  const base = { level, msg, ts: new Date().toISOString() } as Record<string, unknown>;
  const merged = ctx ? { ...base, ...ctx } : base;
  return JSON.stringify(merged);
}

function log(level: LogLevel, msg: string, ctx?: LogContext) {
  const line = format(level, msg, ctx);
  switch (level) {
    case "debug":
      if (process.env.NODE_ENV !== "production") console.debug(line);
      break;
    case "info":
      console.info(line);
      break;
    case "warn":
      console.warn(line);
      break;
    case "error":
      console.error(line);
      break;
  }
}

export const logger = {
  debug: (msg: string, ctx?: LogContext) => log("debug", msg, ctx),
  info: (msg: string, ctx?: LogContext) => log("info", msg, ctx),
  warn: (msg: string, ctx?: LogContext) => log("warn", msg, ctx),
  error: (msg: string, ctx?: LogContext) => log("error", msg, ctx),
};


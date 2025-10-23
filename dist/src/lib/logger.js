"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function format(level, msg, ctx) {
    const base = { level, msg, ts: new Date().toISOString() };
    const merged = ctx ? { ...base, ...ctx } : base;
    return JSON.stringify(merged);
}
function log(level, msg, ctx) {
    const line = format(level, msg, ctx);
    switch (level) {
        case "debug":
            if (process.env.NODE_ENV !== "production")
                console.debug(line);
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
exports.logger = {
    debug: (msg, ctx) => log("debug", msg, ctx),
    info: (msg, ctx) => log("info", msg, ctx),
    warn: (msg, ctx) => log("warn", msg, ctx),
    error: (msg, ctx) => log("error", msg, ctx),
};

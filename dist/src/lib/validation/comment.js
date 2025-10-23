"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.commentBodySchema = void 0;
const zod_1 = require("zod");
exports.commentBodySchema = zod_1.z.object({
    body: zod_1.z.string().trim().min(1, "Say something").max(500, "Keep it under 500 chars"),
});

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const auth_1 = require("@/lib/auth");
async function GET() {
    const user = await (0, auth_1.getCurrentUser)();
    if (!user)
        return server_1.NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return server_1.NextResponse.json({
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        firstName: user.firstName ?? null,
        lastName: user.lastName ?? null,
        username: user.username ?? null,
        displayName: user.displayName ?? null,
        avatarUrl: user.avatarUrl ?? null,
        avatarKey: user.avatarKey ?? null
    });
}

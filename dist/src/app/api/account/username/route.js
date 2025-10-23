"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PATCH = PATCH;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const server_2 = require("@/lib/supabase/server");
const zod_1 = require("zod");
const usernameSchema = zod_1.z.object({
    username: zod_1.z.string()
        .min(3, 'Username must be at least 3 characters')
        .max(20, 'Username must be at most 20 characters')
        .regex(/^[a-z0-9_]+$/, 'Username can only contain lowercase letters, numbers, and underscores'),
});
async function PATCH(request) {
    try {
        const supabase = await (0, server_2.createSupabaseServerClient)();
        const { data: { user }, error: authError } = await supabase.auth.getUser();
        if (authError || !user) {
            return server_1.NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        const body = await request.json();
        const { username } = usernameSchema.parse(body);
        // Check if username is already taken (case-insensitive)
        const existingUser = await db_1.prisma.user.findFirst({
            where: {
                username: {
                    equals: username,
                    mode: 'insensitive'
                }
            }
        });
        if (existingUser && existingUser.id !== user.id) {
            return server_1.NextResponse.json({ error: 'Username is already taken' }, { status: 400 });
        }
        // Update user with username only
        const updatedUser = await db_1.prisma.user.update({
            where: { id: user.id },
            data: {
                username: username.toLowerCase(),
            },
        });
        return server_1.NextResponse.json({
            ok: true,
            username: updatedUser.username
        });
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            return server_1.NextResponse.json({
                error: 'Invalid input',
                details: error.errors
            }, { status: 400 });
        }
        console.error('Username update error:', error);
        return server_1.NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}

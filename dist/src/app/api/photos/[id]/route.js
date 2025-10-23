"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runtime = void 0;
exports.DELETE = DELETE;
const server_1 = require("next/server");
const db_1 = require("@/lib/db");
const auth_1 = require("@/lib/auth");
const client_s3_1 = require("@aws-sdk/client-s3");
exports.runtime = "nodejs";
async function DELETE(_req, { params }) {
    const resolvedParams = await params;
    const photoId = resolvedParams.id;
    const user = await (0, auth_1.getCurrentUser)();
    const region = process.env.AWS_REGION;
    const bucket = process.env.S3_BUCKET;
    if (!region || !bucket)
        return server_1.NextResponse.json({ error: "Server misconfig" }, { status: 500 });
    const photo = await db_1.prisma.photo.findUnique({
        where: { id: photoId },
        include: { recipe: { select: { authorId: true } } },
    });
    if (!photo)
        return server_1.NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!user || photo.recipe.authorId !== user.id)
        return server_1.NextResponse.json({ error: "Forbidden" }, { status: 403 });
    try {
        const s3 = new client_s3_1.S3Client({ region });
        await s3.send(new client_s3_1.DeleteObjectCommand({ Bucket: bucket, Key: photo.s3Key }));
    }
    catch {
        // ignore S3 delete failures (object may already be gone)
    }
    await db_1.prisma.photo.delete({ where: { id: photoId } });
    return new server_1.NextResponse(null, { status: 204 });
}

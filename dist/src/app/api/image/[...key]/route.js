"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GET = GET;
const server_1 = require("next/server");
const client_s3_1 = require("@aws-sdk/client-s3");
const s3 = new client_s3_1.S3Client({ region: process.env.AWS_REGION });
async function GET(_req, { params }) {
    const { key: keyArray } = await params;
    const key = keyArray.join("/"); // avatars/...
    try {
        const cmd = new client_s3_1.GetObjectCommand({
            Bucket: process.env.S3_BUCKET,
            Key: key,
        });
        const obj = await s3.send(cmd);
        const body = obj.Body;
        const headers = new Headers();
        headers.set("Content-Type", obj.ContentType || "application/octet-stream");
        headers.set("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");
        if (obj.ETag)
            headers.set("ETag", obj.ETag.replaceAll('"', ""));
        if (obj.LastModified)
            headers.set("Last-Modified", obj.LastModified.toUTCString());
        return new Response(body, { status: 200, headers });
    }
    catch (e) {
        if (e?.$metadata?.httpStatusCode === 404) {
            return server_1.NextResponse.json({ error: "Not found" }, { status: 404 });
        }
        return server_1.NextResponse.json({ error: "Image fetch failed" }, { status: 500 });
    }
}

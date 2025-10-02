import { NextResponse } from "next/server";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

export const runtime = "nodejs"; // ensure Node runtime

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

const s3 = new S3Client({ region });

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ key: string[] }> }
) {
  try {
    console.log("Image API called");
    
    if (!region || !bucket) {
      console.error("Missing AWS_REGION or S3_BUCKET", { region, bucket });
      return new NextResponse("Missing AWS_REGION or S3_BUCKET", { status: 500 });
    }
    
    const params = await ctx.params;
    const parts = Array.isArray(params?.key) ? params.key : [];
    if (!parts.length) {
      console.error("Missing key parts");
      return new NextResponse("Missing key", { status: 400 });
    }

    // Rebuild the key safely
    const key = parts.map((p) => decodeURIComponent(p)).join("/");
    console.log("Fetching S3 object:", { key, bucket, region });

    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    console.log("S3 object retrieved:", { contentType: obj.ContentType, contentLength: obj.ContentLength });
    
    const body = obj.Body as Readable;
    const stream = Readable.toWeb(body);

    const headers = new Headers();
    if (obj.ContentType) headers.set("Content-Type", obj.ContentType);
    if (obj.ETag) headers.set("ETag", obj.ETag.replaceAll('"', ""));
    if (obj.ContentLength != null) headers.set("Content-Length", String(obj.ContentLength));
    headers.set("Cache-Control", "public, max-age=300, s-maxage=300");

    console.log("Returning image with headers:", Object.fromEntries(headers.entries()));
    return new NextResponse(stream as unknown as BodyInit, { headers });
  } catch (err: any) {
    console.error("Image API error:", err);
    const msg = String(err?.name || err?.message || "Error");
    const status = msg.includes("NoSuchKey") || msg.includes("NotFound") ? 404 : 500;
    console.error("Returning error:", { msg, status });
    return new NextResponse(status === 404 ? "Not found" : `Error fetching object: ${msg}`, { status });
  }
}

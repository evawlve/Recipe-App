/**
 * ⚠️ DEPRECATED: Image Proxy Route
 * 
 * This route proxies images from S3 through serverless functions.
 * It's being replaced by direct CloudFront CDN delivery for better performance.
 * 
 * Migration:
 * - All components should use getCdnImageUrl() from @/lib/cdn instead
 * - This route remains as a fallback when CLOUDFRONT_IMAGE_BASE is not set
 * 
 * Performance Impact:
 * - This route adds ~200-500ms latency per image
 * - Significantly impacts LCP/FCP metrics
 * - Should only be used during development or as fallback
 * 
 * TODO: Remove this route after confirming all consumers have migrated to CDN
 */

import { NextResponse } from "next/server";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const runtime = 'nodejs';
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";


export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  // Log usage for migration tracking
  console.warn('[DEPRECATED] /api/image proxy used. Consider migrating to CloudFront CDN.');
  const { key: keyArray } = await params;
  const key = keyArray.join("/"); // avatars/...
  
  // Create S3Client inside the function to avoid build-time errors
  const s3 = new S3Client({ 
    region: process.env.AWS_REGION || 'us-east-2',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    }
  });
  
  try {
    const cmd = new GetObjectCommand({
      Bucket: process.env.S3_BUCKET!,
      Key: key,
    });
    const obj = await s3.send(cmd);
    const body = obj.Body as ReadableStream;

    const headers = new Headers();
    headers.set("Content-Type", obj.ContentType || "application/octet-stream");
    headers.set("Cache-Control", "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800");

    if (obj.ETag) headers.set("ETag", obj.ETag.replaceAll('"', ""));
    if (obj.LastModified) headers.set("Last-Modified", obj.LastModified.toUTCString());

    return new Response(body as any, { status: 200, headers });
  } catch (e: any) {
    if (e?.$metadata?.httpStatusCode === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Image fetch failed" }, { status: 500 });
  }
}

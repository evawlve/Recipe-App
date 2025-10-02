import { NextRequest, NextResponse } from 'next/server';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

const s3 = new S3Client({ region });

export async function POST(req: NextRequest) {
  if (!region || !bucket) {
    return NextResponse.json({ error: 'Missing AWS_REGION or S3_BUCKET' }, { status: 500 });
  }
  const { filename, contentType, maxSizeMB = 10 } = await req.json();
  const key = `uploads/${Date.now()}-${filename}`;

  const { url, fields } = await createPresignedPost(s3, {
    Bucket: bucket,
    Key: key,
    Conditions: [
      ["content-length-range", 0, maxSizeMB * 1024 * 1024],
      ["starts-with", "$Content-Type", ""],
    ],
    Fields: { "Content-Type": contentType },
    Expires: 60, // seconds
  });

  const publicBase = process.env.S3_PUBLIC_BASE_URL;
  const publicUrl = publicBase ? `${publicBase}/${key}` : null;

  return NextResponse.json({ url, fields, key, publicUrl });
}

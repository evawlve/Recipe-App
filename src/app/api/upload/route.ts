import { NextRequest, NextResponse } from 'next/server';
import { S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { randomBytes } from 'crypto';

const region = process.env.AWS_REGION;
const bucket = process.env.S3_BUCKET;

const s3 = new S3Client({ region });

// Allowed image content types
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png', 
  'image/webp',
  'image/avif'
] as const;

// Sanitize filename to prevent path traversal and remove unsafe characters
function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace unsafe chars with underscore
    .replace(/\.{2,}/g, '.') // Replace multiple dots with single dot
    .replace(/^\.+|\.+$/g, '') // Remove leading/trailing dots
    .substring(0, 100); // Limit length
}

// Generate crypto-random ID
function generateRandomId(): string {
  return randomBytes(8).toString('hex');
}

// Build S3 key with timestamp, random ID, and sanitized filename
function buildS3Key(filename: string, type: 'avatar' | 'recipe' = 'recipe'): string {
  const sanitized = sanitizeFilename(filename);
  const randomId = generateRandomId();
  
  if (type === 'avatar') {
    return `avatars/${Date.now()}-${randomId}-${sanitized}`;
  }
  
  return `uploads/${Date.now()}-${randomId}-${sanitized}`;
}

export async function POST(req: NextRequest) {
  if (!region || !bucket) {
    return NextResponse.json({ error: 'Missing AWS_REGION or S3_BUCKET' }, { status: 500 });
  }

  try {
    const body = await req.json();
    const { filename, contentType, maxSizeMB = 10, type = 'uploads' } = body;

    // Validate required fields
    if (!filename || !contentType) {
      return NextResponse.json({ error: 'Missing filename or contentType' }, { status: 400 });
    }

    // Validate content type
    if (!ALLOWED_CONTENT_TYPES.includes(contentType as any)) {
      return NextResponse.json({ 
        error: 'Invalid content type. Allowed: image/jpeg, image/png, image/webp, image/avif' 
      }, { status: 400 });
    }

    // Build S3 key
    const key = buildS3Key(filename, type as 'avatar' | 'recipe');

    const { url, fields } = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 0, maxSizeMB * 1024 * 1024],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: 60, // 60 seconds
    });

    // Construct the proxy URL instead of direct S3 URL
    const proxyUrl = `/api/image/${encodeURIComponent(key)}`;
    
    console.log("Generated proxy URL:", proxyUrl);
    console.log("S3 Key:", key);
    console.log("✅ Using secure proxy instead of direct S3 access");

    return NextResponse.json({ 
      url, 
      fields, 
      key, 
      publicUrl: proxyUrl 
    });

  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON or server error' }, { status: 400 });
  }
}

/**
 * CDN Image Helper
 * 
 * Provides direct CloudFront URLs for images stored in S3.
 * This bypasses the /api/image/[...key] proxy route for better performance.
 * 
 * Requirements:
 * - CLOUDFRONT_IMAGE_BASE env var (e.g., https://d3abc123xyz0.cloudfront.net)
 * - CloudFront distribution configured with OAC to private S3 bucket
 */

/**
 * Converts an S3 key to a full CloudFront URL
 * @param key - S3 object key (e.g., "recipes/abc123.jpg")
 * @returns Full CloudFront URL
 */
export function getCdnImageUrl(key: string): string {
  const base = process.env.CLOUDFRONT_IMAGE_BASE || process.env.NEXT_PUBLIC_CLOUDFRONT_IMAGE_BASE;
  
  if (!base) {
    // Fallback to API proxy if CloudFront is not configured
    console.warn('CLOUDFRONT_IMAGE_BASE not set, falling back to API proxy');
    return `/api/image/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  
  // Remove trailing slash from base and leading slash from key
  const cleanBase = base.replace(/\/$/, '');
  const cleanKey = key.replace(/^\//, '');
  
  return `${cleanBase}/${cleanKey}`;
}

/**
 * Converts an S3 key to a CloudFront URL (client-safe version using public env var)
 * Use this in client components
 */
export function getCdnImageUrlClient(key: string): string {
  const base = process.env.NEXT_PUBLIC_CLOUDFRONT_IMAGE_BASE;
  
  if (!base) {
    console.warn('NEXT_PUBLIC_CLOUDFRONT_IMAGE_BASE not set, falling back to API proxy');
    return `/api/image/${key.split("/").map(encodeURIComponent).join("/")}`;
  }
  
  const cleanBase = base.replace(/\/$/, '');
  const cleanKey = key.replace(/^\//, '');
  
  return `${cleanBase}/${cleanKey}`;
}

/**
 * Gets the primary image URL for a recipe
 */
export function getPrimaryImageUrl(photos: Array<{ s3Key: string }>): string | null {
  if (!photos || photos.length === 0) {
    return null;
  }
  
  return getCdnImageUrl(photos[0].s3Key);
}


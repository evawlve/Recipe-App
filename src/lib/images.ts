import { getCdnImageUrl } from './cdn';

/**
 * Builds a public S3 image URL from an S3 key
 * Uses CloudFront CDN if configured, otherwise falls back to API proxy
 * 
 * @deprecated Use getCdnImageUrl from './cdn' instead
 */
export function buildImageUrl(s3Key: string): string {
  return getCdnImageUrl(s3Key);
}

/**
 * Gets the primary image URL for a recipe, or returns null if no images
 */
export function getPrimaryImageUrl(photos: Array<{ s3Key: string }>): string | null {
  if (!photos || photos.length === 0) {
    return null;
  }
  
  return getCdnImageUrl(photos[0].s3Key);
}

/**
 * Gets image source URL for a given S3 key
 * Uses CloudFront CDN if configured
 * 
 * @deprecated Use getCdnImageUrl from './cdn' instead
 */
export function imageSrcForKey(key: string): string {
  return getCdnImageUrl(key);
}
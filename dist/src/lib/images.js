"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildImageUrl = buildImageUrl;
exports.getPrimaryImageUrl = getPrimaryImageUrl;
exports.imageSrcForKey = imageSrcForKey;
/**
 * Builds a public S3 image URL from an S3 key
 * Uses S3_PUBLIC_BASE_URL if set, otherwise uses API proxy
 */
function buildImageUrl(s3Key) {
    const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL;
    if (publicBaseUrl) {
        return `${publicBaseUrl}/${s3Key}`;
    }
    // Use API proxy for private S3 buckets
    return `/api/image/${s3Key.split("/").map(encodeURIComponent).join("/")}`;
}
/**
 * Gets the primary image URL for a recipe, or returns null if no images
 */
function getPrimaryImageUrl(photos) {
    if (!photos || photos.length === 0) {
        return null;
    }
    return buildImageUrl(photos[0].s3Key);
}
/**
 * Gets image source URL for a given S3 key
 * Always uses API proxy for client-side usage
 */
function imageSrcForKey(key) {
    // Always use API proxy for private S3 buckets
    return `/api/image/${key.split("/").map(encodeURIComponent).join("/")}`;
}

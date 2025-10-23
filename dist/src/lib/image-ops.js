"use strict";
/**
 * Client-side image compression and resizing utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compressImage = compressImage;
exports.generateCompressedFilename = generateCompressedFilename;
/**
 * Compress and resize an image with optional cropping
 */
async function compressImage(file, opts = {}) {
    const { maxDim = 2048, quality = 0.82, type = "image/webp", squareCrop = false } = opts;
    console.log('Compressing image:', {
        name: file.name,
        size: file.size,
        type: file.type,
        maxDim,
        quality,
        squareCrop
    });
    // Validate file type
    if (!file.type.startsWith('image/')) {
        throw new Error('File is not an image');
    }
    // Create image bitmap with EXIF orientation support
    let imageBitmap;
    try {
        if ('createImageBitmap' in window) {
            imageBitmap = await createImageBitmap(file, {
                imageOrientation: 'from-image'
            });
        }
        else {
            // Fallback for older browsers
            const img = await loadImageFromFile(file);
            imageBitmap = await createImageBitmap(img);
        }
    }
    catch (error) {
        console.error('Error creating image bitmap:', error);
        throw new Error('Failed to process image');
    }
    // Calculate target dimensions
    let { width, height } = imageBitmap;
    // Apply square crop if requested
    if (squareCrop) {
        const minDim = Math.min(width, height);
        width = height = minDim;
    }
    // Scale down if needed
    if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
    }
    console.log('Target dimensions:', { width, height });
    // Create canvas and draw image
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Failed to get canvas context');
    }
    // For square crops, we need to crop the source image first
    if (squareCrop) {
        const sourceSize = Math.min(imageBitmap.width, imageBitmap.height);
        const sourceX = (imageBitmap.width - sourceSize) / 2;
        const sourceY = (imageBitmap.height - sourceSize) / 2;
        ctx.drawImage(imageBitmap, sourceX, sourceY, sourceSize, sourceSize, // source
        0, 0, width, height // destination
        );
    }
    else {
        ctx.drawImage(imageBitmap, 0, 0, width, height);
    }
    // Convert to blob
    const blob = await new Promise((resolve, reject) => {
        canvas.convertToBlob({ type, quality }).then(resolve).catch(reject);
    });
    // Determine file extension
    const ext = type === 'image/jpeg' ? 'jpg' : 'webp';
    console.log('Compression complete:', {
        originalSize: file.size,
        compressedSize: blob.size,
        compressionRatio: (blob.size / file.size * 100).toFixed(1) + '%',
        dimensions: { width, height },
        type,
        ext
    });
    // Clean up
    imageBitmap.close();
    return { blob, width, height, ext };
}
/**
 * Fallback function to load image from file for older browsers
 */
function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}
/**
 * Generate a new filename with the correct extension
 */
function generateCompressedFilename(originalName, ext) {
    const nameWithoutExt = originalName.replace(/\.[^/.]+$/, '');
    return `${nameWithoutExt}.${ext}`;
}

"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFileToS3 = uploadFileToS3;
exports.getImageDimensions = getImageDimensions;
exports.uploadFilesToS3 = uploadFilesToS3;
/**
 * Upload a single file to S3 using presigned POST
 */
async function uploadFileToS3(file) {
    // Check file size before attempting upload
    const maxSizeBytes = 15 * 1024 * 1024; // 15MB in bytes
    if (file.size > maxSizeBytes) {
        throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the maximum allowed size of 15MB`);
    }
    // Get presigned POST data from our API
    console.log('Requesting presigned URL for avatar upload:', {
        filename: file.name,
        contentType: file.type,
        size: file.size
    });
    const presignResponse = await fetch('/api/upload', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filename: file.name,
            contentType: file.type,
            maxSizeMB: 15, // 15MB max per file
            type: 'avatar', // Specify this is an avatar upload
        }),
    });
    console.log('Presigned URL response status:', presignResponse.status);
    if (!presignResponse.ok) {
        const errorText = await presignResponse.text();
        console.error('Presigned URL error response:', errorText);
        throw new Error(`Failed to get presigned URL: ${presignResponse.status} ${presignResponse.statusText} - ${errorText}`);
    }
    const { url, fields, key, publicUrl } = await presignResponse.json();
    console.log('Received presigned URL data:', { url, key, publicUrl });
    // Create FormData for S3 upload
    const formData = new FormData();
    // Add all the fields from the presigned POST
    Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value);
    });
    // Add the file last (this is important for S3)
    formData.append('file', file);
    // Upload to S3
    console.log('Uploading to S3 URL:', url);
    console.log('FormData entries:');
    for (const [key, value] of formData.entries()) {
        console.log(`${key}:`, value);
    }
    const uploadResponse = await fetch(url, {
        method: 'POST',
        body: formData,
    });
    console.log('S3 upload response status:', uploadResponse.status);
    console.log('S3 upload response statusText:', uploadResponse.statusText);
    if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        console.error('S3 upload error response:', errorText);
        throw new Error(`Failed to upload to S3: ${uploadResponse.status} ${uploadResponse.statusText} - ${errorText}`);
    }
    return { s3Key: key, publicUrl };
}
/**
 * Get image dimensions from a File object using FileReader (more reliable)
 */
function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
        console.log('Getting dimensions for file:', {
            name: file.name,
            type: file.type,
            size: file.size,
            lastModified: file.lastModified
        });
        // Validate file type
        if (!file.type.startsWith('image/')) {
            console.error('File is not an image:', file.type);
            reject(new Error('File is not an image'));
            return;
        }
        const reader = new FileReader();
        const img = new Image();
        // Set a timeout to prevent hanging
        const timeout = setTimeout(() => {
            console.error('Image load timeout for:', file.name);
            reject(new Error('Image load timeout'));
        }, 10000); // 10 second timeout
        reader.onload = (e) => {
            const result = e.target?.result;
            if (typeof result === 'string') {
                console.log('FileReader loaded, creating image from data URL');
                img.src = result;
            }
            else {
                clearTimeout(timeout);
                reject(new Error('Failed to read file'));
            }
        };
        reader.onerror = () => {
            clearTimeout(timeout);
            console.error('FileReader error for:', file.name);
            reject(new Error(`Failed to read file: ${file.name}`));
        };
        img.onload = () => {
            console.log('Image loaded successfully:', {
                width: img.width,
                height: img.height,
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight
            });
            clearTimeout(timeout);
            resolve({ width: img.width, height: img.height });
        };
        img.onerror = (error) => {
            console.error('Image load error:', {
                error,
                file: file.name,
                type: file.type,
                size: file.size
            });
            clearTimeout(timeout);
            reject(new Error(`Failed to load image: ${file.name} (${file.type}, ${file.size} bytes)`));
        };
        // Read the file as data URL
        reader.readAsDataURL(file);
    });
}
/**
 * Upload multiple files to S3 and return photo metadata
 */
async function uploadFilesToS3(files) {
    console.log('Starting upload process for', files.length, 'files');
    const uploadPromises = files.map(async (file, index) => {
        console.log(`Processing file ${index + 1}/${files.length}:`, file.name);
        try {
            // Get image dimensions BEFORE uploading (File objects can become invalid after use)
            console.log('Getting dimensions for:', file.name);
            const { width, height } = await getImageDimensions(file);
            console.log('Got dimensions:', { width, height });
            // Upload file to S3
            console.log('Uploading to S3:', file.name);
            const { s3Key } = await uploadFileToS3(file);
            console.log('Upload complete:', s3Key);
            return { s3Key, width, height };
        }
        catch (error) {
            console.error(`Error processing file ${file.name}:`, error);
            throw error;
        }
    });
    return Promise.all(uploadPromises);
}

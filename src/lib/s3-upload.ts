/**
 * Upload a single file to S3 using presigned POST
 */
export async function uploadFileToS3(file: File): Promise<{ s3Key: string; publicUrl: string }> {
  // Get presigned POST data from our API
  const presignResponse = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      maxSizeMB: 10, // 10MB max per file
    }),
  });

  if (!presignResponse.ok) {
    throw new Error(`Failed to get presigned URL: ${presignResponse.statusText}`);
  }

  const { url, fields, key, publicUrl } = await presignResponse.json();

  // Create FormData for S3 upload
  const formData = new FormData();
  
  // Add all the fields from the presigned POST
  Object.entries(fields).forEach(([key, value]) => {
    formData.append(key, value as string);
  });
  
  // Add the file last (this is important for S3)
  formData.append('file', file);

  // Upload to S3
  const uploadResponse = await fetch(url, {
    method: 'POST',
    body: formData,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload to S3: ${uploadResponse.statusText}`);
  }

  return { s3Key: key, publicUrl };
}

/**
 * Get image dimensions from a File object using FileReader (more reliable)
 */
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
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
      } else {
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
export async function uploadFilesToS3(files: File[]): Promise<Array<{ s3Key: string; width: number; height: number }>> {
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
    } catch (error) {
      console.error(`Error processing file ${file.name}:`, error);
      throw error;
    }
  });

  return Promise.all(uploadPromises);
}

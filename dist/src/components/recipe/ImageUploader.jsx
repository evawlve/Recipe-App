"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageUploader = ImageUploader;
const react_1 = require("react");
const react_dropzone_1 = require("react-dropzone");
const card_1 = require("@/components/ui/card");
const button_1 = require("@/components/ui/button");
const lucide_react_1 = require("lucide-react");
const s3_upload_1 = require("@/lib/s3-upload");
const image_ops_1 = require("@/lib/image-ops");
function ImageUploader({ fileStates, onFileStatesChange, disabled = false, onUploadStart, onUploadComplete }) {
    const [isDragActive, setIsDragActive] = (0, react_1.useState)(false);
    const [previewUrls, setPreviewUrls] = (0, react_1.useState)(new Map());
    const MAX_FILES = 6;
    // Generate preview URLs for files
    (0, react_1.useEffect)(() => {
        const newPreviewUrls = new Map();
        fileStates.forEach(fileState => {
            if (fileState.status === "queued" || fileState.status === "error") {
                if (!previewUrls.has(fileState.file.name)) {
                    const url = URL.createObjectURL(fileState.file);
                    newPreviewUrls.set(fileState.file.name, url);
                }
            }
        });
        if (newPreviewUrls.size > 0) {
            setPreviewUrls(prev => new Map([...prev, ...newPreviewUrls]));
        }
    }, [fileStates]);
    // Cleanup preview URLs when component unmounts
    (0, react_1.useEffect)(() => {
        return () => {
            previewUrls.forEach(url => URL.revokeObjectURL(url));
        };
    }, [previewUrls]);
    const onDrop = (0, react_1.useCallback)(async (acceptedFiles) => {
        // Filter to only image files
        const imageFiles = acceptedFiles.filter(file => file.type.startsWith('image/'));
        // Enforce max files limit
        const remainingSlots = MAX_FILES - fileStates.length;
        const filesToAdd = imageFiles.slice(0, remainingSlots);
        if (filesToAdd.length < imageFiles.length) {
            console.warn(`Only ${filesToAdd.length} files added. Maximum ${MAX_FILES} files allowed.`);
        }
        // Create new file states with "queued" status
        const newFileStates = filesToAdd.map(file => ({
            file,
            status: "queued"
        }));
        const updatedFileStates = [...fileStates, ...newFileStates];
        onFileStatesChange(updatedFileStates);
        // Auto-upload the new files
        const newIndices = Array.from({ length: filesToAdd.length }, (_, i) => fileStates.length + i);
        for (const index of newIndices) {
            await uploadFile(updatedFileStates[index], index);
        }
    }, [fileStates, onFileStatesChange]);
    const { getRootProps, getInputProps, isDragReject } = (0, react_dropzone_1.useDropzone)({
        onDrop,
        onDragEnter: () => setIsDragActive(true),
        onDragLeave: () => setIsDragActive(false),
        accept: {
            'image/jpeg': ['.jpeg', '.jpg'],
            'image/png': ['.png'],
            'image/webp': ['.webp'],
            'image/heic': ['.heic', '.heif']
        },
        multiple: true,
        disabled: disabled || fileStates.length >= MAX_FILES
    });
    const removeFile = (index) => {
        const fileState = fileStates[index];
        // Cleanup preview URL if it exists
        if (previewUrls.has(fileState.file.name)) {
            URL.revokeObjectURL(previewUrls.get(fileState.file.name));
            setPreviewUrls(prev => {
                const newMap = new Map(prev);
                newMap.delete(fileState.file.name);
                return newMap;
            });
        }
        const newFileStates = fileStates.filter((_, i) => i !== index);
        onFileStatesChange(newFileStates);
    };
    const uploadFile = async (fileState, index) => {
        console.log(`Starting upload for ${fileState.file.name} at index ${index}`);
        // Update status to uploading
        const newStates = [...fileStates];
        newStates[index] = { ...fileState, status: "uploading" };
        onFileStatesChange(newStates);
        if (onUploadStart)
            onUploadStart();
        try {
            // Compress the image for recipe photos
            console.log('Compressing image for recipe photo...');
            const { blob, width, height, ext } = await (0, image_ops_1.compressImage)(fileState.file, {
                maxDim: 2048,
                quality: 0.82,
                type: "image/webp",
                squareCrop: false
            });
            // Create a new File object from the compressed blob
            const compressedFilename = (0, image_ops_1.generateCompressedFilename)(fileState.file.name, ext);
            const compressedFile = new File([blob], compressedFilename, {
                type: "image/webp",
                lastModified: Date.now()
            });
            console.log('Compression complete:', {
                originalSize: fileState.file.size,
                compressedSize: blob.size,
                dimensions: { width, height },
                filename: compressedFilename
            });
            // Upload compressed file to S3
            const { s3Key } = await (0, s3_upload_1.uploadFileToS3)(compressedFile);
            // Update status to done
            console.log(`Upload completed for ${fileState.file.name} with s3Key: ${s3Key}`);
            const newStates = [...fileStates];
            newStates[index] = {
                ...fileState,
                status: "done",
                s3Key,
                dims: { width, height }
            };
            onFileStatesChange(newStates);
        }
        catch (error) {
            console.error(`Upload failed for ${fileState.file.name}:`, error);
            // Update status to error
            const newStates = [...fileStates];
            newStates[index] = {
                ...fileState,
                status: "error",
                error: error instanceof Error ? error.message : "Upload failed"
            };
            onFileStatesChange(newStates);
        }
    };
    const retryUpload = (index) => {
        const fileState = fileStates[index];
        uploadFile(fileState, index);
    };
    const uploadAllQueued = async () => {
        // Get current file states to avoid stale closures
        const currentFileStates = [...fileStates];
        const queuedIndices = currentFileStates
            .map((fs, index) => ({ fs, index }))
            .filter(({ fs }) => fs.status === "queued" || fs.status === "error")
            .map(({ index }) => index);
        // Upload files sequentially to avoid race conditions
        for (const index of queuedIndices) {
            await uploadFile(currentFileStates[index], index);
        }
        if (onUploadComplete)
            onUploadComplete();
    };
    const formatFileSize = (bytes) => {
        if (bytes === 0)
            return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };
    const getStatusIcon = (status) => {
        switch (status) {
            case "uploading":
                return <lucide_react_1.Loader2 className="h-4 w-4 animate-spin text-blue-500"/>;
            case "done":
                return <lucide_react_1.CheckCircle className="h-4 w-4 text-green-500"/>;
            case "error":
                return <lucide_react_1.AlertCircle className="h-4 w-4 text-red-500"/>;
            default:
                return <lucide_react_1.Image className="h-4 w-4 text-muted-foreground"/>;
        }
    };
    const getPreviewUrl = (fileState) => {
        if (fileState.status === "done" && fileState.s3Key) {
            return `/api/image/${fileState.s3Key}`;
        }
        return previewUrls.get(fileState.file.name);
    };
    const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");
    const hasQueuedFiles = fileStates.some(fs => fs.status === "queued" || fs.status === "error");
    return (<card_1.Card>
      <card_1.CardHeader>
        <card_1.CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <lucide_react_1.Image className="h-5 w-5"/>
            Recipe Images
          </div>
          <div className="text-sm text-muted-foreground">
            {fileStates.length}/{MAX_FILES}
          </div>
        </card_1.CardTitle>
      </card_1.CardHeader>
      <card_1.CardContent className="space-y-4">
        {/* Dropzone */}
        <div {...getRootProps()} className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragActive && !isDragReject
            ? 'border-primary bg-primary/5'
            : isDragReject
                ? 'border-destructive bg-destructive/5'
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'}
            ${disabled || fileStates.length >= MAX_FILES ? 'opacity-50 cursor-not-allowed' : ''}
          `}>
          <input {...getInputProps()}/>
          <div className="flex flex-col items-center gap-2">
            <lucide_react_1.Upload className="h-8 w-8 text-muted-foreground"/>
            <div className="text-sm">
              {isDragActive ? (<p className="text-primary">Drop images here...</p>) : fileStates.length >= MAX_FILES ? (<p className="text-muted-foreground">Maximum {MAX_FILES} files reached</p>) : (<div>
                  <p className="text-muted-foreground">
                    Drag & drop images here, or <span className="text-primary underline">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Images will compress and upload automatically • Supports: JPEG, PNG, WebP, HEIC (Max {MAX_FILES} files)
                  </p>
                </div>)}
            </div>
          </div>
        </div>

        {/* Auto-upload info */}
        {hasUploadingFiles && (<div className="flex justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <lucide_react_1.Loader2 className="h-4 w-4 animate-spin"/>
              Auto-uploading images...
            </div>
          </div>)}

        {/* File Preview List */}
        {fileStates.length > 0 && (<div className="space-y-2">
            <h4 className="text-sm font-medium text-text">
              Selected Images ({fileStates.length})
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {fileStates.map((fileState, index) => {
                const previewUrl = getPreviewUrl(fileState);
                return (<div key={`${fileState.file.name}-${index}`} className="flex items-center gap-3 p-3 bg-muted rounded-md">
                    {/* Preview Image */}
                    <div className="w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted-foreground/10">
                      {previewUrl ? (<img src={previewUrl} alt={fileState.file.name} className="w-full h-full object-cover"/>) : (<div className="w-full h-full flex items-center justify-center">
                          <lucide_react_1.Image className="h-8 w-8 text-muted-foreground"/>
                        </div>)}
                    </div>

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">{fileState.file.name}</p>
                        {getStatusIcon(fileState.status)}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(fileState.file.size)}
                        {fileState.dims && ` • ${fileState.dims.width}×${fileState.dims.height}`}
                      </p>
                      {fileState.error && (<p className="text-xs text-destructive mt-1">{fileState.error}</p>)}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {fileState.status === "error" && (<button_1.Button type="button" variant="ghost" size="sm" onClick={() => retryUpload(index)} disabled={hasUploadingFiles} className="h-8 px-2">
                          <lucide_react_1.RotateCcw className="h-3 w-3 mr-1"/>
                          Retry
                        </button_1.Button>)}
                      <button_1.Button type="button" variant="ghost" size="sm" onClick={() => removeFile(index)} disabled={fileState.status === "uploading"} className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground">
                        <lucide_react_1.X className="h-3 w-3"/>
                      </button_1.Button>
                    </div>
                  </div>);
            })}
            </div>
          </div>)}
      </card_1.CardContent>
    </card_1.Card>);
}

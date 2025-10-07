"use client";

import { useCallback, useState, useEffect } from "react";
import { useDropzone } from "react-dropzone";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X, Upload, Image as ImageIcon, RotateCcw, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { FileState, FileStatus } from "@/types/file-state";
import { uploadFileToS3, getImageDimensions } from "@/lib/s3-upload";

interface ImageUploaderProps {
  fileStates: FileState[];
  onFileStatesChange: (fileStates: FileState[]) => void;
  disabled?: boolean;
  onUploadStart?: () => void;
  onUploadComplete?: () => void;
}

export function ImageUploader({ 
  fileStates, 
  onFileStatesChange, 
  disabled = false, 
  onUploadStart,
  onUploadComplete 
}: ImageUploaderProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());

  const MAX_FILES = 6;

  // Generate preview URLs for files
  useEffect(() => {
    const newPreviewUrls = new Map<string, string>();
    
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
  useEffect(() => {
    return () => {
      previewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    // Filter to only image files
    const imageFiles = acceptedFiles.filter(file => 
      file.type.startsWith('image/')
    );
    
    // Enforce max files limit
    const remainingSlots = MAX_FILES - fileStates.length;
    const filesToAdd = imageFiles.slice(0, remainingSlots);
    
    if (filesToAdd.length < imageFiles.length) {
      console.warn(`Only ${filesToAdd.length} files added. Maximum ${MAX_FILES} files allowed.`);
    }
    
    // Create new file states with "queued" status
    const newFileStates: FileState[] = filesToAdd.map(file => ({
      file,
      status: "queued" as FileStatus
    }));
    
    const updatedFileStates = [...fileStates, ...newFileStates];
    onFileStatesChange(updatedFileStates);
    
    // Auto-upload the new files
    const newIndices = Array.from({ length: filesToAdd.length }, (_, i) => fileStates.length + i);
    for (const index of newIndices) {
      await uploadFile(updatedFileStates[index], index);
    }
  }, [fileStates, onFileStatesChange]);

  const { getRootProps, getInputProps, isDragReject } = useDropzone({
    onDrop,
    onDragEnter: () => setIsDragActive(true),
    onDragLeave: () => setIsDragActive(false),
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.gif', '.webp']
    },
    multiple: true,
    disabled: disabled || fileStates.length >= MAX_FILES
  });

  const removeFile = (index: number) => {
    const fileState = fileStates[index];
    // Cleanup preview URL if it exists
    if (previewUrls.has(fileState.file.name)) {
      URL.revokeObjectURL(previewUrls.get(fileState.file.name)!);
      setPreviewUrls(prev => {
        const newMap = new Map(prev);
        newMap.delete(fileState.file.name);
        return newMap;
      });
    }
    
    const newFileStates = fileStates.filter((_, i) => i !== index);
    onFileStatesChange(newFileStates);
  };

  const uploadFile = async (fileState: FileState, index: number) => {
    console.log(`Starting upload for ${fileState.file.name} at index ${index}`);
    
    // Update status to uploading
    const newStates = [...fileStates];
    newStates[index] = { ...fileState, status: "uploading" };
    onFileStatesChange(newStates);
    
    if (onUploadStart) onUploadStart();

    try {
      // Get image dimensions
      const dims = await getImageDimensions(fileState.file);
      
      // Upload to S3
      const { s3Key } = await uploadFileToS3(fileState.file);
      
      // Update status to done
      console.log(`Upload completed for ${fileState.file.name} with s3Key: ${s3Key}`);
      const newStates = [...fileStates];
      newStates[index] = { 
        ...fileState, 
        status: "done", 
        s3Key, 
        dims 
      };
      onFileStatesChange(newStates);
      
    } catch (error) {
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

  const retryUpload = (index: number) => {
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
    
    if (onUploadComplete) onUploadComplete();
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getStatusIcon = (status: FileStatus) => {
    switch (status) {
      case "uploading":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "done":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <ImageIcon className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getPreviewUrl = (fileState: FileState) => {
    if (fileState.status === "done" && fileState.s3Key) {
      return `/api/image/${fileState.s3Key}`;
    }
    return previewUrls.get(fileState.file.name);
  };

  const hasUploadingFiles = fileStates.some(fs => fs.status === "uploading");
  const hasQueuedFiles = fileStates.some(fs => fs.status === "queued" || fs.status === "error");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5" />
            Recipe Images
          </div>
          <div className="text-sm text-muted-foreground">
            {fileStates.length}/{MAX_FILES}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors
            ${isDragActive && !isDragReject 
              ? 'border-primary bg-primary/5' 
              : isDragReject 
                ? 'border-destructive bg-destructive/5' 
                : 'border-muted-foreground/25 hover:border-muted-foreground/50'
            }
            ${disabled || fileStates.length >= MAX_FILES ? 'opacity-50 cursor-not-allowed' : ''}
          `}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2">
            <Upload className="h-8 w-8 text-muted-foreground" />
            <div className="text-sm">
              {isDragActive ? (
                <p className="text-primary">Drop images here...</p>
              ) : fileStates.length >= MAX_FILES ? (
                <p className="text-muted-foreground">Maximum {MAX_FILES} files reached</p>
              ) : (
                <div>
                  <p className="text-muted-foreground">
                    Drag & drop images here, or <span className="text-primary underline">browse</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Images will upload automatically • Supports: JPEG, PNG, GIF, WebP (Max {MAX_FILES} files)
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Auto-upload info */}
        {hasUploadingFiles && (
          <div className="flex justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Auto-uploading images...
            </div>
          </div>
        )}

        {/* File Preview List */}
        {fileStates.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium text-text">
              Selected Images ({fileStates.length})
            </h4>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {fileStates.map((fileState, index) => {
                const previewUrl = getPreviewUrl(fileState);
                return (
                  <div
                    key={`${fileState.file.name}-${index}`}
                    className="flex items-center gap-3 p-3 bg-muted rounded-md"
                  >
                    {/* Preview Image */}
                    <div className="w-20 h-20 flex-shrink-0 rounded-md overflow-hidden bg-muted-foreground/10">
                      {previewUrl ? (
                        <img
                          src={previewUrl}
                          alt={fileState.file.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="h-8 w-8 text-muted-foreground" />
                        </div>
                      )}
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
                      {fileState.error && (
                        <p className="text-xs text-destructive mt-1">{fileState.error}</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1">
                      {fileState.status === "error" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => retryUpload(index)}
                          disabled={hasUploadingFiles}
                          className="h-8 px-2"
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeFile(index)}
                        disabled={fileState.status === "uploading"}
                        className="h-8 w-8 p-0 hover:bg-destructive hover:text-destructive-foreground"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

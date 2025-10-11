"use client";

import { useState, useRef } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadFileToS3 } from "@/lib/s3-upload";
import Image from "next/image";

interface SimpleAvatarUploaderProps {
  onImageChange: (url: string | null) => void;
  currentImage?: string | null;
  className?: string;
  uploadPath?: string;
  maxSize?: number;
  acceptedTypes?: string[];
  initials?: string;
}

export function SimpleAvatarUploader({
  onImageChange,
  currentImage,
  className = "",
  uploadPath = "avatars",
  maxSize = 5 * 1024 * 1024, // 5MB
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  initials = "U"
}: SimpleAvatarUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      // Validate file size
      if (file.size > maxSize) {
        alert(`File size must be less than ${Math.round(maxSize / 1024 / 1024)}MB`);
        return;
      }

      // Validate file type
      if (!acceptedTypes.includes(file.type)) {
        alert(`File type must be one of: ${acceptedTypes.join(', ')}`);
        return;
      }

      setSelectedFile(file);
      setShowPreviewModal(true);
    }
  };

  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    
    try {
      const { s3Key, publicUrl } = await uploadFileToS3(file);
      console.log("S3 upload successful, s3Key:", s3Key, "publicUrl:", publicUrl);
      
      onImageChange(publicUrl);
      setShowPreviewModal(false);
    } catch (error) {
      console.error("Avatar upload error:", error);
      alert("Failed to upload avatar. Please try again.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirmUpload = async () => {
    if (selectedFile) {
      await handleAvatarUpload(selectedFile);
    }
  };

  const handleRemoveImage = () => {
    onImageChange(null);
  };

  return (
    <div className={`flex flex-col items-center space-y-4 ${className}`}>
      {/* Avatar Display */}
      <div className="relative group">
        <div className="rounded-full size-24 bg-muted text-2xl font-semibold grid place-items-center overflow-hidden">
          {currentImage ? (
            <Image
              src={currentImage}
              alt="Profile avatar"
              width={96}
              height={96}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-green-100 flex items-center justify-center text-2xl font-bold text-green-600">
              {initials}
            </div>
          )}
        </div>
        
        {/* Hover overlay for upload */}
        <div 
          className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
          onClick={() => fileInputRef.current?.click()}
        >
          <Camera className="w-6 h-6 text-white" />
        </div>
        
        {/* Loading overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
            <Loader2 className="w-6 h-6 text-white animate-spin" />
          </div>
        )}
      </div>

      {/* File input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedTypes.join(',')}
        onChange={handleFileSelect}
        className="hidden"
      />

      {/* Action buttons */}
      <div className="flex space-x-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
        >
          {currentImage ? "Change" : "Upload"} Avatar
        </Button>
        {currentImage && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleRemoveImage}
            disabled={isUploading}
          >
            Remove
          </Button>
        )}
      </div>

      {/* Preview Modal */}
      {showPreviewModal && selectedFile && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-4">Preview Avatar</h3>
            
            <div className="flex justify-center mb-4">
              <div className="rounded-full size-32 overflow-hidden">
                <Image
                  src={URL.createObjectURL(selectedFile)}
                  alt="Preview"
                  width={128}
                  height={128}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
            
            <div className="flex space-x-2">
              <Button
                onClick={() => setShowPreviewModal(false)}
                variant="outline"
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmUpload}
                disabled={isUploading}
                className="flex-1"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

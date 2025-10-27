"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Camera, Upload, X } from "lucide-react";
import { AvatarPreviewModal } from "./AvatarPreviewModal";
import { cn } from "@/lib/utils";
import { uploadFileToS3 } from "@/lib/s3-upload";
import Image from "next/image";

interface AvatarEditorProps {
  onImageChange: (url: string | null) => void;
  currentImage?: string | null;
  className?: string;
  uploadPath?: string;
  maxSize?: number;
  acceptedTypes?: string[];
  initials?: string;
  disabled?: boolean;
  isGoogleAvatar?: boolean;
}

export function AvatarEditor({
  onImageChange,
  currentImage,
  className = "",
  uploadPath = "avatars",
  maxSize = 5 * 1024 * 1024, // 5MB
  acceptedTypes = ['image/jpeg', 'image/png', 'image/webp'],
  initials = "U",
  disabled = false,
  isGoogleAvatar = false
}: AvatarEditorProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (file: File) => {
    // Validate file type
    if (!acceptedTypes.includes(file.type)) {
      alert(`Please select a valid image file. Accepted types: ${acceptedTypes.join(', ')}`);
      return;
    }

    // Validate file size
    if (file.size > maxSize) {
      alert(`File size must be less than ${Math.round(maxSize / (1024 * 1024))}MB`);
      return;
    }

    setSelectedFile(file);
    setShowPreviewModal(true);
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleConfirmUpload = async (file: File) => {
    setIsUploading(true);
    
    try {
      // Use the uploadFileToS3 function which handles the correct API calls
      const { publicUrl } = await uploadFileToS3(file);
      
      onImageChange(publicUrl);
      setShowPreviewModal(false);
      setSelectedFile(null);
    } catch (error) {
      console.error('Upload error:', error);
      alert('Failed to upload image. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemoveImage = () => {
    onImageChange(null);
    setSelectedFile(null);
  };

  const handleClosePreview = () => {
    setShowPreviewModal(false);
    setSelectedFile(null);
  };

  return (
    <div className={cn("space-y-4", className)}>
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="flex flex-col items-center space-y-4">
            {/* Avatar Display */}
            <div className="relative">
              {currentImage ? (
                <div className="relative">
                  <div className="w-24 h-24 rounded-full overflow-hidden border-2 border-border">
                    <Image
                      src={currentImage}
                      alt="Profile avatar"
                      width={96}
                      height={96}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    className="absolute -top-2 -right-2 h-6 w-6 rounded-full p-0"
                    onClick={handleRemoveImage}
                    disabled={disabled}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center border-2 border-border">
                  <span className="text-2xl font-semibold text-muted-foreground">
                    {initials}
                  </span>
                </div>
              )}
            </div>

            {/* Upload Button */}
            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={disabled}
              className="flex items-center space-x-2"
            >
              <Camera className="h-4 w-4" />
              <span>{currentImage ? "Change Avatar" : "Upload Avatar"}</span>
            </Button>

            {/* Google Avatar Message */}
            {isGoogleAvatar && currentImage && (
              <p className="text-xs text-muted-foreground text-center">
                Using your Google profile picture. Click "Change Avatar" to upload a custom image.
              </p>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept={acceptedTypes.join(',')}
              onChange={handleFileInputChange}
              className="hidden"
            />
          </div>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      {showPreviewModal && selectedFile && (
        <AvatarPreviewModal
          isOpen={showPreviewModal}
          onClose={handleClosePreview}
          onConfirm={handleConfirmUpload}
          file={selectedFile}
          isUploading={isUploading}
        />
      )}
    </div>
  );
}

"use client";

import { useState, useRef } from "react";
import { Card } from "@/components/ui/card";
import { uploadFileToS3 } from "@/lib/s3-upload";
import { Camera } from "lucide-react";
import { AvatarPreviewModal } from "./AvatarPreviewModal";

interface ProfileHeaderProps {
  name?: string | null;
  email: string;
  username?: string | null;
  bio?: string | null;
  uploadedCount: number;
  savedCount: number;
  followersCount?: number;
  followingCount?: number;
  avatarUrl?: string | null;
  onAvatarUpdate?: (newAvatarUrl: string) => void;
}

export default function ProfileHeader({ 
  name, 
  email, 
  username,
  bio,
  uploadedCount, 
  savedCount,
  followersCount,
  followingCount,
  avatarUrl,
  onAvatarUpdate
}: ProfileHeaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const initials = name 
    ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : email[0].toUpperCase();


  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploading(true);
    
    try {
      const { s3Key, publicUrl } = await uploadFileToS3(file);
      console.log("S3 upload successful, s3Key:", s3Key, "proxyUrl:", publicUrl);
      
      // Save to database
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          avatarKey: s3Key,
          avatarUrl: publicUrl 
        }),
      });
      
      if (response.ok) {
        console.log("Database save successful, updating UI with URL:", publicUrl);
        // Update the avatar immediately in the UI
        onAvatarUpdate?.(publicUrl);
      } else {
        const errorData = await response.json();
        console.error("Failed to save avatar to database:", errorData);
      }
    } catch (error) {
      console.error("Avatar upload error:", error);
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setShowPreviewModal(true);
    }
  };

  const handleConfirmUpload = async (file: File) => {
    setShowPreviewModal(false);
    await handleAvatarUpload(file);
  };

  return (
    <Card className="rounded-2xl border border-border bg-card shadow-sm p-8">
      <div className="flex flex-col items-center text-center space-y-4">
        {/* Avatar */}
        <div className="relative group">
          <div className="rounded-full size-32 bg-muted text-2xl font-semibold grid place-items-center overflow-hidden">
            {avatarUrl ? (
              <>
                {console.log("ProfileHeader rendering avatar with URL:", avatarUrl)}
                <img 
                  src={avatarUrl} 
                  alt="Profile" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error("Image failed to load:", avatarUrl, e);
                    console.log("🔍 Try opening this URL directly in a new tab:", avatarUrl);
                    console.log("💡 If it doesn't work, check S3 bucket public access settings");
                  }}
                  onLoad={() => console.log("✅ Image loaded successfully:", avatarUrl)}
                />
              </>
            ) : (
              initials
            )}
          </div>
          {/* Hover overlay for avatar upload */}
          <div 
            className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Camera className="w-6 h-6 text-white" />
          </div>
          {isUploading && (
            <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
            </div>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />

        {/* Avatar Preview Modal */}
        <AvatarPreviewModal
          isOpen={showPreviewModal}
          onClose={() => setShowPreviewModal(false)}
          onConfirm={handleConfirmUpload}
          file={selectedFile}
          isUploading={isUploading}
        />
        
        {/* Name, Username and Bio */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">
            {name || "User"}
          </h1>
          {username && (
            <p className="text-muted-foreground">@{username}</p>
          )}
          {bio && (
            <p className="text-muted-foreground text-sm max-w-md">{bio}</p>
          )}
        </div>
        
        
        {/* Stats */}
        <div className="flex gap-6 pt-4">
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{uploadedCount}</div>
            <div className="text-sm text-muted-foreground">Uploaded</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-foreground">{savedCount}</div>
            <div className="text-sm text-muted-foreground">Saved</div>
          </div>
          {followersCount !== undefined && (
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{followersCount}</div>
              <div className="text-sm text-muted-foreground">Followers</div>
            </div>
          )}
          {followingCount !== undefined && (
            <div className="text-center">
              <div className="text-2xl font-bold text-foreground">{followingCount}</div>
              <div className="text-sm text-muted-foreground">Following</div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

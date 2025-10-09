"use client";

import { useState, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { uploadFileToS3 } from "@/lib/s3-upload";
import { Camera, X } from "lucide-react";
import { AvatarPreviewModal } from "./AvatarPreviewModal";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

interface SettingsPanelProps {
  name?: string | null;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  avatarUrl?: string | null;
  avatarKey?: string | null;
  onAvatarUpdate?: (newAvatarUrl: string) => void;
}

export default function SettingsPanel({ 
  name, 
  email, 
  firstName: initialFirstName, 
  lastName: initialLastName, 
  avatarUrl: initialAvatarUrl,
  avatarKey: initialAvatarKey,
  onAvatarUpdate
}: SettingsPanelProps) {
  // Form state
  const [firstName, setFirstName] = useState(initialFirstName || "");
  const [lastName, setLastName] = useState(initialLastName || "");
  const [displayName, setDisplayName] = useState(name || "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  
  // UI state
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [mounted, setMounted] = useState(false);
  
  const { theme, setTheme, systemTheme } = useTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prevent hydration mismatch by only rendering theme-dependent content after mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Check if any field has changed (only when in edit mode)
  useEffect(() => {
    if (!isEditMode) {
      setIsDirty(false);
      return;
    }
    
    const hasChanges = 
      firstName !== (initialFirstName || "") ||
      lastName !== (initialLastName || "") ||
      displayName !== (name || "") ||
      avatarUrl !== (initialAvatarUrl || "");
    setIsDirty(hasChanges);
  }, [firstName, lastName, displayName, avatarUrl, initialFirstName, initialLastName, name, initialAvatarUrl, isEditMode]);


  const handleAvatarUpload = async (file: File) => {
    if (!file) return;
    
    setIsUploadingAvatar(true);
    setMessage(null);
    
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
        setAvatarUrl(publicUrl);
        onAvatarUpdate?.(publicUrl); // Update parent component immediately
        setMessage({ type: "success", text: "Avatar uploaded successfully!" });
      } else {
        const errorData = await response.json();
        console.error("Failed to save avatar to database:", errorData);
        setMessage({ type: "error", text: `Failed to save avatar: ${errorData.error || "Unknown error"}` });
      }
    } catch (error) {
      console.error("Avatar upload error:", error);
      setMessage({ type: "error", text: "Failed to upload avatar. Please try again." });
    } finally {
      setIsUploadingAvatar(false);
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

  const handleEditToggle = () => {
    if (isEditMode) {
      // Cancel edit mode - reset to original values
      setFirstName(initialFirstName || "");
      setLastName(initialLastName || "");
      setDisplayName(name || "");
      setAvatarUrl(initialAvatarUrl || "");
      setMessage(null);
    }
    setIsEditMode(!isEditMode);
  };

  const handleSignOut = async () => {
    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      // Force redirect to sign in page
      window.location.href = '/signin';
    } catch (error) {
      console.error('Error signing out:', error);
      // Still redirect even if there's an error
      window.location.href = '/signin';
    }
  };

  const handleSaveChanges = async () => {
    if (!isDirty) return;
    
    setIsLoading(true);
    setMessage(null);
    
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          name: displayName || undefined,
          avatarUrl: avatarUrl || undefined,
        }),
      });
      
      if (response.ok) {
        setMessage({ type: "success", text: "Profile updated successfully!" });
        setIsDirty(false);
        // Update the initial values to reflect the changes
        // This will be handled by the parent component refreshing
      } else {
        const error = await response.json();
        setMessage({ type: "error", text: error.error || "Failed to update profile" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const themeOptions = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  return (
    <div className="space-y-6">
      {/* Profile Settings */}
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Enter your first name"
                className="rounded-xl"
                disabled={!isEditMode}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Enter your last name"
                className="rounded-xl"
                disabled={!isEditMode}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Enter your display name"
              className="rounded-xl"
              disabled={!isEditMode}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              value={email}
              disabled
              className="rounded-xl bg-muted"
            />
            <p className="text-sm text-muted-foreground">
              Email cannot be changed. Contact support if needed.
            </p>
          </div>
          
          {message && (
            <div className={cn(
              "p-3 rounded-xl text-sm",
              message.type === "success" 
                ? "bg-green-50 text-green-700 border border-green-200" 
                : "bg-red-50 text-red-700 border border-red-200"
            )}>
              {message.text}
            </div>
          )}
          
          <div className="flex gap-3">
            {!isEditMode ? (
              <Button 
                onClick={handleEditToggle}
                className="rounded-xl"
              >
                Edit Profile
              </Button>
            ) : (
              <>
                <Button 
                  onClick={handleEditToggle}
                  variant="outline"
                  className="rounded-xl"
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSaveChanges}
                  disabled={!isDirty || isLoading || isUploadingAvatar}
                  className="rounded-xl"
                >
                  {isLoading ? "Saving..." : "Save Changes"}
                </Button>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Appearance Settings */}
      <Card className="rounded-2xl border border-border bg-card shadow-sm">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Theme</Label>
              <div className="flex gap-2">
                {themeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={mounted && theme === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTheme(option.value)}
                    className="rounded-xl"
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {mounted && (
                <p className="text-sm text-muted-foreground">
                  Current: {theme === "system" ? `System (${systemTheme})` : theme}
                </p>
              )}
            </div>
          </div>
          </CardContent>
        </Card>

        {/* Account Actions */}
        <Card className="rounded-2xl border border-border bg-card shadow-sm">
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              variant="destructive" 
              onClick={handleSignOut}
              className="w-full rounded-xl"
            >
              Sign Out
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

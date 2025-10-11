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
  username?: string | null;
  bio?: string | null;
  avatarUrl?: string | null;
  avatarKey?: string | null;
  onAvatarUpdate?: (newAvatarUrl: string) => void;
  onProfileUpdate?: (updatedUser: Partial<{
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    bio: string | null;
  }>) => void;
}

export default function SettingsPanel({ 
  name, 
  email, 
  firstName: initialFirstName, 
  lastName: initialLastName,
  username: initialUsername,
  bio: initialBio,
  avatarUrl: initialAvatarUrl,
  avatarKey: initialAvatarKey,
  onAvatarUpdate,
  onProfileUpdate
}: SettingsPanelProps) {
  // Form state
  const [firstName, setFirstName] = useState(initialFirstName || "");
  const [lastName, setLastName] = useState(initialLastName || "");
  const [username, setUsername] = useState(initialUsername || "");
  const [bio, setBio] = useState(initialBio || "");
  const [avatarUrl, setAvatarUrl] = useState(initialAvatarUrl || "");
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  
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
      username !== (initialUsername || "") ||
      bio !== (initialBio || "") ||
      avatarUrl !== (initialAvatarUrl || "");
    setIsDirty(hasChanges);
  }, [firstName, lastName, username, bio, avatarUrl, initialFirstName, initialLastName, initialUsername, initialBio, initialAvatarUrl, isEditMode]);

  // Username validation
  const validateUsername = async (value: string) => {
    if (!value.trim()) {
      setUsernameError(null);
      return;
    }

    // Basic regex validation
    if (!/^[a-z0-9_]+$/.test(value)) {
      setUsernameError('Username can only contain lowercase letters, numbers, and underscores');
      return;
    }

    if (value.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (value.length > 20) {
      setUsernameError('Username must be at most 20 characters');
      return;
    }

    // Check uniqueness
    setIsCheckingUsername(true);
    try {
      const response = await fetch(`/api/users/search?exact=${encodeURIComponent(value)}`);
      if (response.ok) {
        const users = await response.json();
        if (users.length > 0 && users[0].username !== initialUsername) {
          setUsernameError('Username is already taken');
        } else {
          setUsernameError(null);
        }
      }
    } catch (error) {
      console.error('Error checking username:', error);
    } finally {
      setIsCheckingUsername(false);
    }
  };

  const handleUsernameChange = (value: string) => {
    setUsername(value.toLowerCase());
    setUsernameError(null);
    
    // Debounce validation
    const timeoutId = setTimeout(() => {
      validateUsername(value.toLowerCase());
    }, 500);
    
    return () => clearTimeout(timeoutId);
  };

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
      setUsername(initialUsername || "");
      setBio(initialBio || "");
      setAvatarUrl(initialAvatarUrl || "");
      setUsernameError(null);
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

  const handleDeleteAccount = async () => {
    if (!confirm('Are you sure you want to delete your account? This action cannot be undone and will permanently delete all your recipes, comments, and other data.')) {
      return;
    }

    if (!confirm('This will permanently delete your account and ALL associated data. Are you absolutely sure?')) {
      return;
    }

    setIsLoading(true);
    setMessage(null);

    try {
      const response = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (response.ok) {
        // Account deleted successfully, force sign out and redirect
        try {
          const supabase = createSupabaseBrowserClient();
          await supabase.auth.signOut();
        } catch (signOutError) {
          console.error('Error signing out after account deletion:', signOutError);
          // Continue with redirect even if sign out fails
        }
        
        // Force redirect to home page
        window.location.href = '/?message=' + encodeURIComponent('Your account has been deleted successfully.');
      } else {
        const errorData = await response.json();
        setMessage({ type: "error", text: errorData.error || "Failed to delete account" });
      }
    } catch (error) {
      setMessage({ type: "error", text: "Network error. Please try again." });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!isDirty || usernameError) return;
    
    setIsLoading(true);
    setMessage(null);
    
    try {
      // Save all profile fields including username in one request
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          name: `${firstName} ${lastName}`.trim() || undefined,
          username: username || undefined,
          bio: bio || undefined,
          avatarUrl: avatarUrl || undefined,
        }),
      });
      
      if (response.ok) {
        setMessage({ type: "success", text: "Profile updated successfully!" });
        setIsDirty(false);
        
        // Update the parent component with the new values
        onProfileUpdate?.({
          name: `${firstName} ${lastName}`.trim() || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          username: username || undefined,
          bio: bio || undefined,
        });
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
            <Label htmlFor="username">Username</Label>
            <div className="relative">
              <Input
                id="username"
                value={username}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="Enter your username"
                className="rounded-xl"
                disabled={!isEditMode}
              />
              {isCheckingUsername && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full"></div>
                </div>
              )}
            </div>
            {usernameError && (
              <p className="text-sm text-red-600">{usernameError}</p>
            )}
            {username && !usernameError && (
              <p className="text-sm text-green-600">@{username}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio">Bio</Label>
            <Input
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell us about yourself"
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
                  disabled={!isDirty || isLoading || isUploadingAvatar || !!usernameError || isCheckingUsername}
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
          <CardContent className="space-y-3">
            <Button 
              variant="outline" 
              onClick={handleSignOut}
              className="w-full rounded-xl bg-muted hover:bg-muted/80 border-green-500 text-foreground"
            >
              Sign Out
            </Button>
            <Button 
              variant="destructive" 
              className="w-full rounded-xl"
              onClick={handleDeleteAccount}
              disabled={isLoading}
            >
              {isLoading ? "Deleting..." : "Delete Account"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

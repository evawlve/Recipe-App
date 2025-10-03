"use client";

import { useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { imageSrcForKey } from "@/lib/images";

interface Photo {
  id: string;
  s3Key: string;
  width: number;
  height: number;
}

interface PhotoGalleryProps {
  photos: Photo[];
  recipeTitle: string;
}

export function PhotoGallery({ photos: initialPhotos, recipeTitle }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  const handleRemovePhoto = async (photoId: string) => {
    // Optimistic UI update
    setRemovingIds(prev => new Set(prev).add(photoId));
    setPhotos(prev => prev.filter(photo => photo.id !== photoId));

    try {
      const response = await fetch(`/api/photos/${photoId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        // Revert optimistic update on error
        setPhotos(initialPhotos);
        console.error("Failed to delete photo:", response.statusText);
        // You might want to show a toast notification here
      }
    } catch (error) {
      // Revert optimistic update on error
      setPhotos(initialPhotos);
      console.error("Error deleting photo:", error);
      // You might want to show a toast notification here
    } finally {
      setRemovingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(photoId);
        return newSet;
      });
    }
  };

  if (photos.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {photos.map((photo, index) => (
        <div key={photo.id} className="relative w-full h-64 overflow-hidden rounded-lg border border-border bg-secondary group" style={{ position: 'relative' }}>
          <Image
            src={imageSrcForKey(photo.s3Key)}
            alt={recipeTitle}
            width={400}
            height={256}
            priority={index === 0}
            loading={index === 0 ? "eager" : "lazy"}
            className="object-cover w-full h-full"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            quality={75}
          />
          
          {/* Remove button overlay */}
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleRemovePhoto(photo.id)}
              disabled={removingIds.has(photo.id)}
              className="h-8 w-8 p-0"
            >
              {removingIds.has(photo.id) ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                "×"
              )}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}


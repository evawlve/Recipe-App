"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { imageSrcForKey } from "@/lib/images";

interface Photo {
  id: string;
  s3Key: string;
  width: number;
  height: number;
  isMainPhoto?: boolean;
}

interface PhotoGalleryProps {
  photos: Photo[];
  recipeTitle: string;
  canDelete?: boolean;
}

export function PhotoGallery({ photos: initialPhotos, recipeTitle, canDelete = false }: PhotoGalleryProps) {
  const [photos, setPhotos] = useState(initialPhotos);
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());
  const [settingMainIds, setSettingMainIds] = useState<Set<string>>(new Set());
  const [currentIndex, setCurrentIndex] = useState(0);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const photoRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Update scroll buttons visibility
  useEffect(() => {
    const checkScrollability = () => {
      const container = scrollContainerRef.current;
      if (!container) return;

      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 1
      );
    };

    checkScrollability();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScrollability);
      // Check on resize
      window.addEventListener("resize", checkScrollability);
      return () => {
        container.removeEventListener("scroll", checkScrollability);
        window.removeEventListener("resize", checkScrollability);
      };
    }
  }, [photos]);

  // Update current index based on scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollLeft = container.scrollLeft;
      const containerWidth = container.clientWidth;
      const scrollPosition = scrollLeft + containerWidth / 2;

      // Find which photo is in the center
      let newIndex = 0;
      for (let i = 0; i < photoRefs.current.length; i++) {
        const photo = photoRefs.current[i];
        if (photo) {
          const photoLeft = photo.offsetLeft;
          const photoWidth = photo.offsetWidth;
          if (scrollPosition >= photoLeft && scrollPosition < photoLeft + photoWidth) {
            newIndex = i;
            break;
          }
        }
      }
      setCurrentIndex(newIndex);
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [photos]);

  const scrollToPhoto = (index: number) => {
    const photo = photoRefs.current[index];
    const container = scrollContainerRef.current;
    if (photo && container) {
      const containerWidth = container.clientWidth;
      const photoLeft = photo.offsetLeft;
      const photoWidth = photo.offsetWidth;
      const scrollTo = photoLeft - (containerWidth - photoWidth) / 2;
      
      container.scrollTo({
        left: scrollTo,
        behavior: "smooth",
      });
      setCurrentIndex(index);
    }
  };

  const scroll = (direction: "left" | "right") => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollAmount = container.clientWidth * 0.8;
    const newScrollLeft =
      direction === "left"
        ? container.scrollLeft - scrollAmount
        : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: newScrollLeft,
      behavior: "smooth",
    });
  };

  const handleSetMainPhoto = async (photoId: string) => {
    // Optimistic UI update
    setSettingMainIds(prev => new Set(prev).add(photoId));
    setPhotos(prev => prev.map(photo => ({
      ...photo,
      isMainPhoto: photo.id === photoId
    })));

    try {
      const response = await fetch(`/api/photos/${photoId}`, {
        method: "PATCH",
      });

      if (!response.ok) {
        // Revert optimistic update on error
        setPhotos(initialPhotos);
        console.error("Failed to set main photo:", response.statusText);
      }
    } catch (error) {
      // Revert optimistic update on error
      setPhotos(initialPhotos);
      console.error("Error setting main photo:", error);
    } finally {
      setSettingMainIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(photoId);
        return newSet;
      });
    }
  };

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

  const showNavigation = photos.length > 1;

  return (
    <div className="relative">
      {/* Scrollable container */}
      <div
        ref={scrollContainerRef}
        className="flex gap-4 overflow-x-auto overflow-y-hidden no-scrollbar snap-x snap-mandatory pb-4"
      >
        {photos.map((photo, index) => (
          <div
            key={photo.id}
            ref={(el) => { photoRefs.current[index] = el; }}
            className="relative flex-shrink-0 w-full md:max-w-md h-64 overflow-hidden rounded-lg border border-border bg-secondary group snap-start"
            style={{ position: "relative" }}
          >
            <Image
              src={imageSrcForKey(photo.s3Key)}
              alt={`${recipeTitle} - Photo ${index + 1}`}
              width={400}
              height={256}
              priority={index === 0}
              loading={index === 0 ? "eager" : "lazy"}
              className="object-cover w-full h-full"
              sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
              quality={75}
            />

            {/* Main photo indicator */}
            {photo.isMainPhoto && (
              <div className="absolute top-2 left-2 bg-primary text-primary-foreground px-2 py-1 rounded-md text-xs font-semibold z-10 shadow-lg flex items-center gap-1">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-3 w-3"
                >
                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                </svg>
                Main Photo
              </div>
            )}

            {/* Action buttons overlay */}
            {canDelete && (
              <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10 flex gap-2">
                {!photo.isMainPhoto && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSetMainPhoto(photo.id);
                    }}
                    disabled={settingMainIds.has(photo.id)}
                    className="h-8 px-2 text-xs bg-black/50 hover:bg-black/70 text-white border-none shadow-lg"
                    title="Set as main photo"
                  >
                    {settingMainIds.has(photo.id) ? (
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    ) : (
                      <span className="flex items-center gap-1">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          className="h-3 w-3"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
                          />
                        </svg>
                        Set Main
                      </span>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePhoto(photo.id);
                  }}
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
            )}
          </div>
        ))}
      </div>

      {/* Navigation arrows */}
      {showNavigation && (
        <>
          {canScrollLeft && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute left-2 top-1/2 -translate-y-1/2 z-20 bg-black/50 hover:bg-black/70 text-white border-none shadow-lg"
              onClick={() => scroll("left")}
              aria-label="Previous photo"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-5 w-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 19.5L8.25 12l7.5-7.5"
                />
              </svg>
            </Button>
          )}
          {canScrollRight && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2 z-20 bg-black/50 hover:bg-black/70 text-white border-none shadow-lg"
              onClick={() => scroll("right")}
              aria-label="Next photo"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2}
                stroke="currentColor"
                className="h-5 w-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 4.5l7.5 7.5-7.5 7.5"
                />
              </svg>
            </Button>
          )}
        </>
      )}

      {/* Dot indicators */}
      {showNavigation && (
        <div className="flex justify-center gap-2 mt-4">
          {photos.map((_, index) => (
            <button
              key={index}
              onClick={() => scrollToPhoto(index)}
              className={`h-2 rounded-full transition-all ${
                currentIndex === index
                  ? "w-8 bg-primary"
                  : "w-2 bg-muted-foreground/50 hover:bg-muted-foreground/70"
              }`}
              aria-label={`Go to photo ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}


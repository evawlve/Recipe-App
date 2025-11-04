"use client";

import Image from "next/image";

interface RecipeCardImageProps {
  src: string;
  alt: string;
  isPriority?: boolean;
  blurDataURL?: string;
  className?: string;
}

/**
 * Optimized image component for recipe cards
 * 
 * Features:
 * - Proper sizes attribute for responsive images
 * - Conditional priority loading (only first 2-3 images)
 * - Blur placeholder for better perceived performance
 * - Lazy loading for below-the-fold images
 */
export function RecipeCardImage({ 
  src, 
  alt, 
  isPriority = false, 
  blurDataURL,
  className = "object-cover w-full h-full"
}: RecipeCardImageProps) {
  
  // Fallback blur placeholder if none provided
  const fallbackBlur = "/images/lqip-placeholder.png";
  const placeholder = blurDataURL ? "blur" : "empty";
  
  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={isPriority}
      loading={isPriority ? "eager" : "lazy"}
      placeholder={placeholder}
      blurDataURL={blurDataURL || fallbackBlur}
      className={className}
      sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw"
      quality={80}
    />
  );
}


"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Upload, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface AvatarPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (file: File) => void;
  file: File | null;
  isUploading: boolean;
}

export function AvatarPreviewModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  file, 
  isUploading 
}: AvatarPreviewModalProps) {
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [imagePosition, setImagePosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Generate preview URL when file changes
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      
      // Load image to get dimensions
      const img = new Image();
      img.onload = () => {
        setImageSize({ width: img.width, height: img.height });
        // Center the image initially
        setImagePosition({ x: 0, y: 0 });
      };
      img.src = url;
      
      return () => URL.revokeObjectURL(url);
    }
  }, [file]);


  // Handle mouse/touch events for dragging
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
  }, [imagePosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const container = containerRef.current;
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const containerSize = 320; // Same as preview size (w-80 = 320px)
    const circleRadius = 160;
    
    // Calculate new position
    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    
    // Calculate image scale to fill the container
    const scale = Math.max(containerSize / imageSize.width, containerSize / imageSize.height);
    const scaledImageWidth = imageSize.width * scale;
    const scaledImageHeight = imageSize.height * scale;
    
    // Calculate bounds to keep the circle within the image
    const maxX = (scaledImageWidth - containerSize) / 2;
    const maxY = (scaledImageHeight - containerSize) / 2;
    
    // Constrain position
    const constrainedX = Math.max(-maxX, Math.min(maxX, newX));
    const constrainedY = Math.max(-maxY, Math.min(maxY, newY));
    
    setImagePosition({ x: constrainedX, y: constrainedY });
  }, [isDragging, dragStart, imageSize]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch events for mobile
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - imagePosition.x, y: touch.clientY - imagePosition.y });
  }, [imagePosition]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    
    const touch = e.touches[0];
    const container = containerRef.current;
    if (!container) return;
    
    const containerSize = 320;
    
    // Calculate new position
    const newX = touch.clientX - dragStart.x;
    const newY = touch.clientY - dragStart.y;
    
    // Calculate image scale to fill the container
    const scale = Math.max(containerSize / imageSize.width, containerSize / imageSize.height);
    const scaledImageWidth = imageSize.width * scale;
    const scaledImageHeight = imageSize.height * scale;
    
    // Calculate bounds to keep the circle within the image
    const maxX = (scaledImageWidth - containerSize) / 2;
    const maxY = (scaledImageHeight - containerSize) / 2;
    
    // Constrain position
    const constrainedX = Math.max(-maxX, Math.min(maxX, newX));
    const constrainedY = Math.max(-maxY, Math.min(maxY, newY));
    
    setImagePosition({ x: constrainedX, y: constrainedY });
  }, [isDragging, dragStart, imageSize]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Global mouse events for dragging outside container
  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      
      const container = containerRef.current;
      if (!container) return;
      
      const containerSize = 320;
      
      // Calculate new position
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      // Calculate image scale to fill the container
      const scale = Math.max(containerSize / imageSize.width, containerSize / imageSize.height);
      const scaledImageWidth = imageSize.width * scale;
      const scaledImageHeight = imageSize.height * scale;
      
      // Calculate bounds to keep the circle within the image
      const maxX = (scaledImageWidth - containerSize) / 2;
      const maxY = (scaledImageHeight - containerSize) / 2;
      
      // Constrain position
      const constrainedX = Math.max(-maxX, Math.min(maxX, newX));
      const constrainedY = Math.max(-maxY, Math.min(maxY, newY));
      
      setImagePosition({ x: constrainedX, y: constrainedY });
    };

    const handleGlobalMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleGlobalMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleGlobalMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [isDragging, dragStart, imageSize]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Preview Avatar</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            disabled={isUploading}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-6">
          {/* Preview Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {/* Interactive image cropper */}
              <div 
                ref={containerRef}
                className="w-80 h-80 rounded-lg overflow-hidden border-2 border-border relative cursor-move select-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                style={{ userSelect: 'none' }}
              >
                {previewUrl ? (
                  <div className="relative w-full h-full overflow-hidden">
                    {/* Background image */}
                    <img
                      src={previewUrl}
                      alt="Crop preview"
                      className="absolute w-full h-full object-cover"
                      style={{
                        transform: `translate(${imagePosition.x}px, ${imagePosition.y}px)`,
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                        imageRendering: 'crisp-edges'
                      }}
                      draggable={false}
                    />
                    
                    {/* Circular overlay showing crop area */}
                    <div 
                      className="absolute inset-0 pointer-events-none"
                      style={{
                        background: 'rgba(0, 0, 0, 0.5)',
                        maskImage: 'radial-gradient(circle at center, transparent 50%, black 50%)',
                        WebkitMaskImage: 'radial-gradient(circle at center, transparent 50%, black 50%)'
                      }}
                    ></div>
                  </div>
                ) : (
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <span className="text-muted-foreground">Loading...</span>
                  </div>
                )}
              </div>
            </div>
            
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Position Your Avatar</p>
              <p className="text-xs text-muted-foreground">
                Drag the image to position it within the circle
              </p>
            </div>
          </div>

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span className="text-sm">Uploading avatar...</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: "60%" }}></div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isUploading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={() => file && onConfirm(file)}
              disabled={!file || isUploading}
              className="flex-1"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload Avatar
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

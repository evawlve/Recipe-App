"use strict";
"use client";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AvatarPreviewModal = AvatarPreviewModal;
const react_1 = require("react");
const button_1 = require("@/components/ui/button");
const card_1 = require("@/components/ui/card");
const lucide_react_1 = require("lucide-react");
function AvatarPreviewModal({ isOpen, onClose, onConfirm, file, isUploading }) {
    const [previewUrl, setPreviewUrl] = (0, react_1.useState)("");
    const [imagePosition, setImagePosition] = (0, react_1.useState)({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = (0, react_1.useState)(false);
    const [dragStart, setDragStart] = (0, react_1.useState)({ x: 0, y: 0 });
    const [imageSize, setImageSize] = (0, react_1.useState)({ width: 0, height: 0 });
    const containerRef = (0, react_1.useRef)(null);
    // Generate preview URL when file changes
    (0, react_1.useEffect)(() => {
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
    const handleMouseDown = (0, react_1.useCallback)((e) => {
        setIsDragging(true);
        setDragStart({ x: e.clientX - imagePosition.x, y: e.clientY - imagePosition.y });
    }, [imagePosition]);
    const handleMouseMove = (0, react_1.useCallback)((e) => {
        if (!isDragging)
            return;
        const container = containerRef.current;
        if (!container)
            return;
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
    const handleMouseUp = (0, react_1.useCallback)(() => {
        setIsDragging(false);
    }, []);
    // Touch events for mobile
    const handleTouchStart = (0, react_1.useCallback)((e) => {
        const touch = e.touches[0];
        setIsDragging(true);
        setDragStart({ x: touch.clientX - imagePosition.x, y: touch.clientY - imagePosition.y });
    }, [imagePosition]);
    const handleTouchMove = (0, react_1.useCallback)((e) => {
        if (!isDragging)
            return;
        e.preventDefault();
        const touch = e.touches[0];
        const container = containerRef.current;
        if (!container)
            return;
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
    const handleTouchEnd = (0, react_1.useCallback)(() => {
        setIsDragging(false);
    }, []);
    // Global mouse events for dragging outside container
    (0, react_1.useEffect)(() => {
        const handleGlobalMouseMove = (e) => {
            if (!isDragging)
                return;
            const container = containerRef.current;
            if (!container)
                return;
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
    if (!isOpen)
        return null;
    return (<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <card_1.Card className="w-full max-w-md">
        <card_1.CardHeader className="flex flex-row items-center justify-between">
          <card_1.CardTitle>Preview Avatar</card_1.CardTitle>
          <button_1.Button variant="ghost" size="sm" onClick={onClose} disabled={isUploading}>
            <lucide_react_1.X className="h-4 w-4"/>
          </button_1.Button>
        </card_1.CardHeader>
        
        <card_1.CardContent className="space-y-6">
          {/* Preview Section */}
          <div className="flex flex-col items-center space-y-4">
            <div className="relative">
              {/* Interactive image cropper */}
              <div ref={containerRef} className="w-80 h-80 rounded-lg overflow-hidden border-2 border-border relative cursor-move select-none" onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} style={{ userSelect: 'none' }}>
                {previewUrl ? (<div className="relative w-full h-full overflow-hidden">
                    {/* Background image */}
                    <img src={previewUrl} alt="Crop preview" className="absolute w-full h-full object-cover" style={{
                transform: `translate(${imagePosition.x}px, ${imagePosition.y}px)`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                imageRendering: 'crisp-edges'
            }} draggable={false}/>
                    
                    {/* Circular overlay showing crop area */}
                    <div className="absolute inset-0 pointer-events-none" style={{
                background: 'rgba(0, 0, 0, 0.5)',
                maskImage: 'radial-gradient(circle at center, transparent 50%, black 50%)',
                WebkitMaskImage: 'radial-gradient(circle at center, transparent 50%, black 50%)'
            }}></div>
                  </div>) : (<div className="w-full h-full bg-muted flex items-center justify-center">
                    <span className="text-muted-foreground">Loading...</span>
                  </div>)}
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
          {isUploading && (<div className="space-y-3">
              <div className="flex items-center space-x-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                <span className="text-sm">Uploading avatar...</span>
              </div>
              <div className="w-full bg-muted rounded-full h-2">
                <div className="bg-primary h-2 rounded-full animate-pulse" style={{ width: "60%" }}></div>
              </div>
            </div>)}

          {/* Action Buttons */}
          <div className="flex space-x-3">
            <button_1.Button variant="outline" onClick={onClose} disabled={isUploading} className="flex-1">
              Cancel
            </button_1.Button>
            <button_1.Button onClick={() => file && onConfirm(file)} disabled={!file || isUploading} className="flex-1">
              {isUploading ? (<>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                  Uploading...
                </>) : (<>
                  <lucide_react_1.Upload className="h-4 w-4 mr-2"/>
                  Upload Avatar
                </>)}
            </button_1.Button>
          </div>
        </card_1.CardContent>
      </card_1.Card>
    </div>);
}

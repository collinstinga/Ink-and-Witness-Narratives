import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Check, 
  Maximize2, 
  Crop, 
  Move, 
  Sparkles,
  Eye,
  Smartphone,
  Layers,
  Image as ImageIcon
} from 'lucide-react';

export type CropAspectRatio = 'landscape' | 'square' | 'portrait' | 'freeform';

export interface CropSettings {
  aspectRatio: CropAspectRatio;
  zoom: number; // 50 to 300
  positionX: number; // percentage offset 0 - 100
  positionY: number; // percentage offset 0 - 100
}

interface ImageCropModalProps {
  isOpen: boolean;
  imageUrl: string;
  originalImageUrl?: string;
  initialCropSettings?: CropSettings;
  title?: string;
  onSave: (result: {
    croppedDataUrl: string;
    cropSettings: CropSettings;
    originalUrl?: string;
  }) => void;
  onClose: () => void;
}

const ASPECT_RATIO_CONFIGS: Record<CropAspectRatio, { label: string; ratio: number; widthClass: string; desc: string }> = {
  landscape: {
    label: 'Landscape (16:9)',
    ratio: 16 / 9,
    widthClass: 'aspect-[16/9] max-w-xl',
    desc: 'Optimal for monograph cards & wide desktop headers'
  },
  square: {
    label: 'Square (1:1)',
    ratio: 1 / 1,
    widthClass: 'aspect-square max-w-md',
    desc: 'Optimal for author portraits & square feeds'
  },
  portrait: {
    label: 'Portrait (3:4)',
    ratio: 3 / 4,
    widthClass: 'aspect-[3/4] max-w-sm',
    desc: 'Optimal for monograph book covers & vertical screens'
  },
  freeform: {
    label: 'Original / Freeform',
    ratio: 0,
    widthClass: 'aspect-[16/10] max-w-xl',
    desc: 'Flexible framing without strict ratio constraints'
  }
};

export const ImageCropModal: React.FC<ImageCropModalProps> = ({
  isOpen,
  imageUrl,
  originalImageUrl,
  initialCropSettings,
  title = "Crop & Fit Cover Image",
  onSave,
  onClose
}) => {
  const activeImageSource = originalImageUrl || imageUrl;

  const [aspectRatio, setAspectRatio] = useState<CropAspectRatio>(
    initialCropSettings?.aspectRatio || 'landscape'
  );
  const [zoom, setZoom] = useState<number>(initialCropSettings?.zoom || 100);
  const [positionX, setPositionX] = useState<number>(initialCropSettings?.positionX ?? 50);
  const [positionY, setPositionY] = useState<number>(initialCropSettings?.positionY ?? 50);
  const [activePreviewTab, setActivePreviewTab] = useState<'editor' | 'preview'>('editor');

  // Dragging state
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number }>({ x: 0, y: 0, posX: 50, posY: 50 });
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Sync when modal opens or initial settings change
  useEffect(() => {
    if (isOpen) {
      if (initialCropSettings) {
        setAspectRatio(initialCropSettings.aspectRatio || 'landscape');
        setZoom(initialCropSettings.zoom || 100);
        setPositionX(initialCropSettings.positionX ?? 50);
        setPositionY(initialCropSettings.positionY ?? 50);
      } else {
        setZoom(100);
        setPositionX(50);
        setPositionY(50);
      }
      setActivePreviewTab('editor');
    }
  }, [isOpen, initialCropSettings, imageUrl]);

  // Handle Dragging
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: positionX,
      posY: positionY
    };
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !viewportRef.current) return;

    const deltaX = e.clientX - dragStartRef.current.x;
    const deltaY = e.clientY - dragStartRef.current.y;

    const viewportRect = viewportRef.current.getBoundingClientRect();
    const sensitivity = (100 / (zoom / 100)) * 0.8; // adjust pan speed based on zoom

    const newPosX = Math.min(100, Math.max(0, dragStartRef.current.posX - (deltaX / viewportRect.width) * sensitivity));
    const newPosY = Math.min(100, Math.max(0, dragStartRef.current.posY - (deltaY / viewportRect.height) * sensitivity));

    setPositionX(Math.round(newPosX * 10) / 10);
    setPositionY(Math.round(newPosY * 10) / 10);
  }, [isDragging, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Touch drag support for mobile / tablet
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      setIsDragging(true);
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: positionX,
        posY: positionY
      };
    }
  };

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!isDragging || !viewportRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const deltaX = touch.clientX - dragStartRef.current.x;
    const deltaY = touch.clientY - dragStartRef.current.y;

    const viewportRect = viewportRef.current.getBoundingClientRect();
    const sensitivity = (100 / (zoom / 100)) * 0.8;

    const newPosX = Math.min(100, Math.max(0, dragStartRef.current.posX - (deltaX / viewportRect.width) * sensitivity));
    const newPosY = Math.min(100, Math.max(0, dragStartRef.current.posY - (deltaY / viewportRect.height) * sensitivity));

    setPositionX(Math.round(newPosX * 10) / 10);
    setPositionY(Math.round(newPosY * 10) / 10);
  }, [isDragging, zoom]);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleTouchMove);
      window.addEventListener('touchend', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove]);

  // Handle Wheel Zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY * -0.1;
    setZoom(prev => Math.min(300, Math.max(60, Math.round(prev + delta))));
  };

  // Quick Preset Alignments
  const setPresetPosition = (x: number, y: number) => {
    setPositionX(x);
    setPositionY(y);
  };

  const handleReset = () => {
    setZoom(100);
    setPositionX(50);
    setPositionY(50);
    setAspectRatio('landscape');
  };

  // Generate cropped output canvas
  const handleApplyCrop = () => {
    if (!imageRef.current) {
      onClose();
      return;
    }

    const img = imageRef.current;
    const naturalWidth = img.naturalWidth || 1200;
    const naturalHeight = img.naturalHeight || 800;

    // Target output dimension
    let targetRatio = 16 / 9;
    if (aspectRatio === 'square') targetRatio = 1 / 1;
    else if (aspectRatio === 'portrait') targetRatio = 3 / 4;
    else if (aspectRatio === 'freeform') targetRatio = naturalWidth / naturalHeight;

    const outWidth = Math.min(1600, naturalWidth);
    const outHeight = Math.round(outWidth / targetRatio);

    const canvas = document.createElement('canvas');
    canvas.width = outWidth;
    canvas.height = outHeight;
    const ctx = canvas.getContext('2d');

    if (!ctx) {
      onClose();
      return;
    }

    ctx.fillStyle = '#070b14';
    ctx.fillRect(0, 0, outWidth, outHeight);

    // Compute transformation matrix according to zoom and positionX, positionY
    const scale = zoom / 100;
    
    // Scale image to cover canvas while maintaining aspect ratio
    const imgRatio = naturalWidth / naturalHeight;
    let drawWidth: number;
    let drawHeight: number;

    if (imgRatio > targetRatio) {
      drawHeight = outHeight * scale;
      drawWidth = drawHeight * imgRatio;
    } else {
      drawWidth = outWidth * scale;
      drawHeight = drawWidth / imgRatio;
    }

    // Offset based on positionX and positionY (0% to 100%)
    const offsetX = (outWidth - drawWidth) * (positionX / 100);
    const offsetY = (outHeight - drawHeight) * (positionY / 100);

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

    const currentCropSettings: CropSettings = {
      aspectRatio,
      zoom,
      positionX,
      positionY
    };

    onSave({
      croppedDataUrl,
      cropSettings: currentCropSettings,
      originalUrl: activeImageSource
    });

    onClose();
  };

  if (!isOpen) return null;

  const currentConfig = ASPECT_RATIO_CONFIGS[aspectRatio];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div 
        id="image-crop-modal-container"
        className="relative w-full max-w-4xl bg-[#090f1d] border border-slate-700/80 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
      >
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-800 bg-[#070b14]/90">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/60 text-sky-400">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-serif font-bold text-white tracking-wide">
                {title}
              </h2>
              <p className="text-[11px] text-slate-400 font-sans">
                Drag to reposition focal point • Zoom to adjust framing • Preserve original
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex bg-[#0b1120] p-0.5 rounded-lg border border-slate-800 text-xs font-mono">
              <button
                type="button"
                onClick={() => setActivePreviewTab('editor')}
                className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                  activePreviewTab === 'editor' ? 'bg-sky-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Framing Editor
              </button>
              <button
                type="button"
                onClick={() => setActivePreviewTab('preview')}
                className={`px-3 py-1 rounded transition-colors cursor-pointer ${
                  activePreviewTab === 'preview' ? 'bg-sky-600 text-white font-medium' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Website Preview
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          
          {activePreviewTab === 'editor' ? (
            <div className="space-y-6">
              
              {/* Aspect Ratio Selector Pills */}
              <div className="space-y-2">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300">
                  Select Framing Aspect Ratio
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.keys(ASPECT_RATIO_CONFIGS) as CropAspectRatio[]).map((key) => {
                    const cfg = ASPECT_RATIO_CONFIGS[key];
                    const isSelected = aspectRatio === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setAspectRatio(key)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-sky-950/80 border-sky-500/80 text-white shadow-md shadow-sky-950/40'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold">{cfg.label}</span>
                          {isSelected && <span className="w-2 h-2 rounded-full bg-sky-400" />}
                        </div>
                        <span className="text-[10px] text-slate-500 font-sans block line-clamp-1">{cfg.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Main Crop Frame / Interactive Viewport */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                  <span className="flex items-center gap-1.5 text-sky-400">
                    <Move className="w-3.5 h-3.5" />
                    <span>Click and drag photo inside frame to position</span>
                  </span>
                  <span>Position: {positionX}% X • {positionY}% Y</span>
                </div>

                <div className="flex justify-center items-center p-4 sm:p-6 bg-[#060a12] border border-slate-800 rounded-2xl overflow-hidden min-h-[320px]">
                  <div
                    ref={viewportRef}
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleTouchStart}
                    onWheel={handleWheel}
                    className={`relative overflow-hidden w-full ${currentConfig.widthClass} rounded-xl border-2 border-dashed border-sky-500/60 shadow-2xl bg-black select-none cursor-grab ${
                      isDragging ? 'cursor-grabbing border-sky-400' : ''
                    }`}
                  >
                    {/* The Source Image */}
                    <img
                      ref={imageRef}
                      src={activeImageSource}
                      alt="Crop Target"
                      crossOrigin="anonymous"
                      referrerPolicy="no-referrer"
                      style={{
                        objectFit: 'cover',
                        objectPosition: `${positionX}% ${positionY}%`,
                        transform: `scale(${zoom / 100})`,
                        transformOrigin: `${positionX}% ${positionY}%`,
                      }}
                      className="w-full h-full pointer-events-none transition-transform duration-75"
                    />

                    {/* Rule of Thirds Photography Grid Overlay */}
                    <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 opacity-30">
                      <div className="border-r border-b border-white/40" />
                      <div className="border-r border-b border-white/40" />
                      <div className="border-b border-white/40" />
                      <div className="border-r border-b border-white/40" />
                      <div className="border-r border-b border-white/40" />
                      <div className="border-b border-white/40" />
                      <div className="border-r border-white/40" />
                      <div className="border-r border-white/40" />
                      <div />
                    </div>

                    {/* Center Crosshair marker */}
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none opacity-40">
                      <div className="w-full h-0.5 bg-white/80 absolute top-1/2 -translate-y-1/2" />
                      <div className="h-full w-0.5 bg-white/80 absolute left-1/2 -translate-x-1/2" />
                    </div>

                    {/* Active Drag Hint Badge */}
                    <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-slate-700/80 text-[10px] font-mono text-slate-300 pointer-events-none flex items-center gap-1.5">
                      <Crop className="w-3 h-3 text-sky-400" />
                      <span>{aspectRatio.toUpperCase()} ({zoom}%)</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Zoom & Positioning Controls Bar */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-2xl bg-[#070b14] border border-slate-800 items-center">
                
                {/* Zoom Controls (6 cols) */}
                <div className="md:col-span-6 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
                      <span>Zoom / Scale Factor</span>
                    </span>
                    <span className="text-sky-400 font-semibold">{zoom}%</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setZoom(prev => Math.max(60, prev - 10))}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <input
                      type="range"
                      min={60}
                      max={250}
                      step={5}
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                      className="flex-1 accent-sky-500 cursor-pointer"
                    />
                    <button
                      type="button"
                      onClick={() => setZoom(prev => Math.min(250, prev + 10))}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Quick Focal Presets (6 cols) */}
                <div className="md:col-span-6 space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                    <span>Quick Focal Position</span>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="text-[10px] text-slate-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Reset All</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-5 gap-1 text-[11px] font-mono">
                    <button
                      type="button"
                      onClick={() => setPresetPosition(50, 0)}
                      className={`p-1.5 rounded-lg border text-center cursor-pointer transition-colors ${
                        positionY === 0 ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Top
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetPosition(50, 50)}
                      className={`p-1.5 rounded-lg border text-center cursor-pointer transition-colors ${
                        positionX === 50 && positionY === 50 ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Center
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetPosition(50, 100)}
                      className={`p-1.5 rounded-lg border text-center cursor-pointer transition-colors ${
                        positionY === 100 ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Bottom
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetPosition(0, 50)}
                      className={`p-1.5 rounded-lg border text-center cursor-pointer transition-colors ${
                        positionX === 0 ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Left
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresetPosition(100, 50)}
                      className={`p-1.5 rounded-lg border text-center cursor-pointer transition-colors ${
                        positionX === 100 ? 'bg-sky-950 border-sky-500 text-white' : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Right
                    </button>
                  </div>
                </div>

              </div>

            </div>
          ) : (
            /* Live Website Appearance Preview Tab */
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-sky-950/40 border border-sky-800/60 text-xs text-sky-200">
                Previewing how this crop framing renders on live website card components.
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                
                {/* 1. Card Thumbnail Preview */}
                <div className="space-y-2">
                  <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block">
                    Homepage Monograph Card Preview
                  </span>
                  <div className="rounded-2xl bg-gradient-to-b from-[#0f172a]/95 to-[#0b111e] border border-slate-800 overflow-hidden shadow-xl p-0">
                    <div className="relative h-48 w-full overflow-hidden bg-slate-950">
                      <img
                        src={activeImageSource}
                        alt="Preview"
                        style={{
                          objectFit: 'cover',
                          objectPosition: `${positionX}% ${positionY}%`,
                          transform: `scale(${zoom / 100})`,
                          transformOrigin: `${positionX}% ${positionY}%`,
                        }}
                        className="w-full h-full"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f172a] via-transparent to-transparent" />
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-slate-950/80 border border-slate-700 text-[10px] font-mono text-sky-400">
                        Sample Monograph
                      </div>
                    </div>
                    <div className="p-4 space-y-2">
                      <h4 className="font-serif font-bold text-base text-white">Title of the Monograph</h4>
                      <p className="text-xs text-slate-400 font-sans line-clamp-2">
                        Subtitle or hook displayed clearly beneath the title on the website...
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Spotlight Banner Preview */}
                <div className="space-y-2">
                  <span className="text-xs font-mono text-slate-400 uppercase tracking-wider block">
                    Piece of the Week Spotlight Preview
                  </span>
                  <div className="rounded-2xl bg-slate-900 border border-sky-500/40 p-4 space-y-3">
                    <div className="relative h-40 rounded-xl overflow-hidden bg-slate-950 border border-slate-700">
                      <img
                        src={activeImageSource}
                        alt="Preview"
                        style={{
                          objectFit: 'cover',
                          objectPosition: `${positionX}% ${positionY}%`,
                          transform: `scale(${zoom / 100})`,
                          transformOrigin: `${positionX}% ${positionY}%`,
                        }}
                        className="w-full h-full"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#070b14]/80 via-transparent to-transparent" />
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono text-emerald-400 border border-emerald-800">
                        Editorial Spotlight
                      </div>
                    </div>
                    <p className="text-xs text-slate-300 font-serif italic">
                      "Framing retains the exact focal point you centered above."
                    </p>
                  </div>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-5 sm:px-6 py-4 border-t border-slate-800 bg-[#070b14]">
          <div className="text-xs text-slate-400 font-sans text-center sm:text-left">
            <span className="text-slate-300 font-medium">Original image preserved.</span> You can re-adjust or change framing anytime.
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer border border-slate-700"
            >
              Cancel
            </button>

            <button
              type="button"
              id="save-image-crop-btn"
              onClick={handleApplyCrop}
              className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold tracking-wide transition-all shadow-lg shadow-sky-950 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>Apply &amp; Save Crop</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};

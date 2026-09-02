import React, { useState, useEffect, useRef } from 'react';
import { 
  Image as ImageIcon, 
  Upload, 
  Trash2, 
  Move, 
  ZoomIn, 
  Sliders, 
  Eye, 
  Check, 
  Sparkles, 
  Flame, 
  Calendar, 
  Save, 
  RefreshCw, 
  ArrowRight,
  Search,
  X,
  Smartphone,
  Layers,
  ChevronDown
} from 'lucide-react';
import { Article, HomepageConfig, WelcomeBackgroundSettings } from '../../types.js';
import { api } from '../../utils/api.js';
import { SaveStatusBar } from '../common/SaveStatusBar.js';

interface HomepageManagerProps {
  articles: Article[];
  initialSubTab?: 'overview' | 'cover' | 'banners' | 'sections';
  onNavigateSubTab?: (subTab: 'overview' | 'cover' | 'banners' | 'sections') => void;
  onRefreshArticles?: () => void;
  onDirtyChange?: (isDirty: boolean) => void;
}

export const HomepageManager: React.FC<HomepageManagerProps> = ({ 
  articles,
  initialSubTab = 'overview',
  onNavigateSubTab,
  onRefreshArticles,
  onDirtyChange 
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'cover' | 'banners' | 'sections'>(initialSubTab);

  useEffect(() => {
    if (initialSubTab && initialSubTab !== activeSubTab) {
      setActiveSubTab(initialSubTab);
    }
  }, [initialSubTab]);

  const handleSubTabChange = (tab: 'overview' | 'cover' | 'banners' | 'sections') => {
    setActiveSubTab(tab);
    if (onNavigateSubTab) {
      onNavigateSubTab(tab);
    }
  };

  const [config, setConfig] = useState<HomepageConfig>({
    welcomeBackground: {
      imageUrl: '/uploads/author_cover-1786702522341-772b89830648.jpg',
      fit: 'cover',
      positionX: 50,
      positionY: 50,
      zoom: 100,
      overlayStrength: 25,
    },
    mostSellingPieceIds: ['art-01', 'art-1786653937804', 'art-02'],
    pieceOfTheWeekId: 'art-01',
    mostSellingMode: 'auto',
    banners: [
      {
        id: 'banner-01',
        text: 'New Monograph: The Architecture of Sovereignty is now live.',
        linkText: 'Read Monograph',
        linkUrl: '#piece-the-architecture-of-sovereignty',
        bgStyle: 'sky',
        isVisible: false
      }
    ],
    heroHeadline: 'INK & WITNESS',
    heroQuote: '“I write because the heart keeps a ledger the tongue is too proud to read.”',
    heroSubheadline: 'An archive of lived experience, intimacy, power, and memory authored by Jake.',
    heroBadge: 'Ink & Witness Narratives',
    sections: [
      { id: 'piece_of_the_week', title: 'Piece of the Week', isVisible: true, order: 1 },
      { id: 'most_selling', title: 'Most Selling Pieces', isVisible: true, order: 2 },
      { id: 'latest', title: 'Latest from the Ink', isVisible: true, order: 3 },
      { id: 'catalogue', title: 'Explore Full Catalogue', isVisible: true, order: 4 },
      { id: 'patronage', title: 'Patronage & Reader Support', isVisible: true, order: 5 }
    ]
  });

  const [publishedPieces, setPublishedPieces] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingPermanent, setSavingPermanent] = useState(false);
  const [permanentSaved, setPermanentSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isInitialLoad = useRef(true);

  // Picker modal state
  const [activePickerSlot, setActivePickerSlot] = useState<{
    type: 'mostSelling' | 'pieceOfTheWeek';
    slotIndex?: number;
  } | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');

  // Dragging state for interactive positioning box
  const [isDragging, setIsDragging] = useState(false);
  const dragBoxRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Track changes to mark dirty
  useEffect(() => {
    if (isInitialLoad.current) {
      return;
    }
    setIsDirty(true);
  }, [config]);

  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  // Load admin homepage config from server
  const loadHomepageData = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminHomepageData();
      if (data && data.config) {
        setConfig({
          welcomeBackground: {
            imageUrl: data.config.welcomeBackground?.imageUrl || '',
            fit: data.config.welcomeBackground?.fit || 'cover',
            positionX: typeof data.config.welcomeBackground?.positionX === 'number' ? data.config.welcomeBackground.positionX : 50,
            positionY: typeof data.config.welcomeBackground?.positionY === 'number' ? data.config.welcomeBackground.positionY : 50,
            zoom: typeof data.config.welcomeBackground?.zoom === 'number' ? data.config.welcomeBackground.zoom : 100,
            overlayStrength: typeof data.config.welcomeBackground?.overlayStrength === 'number' ? data.config.welcomeBackground.overlayStrength : 25,
          },
          mostSellingPieceIds: data.config.mostSellingPieceIds || [],
          pieceOfTheWeekId: data.config.pieceOfTheWeekId || '',
          mostSellingMode: data.config.mostSellingMode || 'auto',
          banners: data.config.banners && data.config.banners.length > 0 ? data.config.banners : [
            {
              id: 'banner-01',
              text: 'New Monograph: The Architecture of Sovereignty is now live.',
              linkText: 'Read Monograph',
              linkUrl: '#piece-the-architecture-of-sovereignty',
              bgStyle: 'sky',
              isVisible: false
            }
          ],
          heroHeadline: data.config.heroHeadline || 'INK & WITNESS',
          heroQuote: data.config.heroQuote || '“I write because the heart keeps a ledger the tongue is too proud to read.”',
          heroSubheadline: data.config.heroSubheadline || 'An archive of lived experience, intimacy, power, and memory authored by Jake.',
          heroBadge: data.config.heroBadge || 'Ink & Witness Narratives',
          sections: data.config.sections && data.config.sections.length > 0 ? data.config.sections : [
            { id: 'piece_of_the_week', title: 'Piece of the Week', isVisible: true, order: 1 },
            { id: 'most_selling', title: 'Most Selling Pieces', isVisible: true, order: 2 },
            { id: 'latest', title: 'Latest from the Ink', isVisible: true, order: 3 },
            { id: 'catalogue', title: 'Explore Full Catalogue', isVisible: true, order: 4 },
            { id: 'patronage', title: 'Patronage & Reader Support', isVisible: true, order: 5 }
          ]
        });
        setLastSavedAt(data.config.lastSavedAt || data.config.updatedAt || null);
      }
      if (data.allPublishedPieces) {
        setPublishedPieces(data.allPublishedPieces);
      } else {
        // Filter from props
        setPublishedPieces(articles.filter(a => a.status === 'published'));
      }
      setTimeout(() => {
        isInitialLoad.current = false;
        setIsDirty(false);
      }, 100);
    } catch (err: any) {
      console.error('Failed to load homepage settings:', err);
      setError('Failed to load homepage settings from server.');
      setPublishedPieces(articles.filter(a => a.status === 'published'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHomepageData();
  }, [articles]);

  const handleSave = async () => {
    try {
      setSaving(true);
      setError(null);
      await api.saveAdminHomepageData(config);
      setIsDirty(false);
      const now = new Date().toISOString();
      setLastSavedAt(now);
      if (onRefreshArticles) onRefreshArticles();
    } catch (err: any) {
      console.error('Error saving homepage configuration:', err);
      setError(err.message || 'Failed to save homepage settings.');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      setError('Image file is too large (max 15MB).');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    setUploadingImage(true);
    setError(null);

    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        setError('Failed to read image file.');
        setUploadingImage(false);
        return;
      }

      try {
        const res = await api.uploadImage(dataUrl, 'welcome_background');
        if (res.success && res.url) {
          setConfig(prev => ({
            ...prev,
            welcomeBackground: {
              ...prev.welcomeBackground,
              imageUrl: res.url
            }
          }));
        }
      } catch (err: any) {
        console.error('Upload error:', err);
        setError(err.message || 'Failed to upload background photo.');
      } finally {
        setUploadingImage(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };

    reader.onerror = () => {
      setError('Error reading image file.');
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsDataURL(file);
  };

  const handleRemoveImage = async () => {
    if (!window.confirm('Remove welcome screen background photo?')) return;
    try {
      setUploadingImage(true);
      await api.removeImage('welcome_background');
      setConfig(prev => ({
        ...prev,
        welcomeBackground: {
          ...prev.welcomeBackground,
          imageUrl: ''
        }
      }));
    } catch (err: any) {
      console.error('Remove image error:', err);
      setError(err.message || 'Failed to remove background photo.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSavePermanent = async () => {
    if (!config.welcomeBackground?.imageUrl) return;
    try {
      setSavingPermanent(true);
      setError(null);
      await api.savePermanentImage(config.welcomeBackground.imageUrl, 'welcome_background');
      setPermanentSaved(true);
      setTimeout(() => setPermanentSaved(false), 4000);
    } catch (err: any) {
      console.error('Failed to permanently save welcome background:', err);
      setError(err.message || 'Failed to save photo permanently.');
    } finally {
      setSavingPermanent(false);
    }
  };

  // Drag-to-position inside the visual control box
  const handleDragBoxMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    updatePositionFromEvent(e);
  };

  const updatePositionFromEvent = (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (!dragBoxRef.current) return;
    const rect = dragBoxRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, Math.round(((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.max(0, Math.min(100, Math.round(((e.clientY - rect.top) / rect.height) * 100)));

    setConfig(prev => ({
      ...prev,
      welcomeBackground: {
        ...prev.welcomeBackground,
        positionX: x,
        positionY: y
      }
    }));
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        updatePositionFromEvent(e);
      }
    };
    const handleMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
      }
    };

    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Select piece helper
  const handleSelectPiece = (articleId: string) => {
    if (!activePickerSlot) return;

    if (activePickerSlot.type === 'mostSelling' && typeof activePickerSlot.slotIndex === 'number') {
      const newIds = [...(config.mostSellingPieceIds || ['', '', ''])];
      while (newIds.length < 3) newIds.push('');
      newIds[activePickerSlot.slotIndex] = articleId;
      setConfig(prev => ({
        ...prev,
        mostSellingPieceIds: newIds
      }));
    } else if (activePickerSlot.type === 'pieceOfTheWeek') {
      setConfig(prev => ({
        ...prev,
        pieceOfTheWeekId: articleId
      }));
    }

    setActivePickerSlot(null);
    setPickerSearch('');
  };

  const getArticleById = (id: string) => {
    return publishedPieces.find(a => a.id === id) || articles.find(a => a.id === id);
  };

  const filteredPickerArticles = publishedPieces.filter(a => 
    a.title.toLowerCase().includes(pickerSearch.toLowerCase()) ||
    (a.subtitle && a.subtitle.toLowerCase().includes(pickerSearch.toLowerCase())) ||
    a.category.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  return (
    <div id="homepage-manager" className="space-y-10 pb-16">
      
      {/* Top Header with Sticky Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-sky-400 uppercase tracking-wider mb-1">
            <Sliders className="w-4 h-4" />
            <span>Public Homepage Curation</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
            Homepage Management
          </h2>
          <p className="text-sm text-slate-400 mt-1 max-w-2xl font-sans">
            Customize the public welcome screen background photo, announcement banners, hero typography, section order, and featured monographs.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <SaveStatusBar
            idPrefix="homepage-top"
            onSave={handleSave}
            isDirty={isDirty}
            isSaving={saving}
            lastSavedAt={lastSavedAt}
            errorMessage={error}
            saveButtonText="SAVE HOMEPAGE"
          />
        </div>
      </div>

      {/* Sub-Tabs Navigation for Internal Writer Portal Routing */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-slate-800/80">
        <button
          id="tab-homepage-all"
          type="button"
          onClick={() => handleSubTabChange('overview')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeSubTab === 'overview'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          All Sections
        </button>
        <button
          id="tab-homepage-cover"
          type="button"
          onClick={() => handleSubTabChange('cover')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeSubTab === 'cover'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          Cover &amp; Photo
        </button>
        <button
          id="tab-homepage-banners"
          type="button"
          onClick={() => handleSubTabChange('banners')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeSubTab === 'banners'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          Banners &amp; Hero Text
        </button>
        <button
          id="tab-homepage-sections"
          type="button"
          onClick={() => handleSubTabChange('sections')}
          className={`px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
            activeSubTab === 'sections'
              ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border border-transparent'
          }`}
        >
          Section Layout &amp; Ordering
        </button>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-rose-950/50 border border-rose-800 text-rose-300 text-xs font-mono">
          {error}
        </div>
      )}

      {/* ============================================================ */}
      {/* 1. WELCOME SCREEN BACKGROUND & ADJUSTMENT TOOL */}
      {/* ============================================================ */}
      {(activeSubTab === 'overview' || activeSubTab === 'cover') && (
      <section id="section-welcome-bg-manager" className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-sky-400 uppercase tracking-wider mb-1">
              <ImageIcon className="w-4 h-4" />
              <span>Section 1 • Welcome Screen</span>
            </div>
            <h3 className="font-display font-bold text-xl text-white">
              Welcome Screen Background Photo
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Photo covers the hero area behind “INK &amp; WITNESS”. Use controls below to adjust fit, position, zoom, and overlay strength.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <input 
              ref={fileInputRef}
              type="file" 
              accept="image/*" 
              onChange={handleImageUpload} 
              className="hidden" 
            />
            
            <button
              id="btn-upload-welcome-bg"
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage || savingPermanent}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Upload className="w-4 h-4 text-sky-400" />
              <span>{config.welcomeBackground?.imageUrl ? 'Change Photo' : 'Upload Photo'}</span>
            </button>

            {config.welcomeBackground?.imageUrl && (
              <>
                <button
                  id="btn-save-perm-welcome-bg"
                  type="button"
                  onClick={handleSavePermanent}
                  disabled={savingPermanent || uploadingImage}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-sm ${
                    permanentSaved
                      ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-500/80 shadow-emerald-950/40'
                      : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white border border-emerald-500/50 shadow-emerald-900/30'
                  }`}
                  title="Save permanently to Cloud Firestore database and persistent asset store"
                >
                  {savingPermanent ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to DB...</span>
                    </>
                  ) : permanentSaved ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-bold">Saved Permanently ✓</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 text-emerald-200" />
                      <span>Save Permanently</span>
                    </>
                  )}
                </button>

                <button
                  id="btn-remove-welcome-bg"
                  type="button"
                  onClick={handleRemoveImage}
                  disabled={uploadingImage || savingPermanent}
                  className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-900/60 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Remove background photo"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Adjustment Controls & Live Preview Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Controls Column (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* A. Image Fit Mode */}
            <div className="space-y-2">
              <label className="text-xs font-mono text-slate-300 font-semibold flex items-center justify-between">
                <span>Image Fit Mode</span>
                <span className="text-[10px] text-slate-500 font-normal">How photo scales</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['cover', 'contain', 'custom'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setConfig(prev => ({
                      ...prev,
                      welcomeBackground: { ...prev.welcomeBackground, fit: mode }
                    }))}
                    className={`py-2 px-3 rounded-xl text-xs font-mono font-medium capitalize border transition-all cursor-pointer ${
                      config.welcomeBackground?.fit === mode
                        ? 'bg-sky-600/30 text-sky-300 border-sky-500 shadow-sm'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* B. Zoom / Resize Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <ZoomIn className="w-3.5 h-3.5 text-sky-400" />
                  <span>Zoom / Scale</span>
                </span>
                <span className="text-sky-400 font-bold">{config.welcomeBackground?.zoom || 100}%</span>
              </div>
              <input
                id="slider-welcome-zoom"
                type="range"
                min="50"
                max="200"
                step="1"
                value={config.welcomeBackground?.zoom || 100}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, zoom: val }
                  }));
                }}
                className="w-full accent-sky-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-500">
                <span>50% (Wide)</span>
                <span>100% (Default)</span>
                <span>200% (Zoomed)</span>
              </div>
            </div>

            {/* C. Overlay Strength Slider */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span>Overlay Strength</span>
                </span>
                <span className="text-amber-400 font-bold">{config.welcomeBackground?.overlayStrength ?? 25}%</span>
              </div>
              <input
                id="slider-welcome-overlay"
                type="range"
                min="0"
                max="85"
                step="1"
                value={config.welcomeBackground?.overlayStrength ?? 25}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, overlayStrength: val }
                  }));
                }}
                className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
              />
              <p className="text-[11px] text-slate-400 font-sans">
                {config.welcomeBackground?.overlayStrength <= 30 ? (
                  <span className="text-emerald-400 font-medium">✓ Light &amp; subtle: photo is clearly visible with crisp white typography.</span>
                ) : (
                  <span className="text-slate-400">Darker overlay applied for higher text contrast.</span>
                )}
              </p>
            </div>

            {/* D. Position X & Y Sliders & Presets */}
            <div className="space-y-3">
              <label className="text-xs font-mono text-slate-300 font-semibold flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Move className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Position Coordinates</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  X: {config.welcomeBackground?.positionX ?? 50}% • Y: {config.welcomeBackground?.positionY ?? 50}%
                </span>
              </label>

              {/* Sliders */}
              <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-2xl border border-slate-800/80">
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>Horizontal (X): Left ← Center → Right</span>
                    <span className="text-indigo-300 font-bold">{config.welcomeBackground?.positionX ?? 50}%</span>
                  </div>
                  <input
                    id="slider-welcome-pos-x"
                    type="range"
                    min="0"
                    max="100"
                    value={config.welcomeBackground?.positionX ?? 50}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setConfig(prev => ({
                        ...prev,
                        welcomeBackground: { ...prev.welcomeBackground, positionX: val }
                      }));
                    }}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="space-y-1 pt-2">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400">
                    <span>Vertical (Y): Top ↑ Center ↓ Bottom</span>
                    <span className="text-indigo-300 font-bold">{config.welcomeBackground?.positionY ?? 50}%</span>
                  </div>
                  <input
                    id="slider-welcome-pos-y"
                    type="range"
                    min="0"
                    max="100"
                    value={config.welcomeBackground?.positionY ?? 50}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      setConfig(prev => ({
                        ...prev,
                        welcomeBackground: { ...prev.welcomeBackground, positionY: val }
                      }));
                    }}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>

              {/* Quick Alignment Buttons */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 0, positionY: 50 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer"
                >
                  Align Left
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 50, positionY: 50 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer"
                >
                  Center Center
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 100, positionY: 50 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer"
                >
                  Align Right
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 50, positionY: 0 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer"
                >
                  Align Top
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 50, positionY: 50, zoom: 100, overlayStrength: 25 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-sky-950/60 hover:bg-sky-900/60 border border-sky-800/80 text-[10px] font-mono text-sky-300 font-semibold cursor-pointer"
                >
                  Reset Defaults
                </button>
                <button
                  type="button"
                  onClick={() => setConfig(prev => ({
                    ...prev,
                    welcomeBackground: { ...prev.welcomeBackground, positionX: 50, positionY: 100 }
                  }))}
                  className="py-1.5 px-2 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-mono text-slate-300 cursor-pointer"
                >
                  Align Bottom
                </button>
              </div>

            </div>

          </div>

          {/* Live Preview Column (7 cols) */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-300 font-semibold flex items-center gap-1.5">
                <Eye className="w-3.5 h-3.5 text-emerald-400" />
                <span>Live Welcome Screen Preview</span>
              </span>
              <span className="text-[10px] text-slate-400">
                Interactive Drag Box (Click &amp; Drag inside to position)
              </span>
            </div>

            {/* Simulated Public Hero Mockup */}
            <div 
              ref={dragBoxRef}
              onMouseDown={handleDragBoxMouseDown}
              className="relative w-full h-[340px] sm:h-[380px] rounded-2xl overflow-hidden border-2 border-slate-700 bg-slate-950 shadow-2xl select-none cursor-move group"
            >
              {/* Background Photo with exact transformations */}
              {config.welcomeBackground?.imageUrl ? (
                <div className="absolute inset-0 w-full h-full pointer-events-none">
                  <img
                    src={config.welcomeBackground.imageUrl}
                    alt="Welcome Preview"
                    referrerPolicy="no-referrer"
                    style={{
                      objectFit: config.welcomeBackground.fit === 'contain' ? 'contain' : config.welcomeBackground.fit === 'custom' ? 'fill' : 'cover',
                      objectPosition: `${config.welcomeBackground.positionX ?? 50}% ${config.welcomeBackground.positionY ?? 50}%`,
                      transform: `scale(${(config.welcomeBackground.zoom || 100) / 100})`,
                      transformOrigin: `${config.welcomeBackground.positionX ?? 50}% ${config.welcomeBackground.positionY ?? 50}%`,
                      transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                    }}
                    className="w-full h-full"
                  />
                  {/* Overlay strength based on slider */}
                  <div 
                    className="absolute inset-0 bg-[#080d17]"
                    style={{
                      opacity: (config.welcomeBackground.overlayStrength ?? 25) / 100
                    }}
                  />
                  {/* Subtle edge vignette for readability */}
                  <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60 pointer-events-none" />
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 font-mono text-xs p-6 text-center space-y-2">
                  <ImageIcon className="w-8 h-8 opacity-40" />
                  <span>No background photo uploaded yet.</span>
                  <span className="text-[10px] text-slate-600">Upload an image to see live positioning preview.</span>
                </div>
              )}

              {/* Crosshair indicator showing position anchor */}
              <div 
                className="absolute w-5 h-5 -ml-2.5 -mt-2.5 rounded-full border-2 border-sky-400 bg-sky-500/30 pointer-events-none shadow-lg opacity-80 group-hover:opacity-100 transition-opacity"
                style={{
                  left: `${config.welcomeBackground?.positionX ?? 50}%`,
                  top: `${config.welcomeBackground?.positionY ?? 50}%`
                }}
              />

              {/* Real-time typography overlay (exact replica of public homepage) */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 pointer-events-none">
                <h1 className="font-display text-2xl sm:text-4xl font-bold tracking-tight text-white leading-tight mb-2 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                  INK <span className="text-slate-300 font-light">&amp;</span> WITNESS
                </h1>
                <p className="font-serif italic text-xs sm:text-sm text-slate-100 font-light max-w-md mx-auto leading-relaxed mb-2 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
                  “I write because the heart keeps a ledger the tongue is too proud to read.”
                </p>
                <p className="text-[10px] sm:text-xs text-slate-200 font-sans max-w-sm mx-auto drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
                  An archive of lived experience, intimacy, power, and memory.
                </p>
              </div>

              {/* Badge in corner */}
              <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700 text-[10px] font-mono text-slate-300 backdrop-blur-md">
                Fit: {config.welcomeBackground?.fit} • Zoom: {config.welcomeBackground?.zoom}% • Overlay: {config.welcomeBackground?.overlayStrength}%
              </div>
            </div>

            <p className="text-[11px] text-slate-400 font-mono">
              💡 Tip: Click and drag anywhere on the preview above to dynamically adjust the photograph alignment.
            </p>

          </div>

        </div>
      </section>
      )}

      {/* ============================================================ */}
      {/* 2. BANNERS & HERO TYPOGRAPHY MANAGER */}
      {/* ============================================================ */}
      {(activeSubTab === 'overview' || activeSubTab === 'banners') && (
      <section id="section-banners-manager" className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-indigo-400 uppercase tracking-wider mb-1">
              <Sparkles className="w-4 h-4" />
              <span>Section 2 • Announcement Banners &amp; Hero Typography</span>
            </div>
            <h3 className="font-display font-bold text-xl text-white">
              Announcement Banners &amp; Hero Text
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Display customizable announcement banners at the top of the homepage and adjust hero headlines, quotes, and badges.
            </p>
          </div>
        </div>

        {/* Banners List & Configuration */}
        <div className="space-y-6">
          <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-5">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <h4 className="text-sm font-semibold text-white flex items-center gap-2">
                  <span>Top Announcement Banner</span>
                  {config.banners?.[0]?.isVisible ? (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                      Active on Live Site
                    </span>
                  ) : (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
                      Hidden
                    </span>
                  )}
                </h4>
                <p className="text-xs text-slate-400 font-sans">
                  Promote new monographs, subscriber discounts, or reading announcements in a prominent bar above the hero.
                </p>
              </div>

              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.banners?.[0]?.isVisible ?? false}
                  onChange={(e) => {
                    const isVisible = e.target.checked;
                    setConfig(prev => {
                      const curBanners = prev.banners ? [...prev.banners] : [];
                      if (curBanners.length === 0) {
                        curBanners.push({
                          id: 'banner-01',
                          text: 'New Monograph is now live.',
                          linkText: 'Read Now',
                          linkUrl: '#all-pieces',
                          bgStyle: 'sky',
                          isVisible
                        });
                      } else {
                        curBanners[0] = { ...curBanners[0], isVisible };
                      }
                      return { ...prev, banners: curBanners };
                    });
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            {config.banners?.[0]?.isVisible && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800/80">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-mono text-slate-300">Banner Announcement Text</label>
                  <input
                    type="text"
                    value={config.banners[0]?.text || ''}
                    onChange={(e) => {
                      const text = e.target.value;
                      setConfig(prev => {
                        const curBanners = prev.banners ? [...prev.banners] : [];
                        if (curBanners.length === 0) {
                          curBanners.push({ id: 'banner-01', text, isVisible: true, bgStyle: 'sky' });
                        } else {
                          curBanners[0] = { ...curBanners[0], text };
                        }
                        return { ...prev, banners: curBanners };
                      });
                    }}
                    placeholder="e.g. New Monograph: The Architecture of Sovereignty is now live."
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-slate-300">Action Button Label (Optional)</label>
                  <input
                    type="text"
                    value={config.banners[0]?.linkText || ''}
                    onChange={(e) => {
                      const linkText = e.target.value;
                      setConfig(prev => {
                        const curBanners = prev.banners ? [...prev.banners] : [];
                        if (curBanners.length === 0) {
                          curBanners.push({ id: 'banner-01', text: '', linkText, isVisible: true });
                        } else {
                          curBanners[0] = { ...curBanners[0], linkText };
                        }
                        return { ...prev, banners: curBanners };
                      });
                    }}
                    placeholder="e.g. Read Monograph"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-slate-300">Action Link Target / URL</label>
                  <input
                    type="text"
                    value={config.banners[0]?.linkUrl || ''}
                    onChange={(e) => {
                      const linkUrl = e.target.value;
                      setConfig(prev => {
                        const curBanners = prev.banners ? [...prev.banners] : [];
                        if (curBanners.length === 0) {
                          curBanners.push({ id: 'banner-01', text: '', linkUrl, isVisible: true });
                        } else {
                          curBanners[0] = { ...curBanners[0], linkUrl };
                        }
                        return { ...prev, banners: curBanners };
                      });
                    }}
                    placeholder="e.g. #all-pieces or #piece-the-architecture-of-sovereignty"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-mono text-slate-300">Banner Color Style</label>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { id: 'sky', label: 'Sky Blue', bg: 'bg-sky-950 border-sky-800 text-sky-300' },
                      { id: 'indigo', label: 'Indigo Royal', bg: 'bg-indigo-950 border-indigo-800 text-indigo-300' },
                      { id: 'amber', label: 'Amber Gold', bg: 'bg-amber-950 border-amber-800 text-amber-300' },
                      { id: 'emerald', label: 'Emerald Green', bg: 'bg-emerald-950 border-emerald-800 text-emerald-300' }
                    ].map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setConfig(prev => {
                            const curBanners = prev.banners ? [...prev.banners] : [];
                            if (curBanners.length > 0) {
                              curBanners[0] = { ...curBanners[0], bgStyle: st.id as any };
                            }
                            return { ...prev, banners: curBanners };
                          });
                        }}
                        className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${st.bg} ${
                          config.banners?.[0]?.bgStyle === st.id ? 'ring-2 ring-white font-bold' : 'opacity-80 hover:opacity-100'
                        }`}
                      >
                        {st.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Hero Headlines & Quotes */}
          <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-4">
            <h4 className="text-sm font-semibold text-white">Hero Typography &amp; Headlines</h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-300">Hero Main Headline</label>
                <input
                  type="text"
                  value={config.heroHeadline || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, heroHeadline: e.target.value }))}
                  placeholder="e.g. INK & WITNESS"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-display font-bold tracking-wider"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-mono text-slate-300">Hero Badge Pill</label>
                <input
                  type="text"
                  value={config.heroBadge || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, heroBadge: e.target.value }))}
                  placeholder="e.g. Ink & Witness Narratives"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-mono text-slate-300">Author Quote / Epigraph</label>
                <input
                  type="text"
                  value={config.heroQuote || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, heroQuote: e.target.value }))}
                  placeholder="e.g. “I write because the heart keeps a ledger the tongue is too proud to read.”"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-serif italic"
                />
              </div>

              <div className="space-y-1.5 md:col-span-2">
                <label className="text-xs font-mono text-slate-300">Hero Subheadline / Archive Description</label>
                <textarea
                  rows={2}
                  value={config.heroSubheadline || ''}
                  onChange={(e) => setConfig(prev => ({ ...prev, heroSubheadline: e.target.value }))}
                  placeholder="e.g. An archive of lived experience, intimacy, power, and memory authored by Jake."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 font-sans resize-none"
                />
              </div>
            </div>
          </div>
        </div>
      </section>
      )}

      {/* ============================================================ */}
      {/* 3. SECTION VISIBILITY & ORDERING */}
      {/* ============================================================ */}
      {(activeSubTab === 'overview' || activeSubTab === 'sections') && (
      <section id="section-layout-ordering" className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 uppercase tracking-wider mb-1">
              <Sliders className="w-4 h-4" />
              <span>Section 3 • Section Configuration &amp; Visibility</span>
            </div>
            <h3 className="font-display font-bold text-xl text-white">
              Homepage Sections &amp; Ordering
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Toggle visibility and arrange homepage components to curate reader discovery.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(config.sections || [
            { id: 'piece_of_the_week', title: 'Piece of the Week', isVisible: true, order: 1 },
            { id: 'most_selling', title: 'Most Selling Pieces', isVisible: true, order: 2 },
            { id: 'latest', title: 'Latest from the Ink', isVisible: true, order: 3 },
            { id: 'catalogue', title: 'Explore Full Catalogue', isVisible: true, order: 4 },
            { id: 'patronage', title: 'Patronage & Reader Support', isVisible: true, order: 5 }
          ]).map((sec, idx) => (
            <div key={sec.id} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-mono text-slate-500">#{idx + 1}</span>
                <h5 className="text-xs font-semibold text-slate-200">{sec.title || sec.id}</h5>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={sec.isVisible}
                  onChange={(e) => {
                    const isVisible = e.target.checked;
                    setConfig(prev => {
                      const sections = (prev.sections || []).map(s => s.id === sec.id ? { ...s, isVisible } : s);
                      return { ...prev, sections };
                    });
                  }}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
              </label>
            </div>
          ))}
        </div>
      </section>
      )}

      {/* ============================================================ */}
      {/* 4. MOST SELLING PIECES (3 CURATED PIECES) */}
      {/* ============================================================ */}
      {(activeSubTab === 'overview' || activeSubTab === 'sections') && (
      <section id="section-most-selling-manager" className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-amber-400 uppercase tracking-wider mb-1">
              <Flame className="w-4 h-4" />
              <span>Section 2 • Most Selling Pieces</span>
            </div>
            <h3 className="font-display font-bold text-xl text-white">
              Curated “Most Selling Pieces” (3 Slots)
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Manually select exactly 3 published pieces to showcase in the high-traffic grid immediately below the welcome screen.
            </p>
          </div>
        </div>

        {/* 3 Slots Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[0, 1, 2].map((slotIdx) => {
            const articleId = config.mostSellingPieceIds?.[slotIdx];
            const piece = articleId ? getArticleById(articleId) : null;

            return (
              <div 
                key={slotIdx}
                className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between space-y-4 relative group hover:border-slate-700 transition-colors"
              >
                <div className="space-y-3">
                  {/* Slot Header */}
                  <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                    <span className="text-xs font-mono font-bold text-amber-400 flex items-center gap-1.5">
                      <span>Slot #{slotIdx + 1}</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      {piece ? (piece.status === 'published' ? 'Published' : 'Draft') : 'Empty Slot'}
                    </span>
                  </div>

                  {/* Piece Card / Preview */}
                  {piece ? (
                    <div className="space-y-2.5">
                      <div className="relative h-28 w-full rounded-xl overflow-hidden bg-slate-900 border border-slate-800">
                        <img 
                          src={piece.coverImage || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=600&q=80"} 
                          alt={piece.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono text-sky-400 border border-slate-800">
                          {piece.category}
                        </div>
                        <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-emerald-950/90 text-[10px] font-mono text-emerald-300 border border-emerald-800 font-bold">
                          KES {piece.priceKes}
                        </div>
                      </div>

                      <h4 className="font-display font-bold text-sm text-white line-clamp-1">
                        {piece.title}
                      </h4>
                      <p className="text-xs text-slate-400 font-sans line-clamp-2">
                        {piece.excerpt}
                      </p>
                    </div>
                  ) : (
                    <div className="h-40 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 text-xs font-mono p-4 text-center">
                      <span>No piece selected</span>
                      <span className="text-[10px] text-slate-600 mt-1">Click below to assign a piece</span>
                    </div>
                  )}
                </div>

                {/* Change Button */}
                <button
                  id={`btn-select-most-selling-${slotIdx}`}
                  type="button"
                  onClick={() => setActivePickerSlot({ type: 'mostSelling', slotIndex: slotIdx })}
                  className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-sky-400" />
                  <span>{piece ? 'Replace Piece' : 'Select Piece'}</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>
      )}

      {/* ============================================================ */}
      {/* 5. PIECE OF THE WEEK (1 CURATED PIECE) */}
      {/* ============================================================ */}
      {(activeSubTab === 'overview' || activeSubTab === 'sections') && (
      <section id="section-piece-of-week-manager" className="p-6 sm:p-8 rounded-3xl bg-slate-900/60 border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-mono text-sky-400 uppercase tracking-wider mb-1">
              <Sparkles className="w-4 h-4" />
              <span>Section 3 • Piece of the Week</span>
            </div>
            <h3 className="font-display font-bold text-xl text-white">
              Curated “Piece of the Week” (1 Featured Spotlight)
            </h3>
            <p className="text-xs text-slate-400 mt-1 font-sans">
              Select one single monograph to feature as this week’s flagship recommendation with large prominent editorial presentation.
            </p>
          </div>
        </div>

        {(() => {
          const piece = config.pieceOfTheWeekId ? getArticleById(config.pieceOfTheWeekId) : null;

          return (
            <div className="p-6 rounded-2xl bg-slate-950/80 border border-slate-800 grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              
              {/* Preview Thumbnail */}
              <div className="lg:col-span-4">
                {piece ? (
                  <div className="relative h-48 sm:h-56 rounded-xl overflow-hidden border border-slate-700 bg-slate-900">
                    <img 
                      src={piece.coverImage || "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=800&q=80"} 
                      alt={piece.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded bg-sky-950/90 text-xs font-mono text-sky-300 border border-sky-800">
                      {piece.category}
                    </div>
                    <div className="absolute top-3 right-3 px-2.5 py-1 rounded bg-emerald-950/90 text-xs font-mono text-emerald-300 border border-emerald-800 font-bold">
                      KES {piece.priceKes}
                    </div>
                  </div>
                ) : (
                  <div className="h-48 rounded-xl border border-dashed border-slate-800 flex flex-col items-center justify-center text-slate-500 text-xs font-mono">
                    <span>No piece selected</span>
                  </div>
                )}
              </div>

              {/* Details & Select Button */}
              <div className="lg:col-span-8 space-y-4">
                {piece ? (
                  <>
                    <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
                      <span>{piece.readTimeMinutes} min read</span>
                      <span>•</span>
                      <span>Published on {piece.publishedAt}</span>
                    </div>

                    <h4 className="font-display font-bold text-xl sm:text-2xl text-white">
                      {piece.title}
                    </h4>

                    {piece.subtitle && (
                      <p className="font-serif italic text-sm text-slate-300">
                        {piece.subtitle}
                      </p>
                    )}

                    <p className="text-xs sm:text-sm text-slate-400 font-sans line-clamp-3">
                      {piece.excerpt}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-400">
                    Please select a published article to serve as the editorial Piece of the Week.
                  </p>
                )}

                <div className="pt-2">
                  <button
                    id="btn-select-piece-of-week"
                    type="button"
                    onClick={() => setActivePickerSlot({ type: 'pieceOfTheWeek' })}
                    className="px-6 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 text-xs font-semibold flex items-center gap-2 transition-colors cursor-pointer"
                  >
                    <Search className="w-4 h-4 text-sky-400" />
                    <span>{piece ? 'Change Piece of the Week' : 'Select Piece of the Week'}</span>
                  </button>
                </div>

              </div>

            </div>
          );
        })()}
      </section>
      )}

      {/* Bottom Save Bar */}
      <div className="flex items-center justify-between pt-6 border-t border-slate-800">
        <p className="text-xs text-slate-500 font-mono">
          Changes will reflect immediately on the live public homepage upon saving.
        </p>

        <SaveStatusBar
          idPrefix="homepage-inline-bottom"
          onSave={handleSave}
          isDirty={isDirty}
          isSaving={saving}
          lastSavedAt={lastSavedAt}
          errorMessage={error}
          saveButtonText="SAVE HOMEPAGE CHANGES"
        />
      </div>

      {/* ============================================================ */}
      {/* ARTICLE PICKER MODAL */}
      {/* ============================================================ */}
      {activePickerSlot && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 animate-in fade-in duration-200">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-700 rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            
            {/* Modal Header */}
            <div className="p-5 sm:p-6 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div>
                <h3 className="font-display font-bold text-lg text-white">
                  Select Published Piece
                </h3>
                <p className="text-xs text-slate-400 font-sans mt-0.5">
                  {activePickerSlot.type === 'mostSelling' 
                    ? `Assigning to Most Selling Pieces (Slot #${(activePickerSlot.slotIndex || 0) + 1})`
                    : 'Assigning to Piece of the Week'}
                </p>
              </div>

              <button
                onClick={() => setActivePickerSlot(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="p-4 border-b border-slate-800/80 bg-slate-900">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search pieces by title, category, or subtitle..."
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>
            </div>

            {/* Pieces List */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-3 flex-1">
              {filteredPickerArticles.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-mono text-xs">
                  No published pieces match your search.
                </div>
              ) : (
                filteredPickerArticles.map((article) => {
                  const isAlreadySelected = 
                    (config.mostSellingPieceIds || []).includes(article.id) ||
                    config.pieceOfTheWeekId === article.id;

                  return (
                    <div
                      key={article.id}
                      onClick={() => handleSelectPiece(article.id)}
                      className="p-3.5 rounded-2xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800 hover:border-sky-500/50 flex items-center justify-between gap-4 cursor-pointer transition-all group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={article.coverImage || "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=200&q=80"}
                          alt={article.title}
                          referrerPolicy="no-referrer"
                          className="w-14 h-14 rounded-xl object-cover border border-slate-800 shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-sky-950 text-sky-400 border border-sky-800">
                              {article.category}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400">
                              KES {article.priceKes}
                            </span>
                            {isAlreadySelected && (
                              <span className="text-[10px] font-mono text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/60">
                                Current Selection
                              </span>
                            )}
                          </div>
                          <h4 className="font-display font-bold text-sm text-slate-100 group-hover:text-sky-300 truncate">
                            {article.title}
                          </h4>
                          <p className="text-xs text-slate-400 truncate font-sans">
                            {article.subtitle || article.excerpt}
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        className="px-3.5 py-2 rounded-xl bg-sky-600 group-hover:bg-sky-500 text-white text-xs font-semibold shrink-0 transition-colors"
                      >
                        Choose
                      </button>
                    </div>
                  );
                })
              )}
            </div>

          </div>
        </div>
      )}

      {/* Sticky Bottom Save Status Bar */}
      <div className="sticky bottom-4 z-40">
        <SaveStatusBar
          idPrefix="homepage-bottom"
          onSave={handleSave}
          isDirty={isDirty}
          isSaving={saving}
          lastSavedAt={lastSavedAt}
          errorMessage={error}
          saveButtonText="SAVE HOMEPAGE CONFIGURATION"
        />
      </div>

    </div>
  );
};

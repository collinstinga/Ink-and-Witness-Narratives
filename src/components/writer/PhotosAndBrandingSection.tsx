import React, { useState, useRef } from 'react';
import { 
  Camera, 
  Image as ImageIcon, 
  Upload, 
  Trash2, 
  Check, 
  AlertCircle, 
  Loader2, 
  FileText, 
  Sparkles,
  Layers,
  Globe,
  User,
  Shield,
  Eye,
  Crop,
  Database,
  CheckCircle2
} from 'lucide-react';
import { Article, AuthorProfile } from '../../types.js';
import { api } from '../../utils/api.js';
import { applyFavicon } from '../../utils/favicon.js';
import { ImageCropModal, CropSettings } from './ImageCropModal.js';

interface PhotosAndBrandingSectionProps {
  author: AuthorProfile;
  pieces: Article[];
  onAuthorUpdated: (updated: AuthorProfile) => void;
  onPiecesUpdated?: (updated: Article[]) => void;
}

type UploadTarget = 'author_avatar' | 'author_cover' | 'welcome_background' | 'favicon' | 'logo' | 'piece_cover';

export const PhotosAndBrandingSection: React.FC<PhotosAndBrandingSectionProps> = ({
  author,
  pieces,
  onAuthorUpdated,
  onPiecesUpdated
}) => {
  // Selected piece for Piece Cover Photos manager
  const [selectedPieceId, setSelectedPieceId] = useState<string>(pieces[0]?.id || '');
  const selectedPiece = pieces.find(p => p.id === selectedPieceId) || pieces[0];

  // Uploading and status states for each card
  const [uploadingTarget, setUploadingTarget] = useState<UploadTarget | null>(null);
  const [savingPermanentTarget, setSavingPermanentTarget] = useState<UploadTarget | null>(null);
  const [permanentSuccessTarget, setPermanentSuccessTarget] = useState<UploadTarget | null>(null);
  const [successMessage, setSuccessMessage] = useState<{ target: UploadTarget; text: string } | null>(null);
  const [errorMessage, setErrorMessage] = useState<{ target: UploadTarget; text: string } | null>(null);

  // Hidden file inputs
  const welcomeBgInputRef = useRef<HTMLInputElement>(null);
  const authorPhotoInputRef = useRef<HTMLInputElement>(null);
  const authorCoverInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const pieceCoverInputRef = useRef<HTMLInputElement>(null);

  // Image Cropping Modal State
  const [cropModalOpen, setCropModalOpen] = useState(false);
  const [cropImageUrl, setCropImageUrl] = useState('');
  const [cropInitialSettings, setCropInitialSettings] = useState<CropSettings | undefined>(undefined);
  const [cropTargetInfo, setCropTargetInfo] = useState<{ target: UploadTarget; articleId?: string; originalUrl?: string } | null>(null);

  const showSuccess = (target: UploadTarget, text: string) => {
    setSuccessMessage({ target, text });
    setTimeout(() => {
      setSuccessMessage(null);
    }, 4000);
  };

  const showError = (target: UploadTarget, text: string) => {
    setErrorMessage({ target, text });
    setTimeout(() => {
      setErrorMessage(null);
    }, 5000);
  };

  // Save Permanently into Database & Persistent Storage
  const handleSavePermanently = async (target: UploadTarget, articleId?: string) => {
    let imageUrl = '';
    let extraData: any = {};

    if (target === 'welcome_background') {
      imageUrl = author.welcomeBackgroundUrl || '';
    } else if (target === 'author_avatar') {
      imageUrl = author.avatarUrl || '';
    } else if (target === 'author_cover') {
      imageUrl = author.coverPhotoUrl || '';
    } else if (target === 'favicon') {
      imageUrl = author.faviconUrl || '';
    } else if (target === 'logo') {
      imageUrl = author.logoUrl || '';
    } else if (target === 'piece_cover' && selectedPiece) {
      imageUrl = selectedPiece.coverImage || '';
      extraData.cropSettings = selectedPiece.coverImageCrop;
      extraData.originalUrl = selectedPiece.coverImageOriginal;
    }

    if (!imageUrl) {
      showError(target, 'Please upload an image first before saving permanently.');
      return;
    }

    setSavingPermanentTarget(target);
    setErrorMessage(null);

    try {
      const res = await api.savePermanentImage(target, imageUrl, articleId, extraData);
      if (res.success) {
        setPermanentSuccessTarget(target);
        showSuccess(target, 'Saved permanently in database & storage! Intact across refreshes and resets.');

        if (target === 'welcome_background') {
          onAuthorUpdated({
            ...author,
            welcomeBackgroundUrl: res.url,
            welcomeBackgroundSavedPermanently: true,
            welcomeBackgroundSavedAt: res.savedAt
          });
        } else if (target === 'author_avatar') {
          onAuthorUpdated({
            ...author,
            avatarUrl: res.url,
            avatarSavedPermanently: true,
            avatarSavedAt: res.savedAt
          });
        } else if (target === 'author_cover') {
          onAuthorUpdated({
            ...author,
            coverPhotoUrl: res.url,
            coverPhotoSavedPermanently: true,
            coverPhotoSavedAt: res.savedAt
          });
        } else if (target === 'favicon') {
          onAuthorUpdated({
            ...author,
            faviconUrl: res.url,
            faviconSavedPermanently: true,
            faviconSavedAt: res.savedAt
          });
          applyFavicon(res.url);
        } else if (target === 'logo') {
          onAuthorUpdated({
            ...author,
            logoUrl: res.url,
            logoSavedPermanently: true,
            logoSavedAt: res.savedAt
          });
        } else if (target === 'piece_cover' && articleId && onPiecesUpdated) {
          const updatedPieces = pieces.map(p => 
            p.id === articleId ? {
              ...p,
              coverImage: res.url,
              coverImageSavedPermanently: true,
              coverImageSavedAt: res.savedAt
            } : p
          );
          onPiecesUpdated(updatedPieces);
        }

        setTimeout(() => {
          setPermanentSuccessTarget(null);
        }, 6000);
      }
    } catch (err: any) {
      showError(target, err.message || 'Failed to save permanently.');
    } finally {
      setSavingPermanentTarget(null);
    }
  };

  // Generic File Reader and Uploader
  const handleFileSelected = (
    e: React.ChangeEvent<HTMLInputElement>,
    target: UploadTarget,
    articleId?: string
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 15MB)
    if (file.size > 15 * 1024 * 1024) {
      showError(target, 'Image file exceeds 15MB size limit.');
      e.target.value = '';
      return;
    }

    // Validate types
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml', 'image/gif', 'image/x-icon', 'image/vnd.microsoft.icon'];
    if (!validTypes.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|webp|svg|gif|ico)$/i)) {
      showError(target, 'Invalid format. Supported: JPG, PNG, WebP, SVG, GIF, ICO.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    setUploadingTarget(target);
    setErrorMessage(null);

    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        showError(target, 'Failed to read image file.');
        setUploadingTarget(null);
        return;
      }

      try {
        const res = await api.uploadImage(dataUrl, target, articleId);
        if (res.success) {
          showSuccess(target, 'Uploaded & saved to storage. Click "Save Permanently" to lock into database.');

          if (target === 'author_avatar') {
            const updated = { ...author, avatarUrl: res.url, avatarSavedPermanently: true, avatarSavedAt: new Date().toISOString() };
            onAuthorUpdated(updated);
          } else if (target === 'author_cover') {
            const updated = { ...author, coverPhotoUrl: res.url, coverPhotoSavedPermanently: true, coverPhotoSavedAt: new Date().toISOString() };
            onAuthorUpdated(updated);
          } else if (target === 'welcome_background') {
            const updated = { ...author, welcomeBackgroundUrl: res.url, welcomeBackgroundSavedPermanently: true, welcomeBackgroundSavedAt: new Date().toISOString() };
            onAuthorUpdated(updated);
          } else if (target === 'favicon') {
            const updated = { ...author, faviconUrl: res.url, faviconSavedPermanently: true, faviconSavedAt: new Date().toISOString() };
            onAuthorUpdated(updated);
            applyFavicon(res.url);
          } else if (target === 'logo') {
            const updated = { ...author, logoUrl: res.url, logoSavedPermanently: true, logoSavedAt: new Date().toISOString() };
            onAuthorUpdated(updated);
          } else if (target === 'piece_cover' && articleId) {
            if (onPiecesUpdated) {
              const updatedPieces = pieces.map(p => 
                p.id === articleId ? { ...p, coverImage: res.url, coverImageSavedPermanently: true, coverImageSavedAt: new Date().toISOString() } : p
              );
              onPiecesUpdated(updatedPieces);
            }
          }
        }
      } catch (err: any) {
        showError(target, err.message || 'Upload failed. Please try again.');
      } finally {
        setUploadingTarget(null);
        e.target.value = '';
      }
    };

    reader.onerror = () => {
      showError(target, 'Error reading file.');
      setUploadingTarget(null);
      e.target.value = '';
    };

    reader.readAsDataURL(file);
  };

  // Remove handler
  const handleRemove = async (target: UploadTarget, articleId?: string) => {
    if (!window.confirm('Are you sure you want to remove this photo?')) {
      return;
    }

    setUploadingTarget(target);
    setErrorMessage(null);

    try {
      const res = await api.removeImage(target, articleId);
      if (res.success) {
        showSuccess(target, 'Photo removed and permanent database record cleared');

        if (target === 'author_avatar') {
          const updated = { ...author };
          delete updated.avatarUrl;
          updated.avatarSavedPermanently = false;
          onAuthorUpdated(updated);
        } else if (target === 'author_cover') {
          const updated = { ...author };
          delete updated.coverPhotoUrl;
          updated.coverPhotoSavedPermanently = false;
          onAuthorUpdated(updated);
        } else if (target === 'welcome_background') {
          const updated = { ...author };
          delete updated.welcomeBackgroundUrl;
          updated.welcomeBackgroundSavedPermanently = false;
          onAuthorUpdated(updated);
        } else if (target === 'favicon') {
          const updated = { ...author };
          delete updated.faviconUrl;
          updated.faviconSavedPermanently = false;
          onAuthorUpdated(updated);
          applyFavicon(null);
        } else if (target === 'logo') {
          const updated = { ...author };
          delete updated.logoUrl;
          updated.logoSavedPermanently = false;
          onAuthorUpdated(updated);
        } else if (target === 'piece_cover' && articleId) {
          if (onPiecesUpdated) {
            const updatedPieces = pieces.map(p => {
              if (p.id === articleId) {
                const copy = { ...p };
                delete copy.coverImage;
                delete copy.coverImageCrop;
                delete copy.coverImageOriginal;
                copy.coverImageSavedPermanently = false;
                return copy;
              }
              return p;
            });
            onPiecesUpdated(updatedPieces);
          }
        }
      }
    } catch (err: any) {
      showError(target, err.message || 'Failed to remove image.');
    } finally {
      setUploadingTarget(null);
    }
  };

  return (
    <div id="photos-and-branding-section" className="space-y-8">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-serif font-bold text-white tracking-tight">
              Photos &amp; Branding
            </h2>
            <span className="px-2.5 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider bg-emerald-950/80 text-emerald-400 border border-emerald-800/50 flex items-center gap-1">
              <Database className="w-3 h-3" />
              <span>Persistent Storage Active</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Manage your welcome screen background, author photo, author cover photo, website icon, site logo, and monograph covers with guaranteed permanent database saving.
          </p>
        </div>
      </div>

      {/* Hidden File Inputs */}
      <input
        ref={welcomeBgInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'welcome_background')}
      />
      <input
        ref={authorPhotoInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'author_avatar')}
      />
      <input
        ref={authorCoverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'author_cover')}
      />
      <input
        ref={faviconInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,image/webp,image/jpeg"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'favicon')}
      />
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/jpeg"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'logo')}
      />
      <input
        ref={pieceCoverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFileSelected(e, 'piece_cover', selectedPiece?.id)}
      />

      {/* Grid of Branding Image Controls */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* 1. Welcome Screen Background (Hero) */}
        <div id="welcome-background-setting-card" className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between shadow-lg md:col-span-2">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Welcome Screen Background</h3>
              </div>
              <div className="flex items-center gap-2">
                {author.welcomeBackgroundUrl && (
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Saved Permanently</span>
                  </span>
                )}
                <span className="text-[11px] font-mono text-sky-400 bg-sky-950/80 border border-sky-800/50 px-2 py-0.5 rounded">Homepage Hero Backdrop</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Large photographic background for the public welcome / hero section on the homepage.
            </p>

            {/* Preview Box */}
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800/80 mb-4">
              <div className="w-full h-36 sm:h-48 rounded-lg bg-slate-900 overflow-hidden flex items-center justify-center relative border border-slate-800">
                {author.welcomeBackgroundUrl ? (
                  <>
                    <img
                      src={author.welcomeBackgroundUrl}
                      alt="Welcome Screen Background"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0b101b]/80 via-transparent to-black/40 pointer-events-none" />
                    <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded bg-slate-900/85 backdrop-blur-sm border border-slate-800 text-[11px] font-mono text-slate-200 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                      <span>Active Welcome Background</span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 text-slate-600 text-xs font-mono p-4 text-center">
                    <ImageIcon className="w-6 h-6" />
                    <span>No background photo uploaded</span>
                    <span className="text-[10px] text-slate-500 font-sans">Using default plain editorial background</span>
                  </div>
                )}
              </div>
            </div>

            {/* Status Messages */}
            {uploadingTarget === 'welcome_background' && (
              <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading background photograph...</span>
              </div>
            )}
            {savingPermanentTarget === 'welcome_background' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving permanently to persistent database...</span>
              </div>
            )}
            {permanentSuccessTarget === 'welcome_background' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 p-2.5 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="font-semibold">Saved Permanently! Survives all refreshes and deployments.</span>
              </div>
            )}
            {successMessage?.target === 'welcome_background' && permanentSuccessTarget !== 'welcome_background' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3">
                <Check className="w-3.5 h-3.5" />
                <span>{successMessage.text}</span>
              </div>
            )}
            {errorMessage?.target === 'welcome_background' && (
              <div className="flex items-center gap-2 text-xs font-mono text-rose-400 mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage.text}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              id="upload-welcome-bg-btn"
              disabled={uploadingTarget !== null || savingPermanentTarget !== null}
              onClick={() => welcomeBgInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-sky-950"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{author.welcomeBackgroundUrl ? 'Change Photo' : 'Upload Background Photo'}</span>
            </button>

            {author.welcomeBackgroundUrl && (
              <>
                <button
                  type="button"
                  id="save-permanently-welcome-bg-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleSavePermanently('welcome_background')}
                  className="py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                  title="Store permanently into database and persistent cloud storage"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Save Permanently</span>
                </button>

                <button
                  type="button"
                  id="remove-welcome-bg-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleRemove('welcome_background')}
                  title="Remove welcome background"
                  className="py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors text-xs font-medium flex items-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* 2. Author Photo */}
        <div id="author-photo-setting-card" className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Author Photo</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {author.avatarUrl && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Saved Permanently</span>
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-500">Avatar</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Main photograph displayed in the About the Author showcase, header badges, and bio.
            </p>

            {/* Preview Box */}
            <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 mb-4">
              <div className="w-20 h-20 rounded-full bg-slate-900 border-2 border-slate-700 overflow-hidden flex items-center justify-center shrink-0 shadow-md">
                {author.avatarUrl ? (
                  <img
                    src={author.avatarUrl}
                    alt={author.name || 'Author'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="w-8 h-8 text-slate-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-slate-200 block truncate">
                  {author.avatarUrl ? 'Custom Author Photo Active' : 'No photo uploaded'}
                </span>
                <span className="text-[11px] font-mono text-slate-500 block truncate mt-0.5">
                  {author.avatarUrl ? author.avatarUrl : 'Default initial placeholder'}
                </span>
              </div>
            </div>

            {/* Status Messages */}
            {uploadingTarget === 'author_avatar' && (
              <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </div>
            )}
            {savingPermanentTarget === 'author_avatar' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving permanently to database...</span>
              </div>
            )}
            {permanentSuccessTarget === 'author_avatar' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">Saved Permanently</span>
              </div>
            )}
            {successMessage?.target === 'author_avatar' && permanentSuccessTarget !== 'author_avatar' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3">
                <Check className="w-3.5 h-3.5" />
                <span>{successMessage.text}</span>
              </div>
            )}
            {errorMessage?.target === 'author_avatar' && (
              <div className="flex items-center gap-2 text-xs font-mono text-rose-400 mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage.text}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              id="upload-author-photo-btn"
              disabled={uploadingTarget !== null || savingPermanentTarget !== null}
              onClick={() => authorPhotoInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-md shadow-sky-950"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{author.avatarUrl ? 'Change Photo' : 'Upload Photo'}</span>
            </button>

            {author.avatarUrl && (
              <>
                <button
                  type="button"
                  id="save-permanently-author-photo-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleSavePermanently('author_avatar')}
                  className="py-2.5 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                  title="Store permanently into database and persistent storage"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Save Permanently</span>
                </button>

                <button
                  type="button"
                  id="remove-author-photo-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleRemove('author_avatar')}
                  title="Remove photo"
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 3. Author Cover Photo */}
        <div id="author-cover-setting-card" className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Author Cover Photo</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {author.coverPhotoUrl && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Saved Permanently</span>
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-500">Backdrop</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Large backdrop photograph displayed in your About the Author showcase section.
            </p>

            {/* Preview Box */}
            <div className="p-2 rounded-xl bg-slate-950 border border-slate-800/80 mb-4">
              <div className="w-full h-20 rounded-lg bg-slate-900 overflow-hidden flex items-center justify-center relative border border-slate-800">
                {author.coverPhotoUrl ? (
                  <img
                    src={author.coverPhotoUrl}
                    alt="Author Cover"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex items-center gap-2 text-slate-600 text-xs font-mono">
                    <ImageIcon className="w-4 h-4" />
                    <span>No cover image uploaded</span>
                  </div>
                )}
              </div>
            </div>

            {/* Status Messages */}
            {uploadingTarget === 'author_cover' && (
              <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </div>
            )}
            {savingPermanentTarget === 'author_cover' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving permanently to database...</span>
              </div>
            )}
            {permanentSuccessTarget === 'author_cover' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">Saved Permanently</span>
              </div>
            )}
            {successMessage?.target === 'author_cover' && permanentSuccessTarget !== 'author_cover' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3">
                <Check className="w-3.5 h-3.5" />
                <span>{successMessage.text}</span>
              </div>
            )}
            {errorMessage?.target === 'author_cover' && (
              <div className="flex items-center gap-2 text-xs font-mono text-rose-400 mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage.text}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              id="upload-author-cover-btn"
              disabled={uploadingTarget !== null || savingPermanentTarget !== null}
              onClick={() => authorCoverInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>{author.coverPhotoUrl ? 'Change Cover' : 'Upload Cover'}</span>
            </button>

            {author.coverPhotoUrl && (
              <>
                <button
                  type="button"
                  id="save-permanently-author-cover-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleSavePermanently('author_cover')}
                  className="py-2.5 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                  title="Store permanently into database and persistent storage"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Save Permanently</span>
                </button>

                <button
                  type="button"
                  id="remove-author-cover-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleRemove('author_cover')}
                  title="Remove cover photo"
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 4. Website Icon / Favicon */}
        <div id="website-favicon-setting-card" className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Website Icon / Favicon</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {author.faviconUrl && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Saved Permanently</span>
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-500">Browser Tab Icon</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              The icon displayed in browser tabs, bookmarks, and mobile home screen shortcuts.
            </p>

            {/* Preview Box */}
            <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 mb-4">
              <div className="w-12 h-12 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0 p-1.5 shadow-md">
                {author.faviconUrl ? (
                  <img
                    src={author.faviconUrl}
                    alt="Website Favicon"
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Globe className="w-6 h-6 text-slate-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-slate-200 block truncate">
                  {author.faviconUrl ? 'Custom Icon Active' : 'Default Browser Icon'}
                </span>
                <span className="text-[11px] font-mono text-slate-500 block truncate mt-0.5">
                  {author.faviconUrl ? author.faviconUrl : 'Updates <head> favicon in real-time'}
                </span>
              </div>
            </div>

            {/* Status Messages */}
            {uploadingTarget === 'favicon' && (
              <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </div>
            )}
            {savingPermanentTarget === 'favicon' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving permanently to database...</span>
              </div>
            )}
            {permanentSuccessTarget === 'favicon' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">Saved Permanently</span>
              </div>
            )}
            {successMessage?.target === 'favicon' && permanentSuccessTarget !== 'favicon' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3">
                <Check className="w-3.5 h-3.5" />
                <span>{successMessage.text}</span>
              </div>
            )}
            {errorMessage?.target === 'favicon' && (
              <div className="flex items-center gap-2 text-xs font-mono text-rose-400 mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage.text}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              id="upload-favicon-btn"
              disabled={uploadingTarget !== null || savingPermanentTarget !== null}
              onClick={() => faviconInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>{author.faviconUrl ? 'Change Icon' : 'Upload Icon'}</span>
            </button>

            {author.faviconUrl && (
              <>
                <button
                  type="button"
                  id="save-permanently-favicon-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleSavePermanently('favicon')}
                  className="py-2.5 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                  title="Store permanently into database and persistent storage"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Save Permanently</span>
                </button>

                <button
                  type="button"
                  id="remove-favicon-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleRemove('favicon')}
                  title="Reset to default icon"
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* 5. Optional Site Logo */}
        <div id="site-logo-setting-card" className="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">Site Logo</h3>
              </div>
              <div className="flex items-center gap-1.5">
                {author.logoUrl && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/80 border border-emerald-800/50 px-2 py-0.5 rounded flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Saved Permanently</span>
                  </span>
                )}
                <span className="text-[11px] font-mono text-slate-500">Navigation Brand</span>
              </div>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Optional logo graphic displayed in the top navbar. If none is set, typography brand is used.
            </p>

            {/* Preview Box */}
            <div className="flex items-center gap-4 p-3.5 rounded-xl bg-slate-950 border border-slate-800/80 mb-4">
              <div className="w-16 h-12 rounded-lg bg-slate-900 border border-slate-700 overflow-hidden flex items-center justify-center shrink-0 p-1 shadow-md">
                {author.logoUrl ? (
                  <img
                    src={author.logoUrl}
                    alt="Site Logo"
                    className="max-w-full max-h-full object-contain"
                  />
                ) : (
                  <span className="text-xs font-serif font-bold text-slate-500">I&amp;W</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-xs font-medium text-slate-200 block truncate">
                  {author.logoUrl ? 'Custom Logo Active' : 'Typography Brand Active'}
                </span>
                <span className="text-[11px] font-mono text-slate-500 block truncate mt-0.5">
                  {author.logoUrl ? author.logoUrl : 'Clean typographic logotype'}
                </span>
              </div>
            </div>

            {/* Status Messages */}
            {uploadingTarget === 'logo' && (
              <div className="flex items-center gap-2 text-xs font-mono text-sky-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Uploading...</span>
              </div>
            )}
            {savingPermanentTarget === 'logo' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 animate-pulse">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Saving permanently to database...</span>
              </div>
            )}
            {permanentSuccessTarget === 'logo' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">Saved Permanently</span>
              </div>
            )}
            {successMessage?.target === 'logo' && permanentSuccessTarget !== 'logo' && (
              <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 mb-3">
                <Check className="w-3.5 h-3.5" />
                <span>{successMessage.text}</span>
              </div>
            )}
            {errorMessage?.target === 'logo' && (
              <div className="flex items-center gap-2 text-xs font-mono text-rose-400 mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                <span>{errorMessage.text}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <button
              type="button"
              id="upload-logo-btn"
              disabled={uploadingTarget !== null || savingPermanentTarget !== null}
              onClick={() => logoInputRef.current?.click()}
              className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center justify-center gap-2 cursor-pointer border border-slate-700"
            >
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>{author.logoUrl ? 'Change Logo' : 'Upload Logo'}</span>
            </button>

            {author.logoUrl && (
              <>
                <button
                  type="button"
                  id="save-permanently-logo-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleSavePermanently('logo')}
                  className="py-2.5 px-3.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                  title="Store permanently into database and persistent storage"
                >
                  <Database className="w-3.5 h-3.5 text-emerald-300" />
                  <span>Save Permanently</span>
                </button>

                <button
                  type="button"
                  id="remove-logo-btn"
                  disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                  onClick={() => handleRemove('logo')}
                  title="Remove custom logo"
                  className="p-2.5 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>

      </div>

      {/* 6. Piece Cover Photos Manager */}
      <div id="piece-cover-photos-manager" className="p-6 rounded-2xl bg-gradient-to-b from-slate-900 to-[#0c1220] border border-slate-800 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="w-4.5 h-4.5 text-sky-400" />
              <h3 className="text-base font-serif font-bold text-white tracking-tight">
                Piece Cover Photos
              </h3>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Select an existing monograph to upload, change, crop, or permanently save its public cover photo and catalogue card thumbnail.
            </p>
          </div>

          {/* Piece Selector Dropdown */}
          <div className="sm:w-72">
            <label className="block text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-1">
              Select Monograph
            </label>
            <select
              id="select-piece-for-photo"
              value={selectedPieceId}
              onChange={(e) => setSelectedPieceId(e.target.value)}
              className="w-full py-2 px-3 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs font-medium focus:outline-none focus:border-sky-500 cursor-pointer"
            >
              {pieces.map(piece => (
                <option key={piece.id} value={piece.id}>
                  {piece.title} ({piece.status.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedPiece ? (
          <div className="pt-6">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              
              {/* Piece Cover Image Preview (5 cols) */}
              <div className="lg:col-span-5">
                <div className="aspect-[16/10] rounded-xl bg-slate-950 border border-slate-800 overflow-hidden relative shadow-md flex items-center justify-center">
                  {selectedPiece.coverImage ? (
                    <img
                      src={selectedPiece.coverImage}
                      alt={selectedPiece.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center p-4">
                      <FileText className="w-10 h-10 text-slate-700 mx-auto mb-2" />
                      <span className="text-xs font-mono text-slate-500 block">No cover photo assigned</span>
                      <span className="text-[10px] text-slate-600">Defaults to editorial serif card style</span>
                    </div>
                  )}

                  {/* Status Badge overlay */}
                  <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-slate-900/90 backdrop-blur-sm border border-slate-800 text-[10px] font-mono text-slate-300">
                    {selectedPiece.status === 'published' ? '● Published' : '○ Draft'}
                  </div>

                  {selectedPiece.coverImage && (
                    <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-slate-950/85 backdrop-blur-sm border border-slate-800 text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                      <span>Permanent Database Asset</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Piece Info and Actions (7 cols) */}
              <div className="lg:col-span-7 space-y-4">
                <div>
                  <span className="text-[10px] font-mono uppercase tracking-widest text-sky-400 block mb-1">
                    {selectedPiece.category} • {selectedPiece.isPaid ? `KES ${selectedPiece.priceKes}` : 'Free'}
                  </span>
                  <h4 className="text-lg font-serif font-bold text-white">
                    {selectedPiece.title}
                  </h4>
                  <p className="text-xs text-slate-400 mt-1.5 line-clamp-2">
                    {selectedPiece.excerpt || selectedPiece.subtitle}
                  </p>
                </div>

                {/* Status Messages */}
                {uploadingTarget === 'piece_cover' && (
                  <div className="flex items-center gap-2 text-xs font-mono text-sky-400 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Uploading Piece Cover Photo...</span>
                  </div>
                )}
                {savingPermanentTarget === 'piece_cover' && (
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 animate-pulse">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Saving piece cover permanently to database...</span>
                  </div>
                )}
                {permanentSuccessTarget === 'piece_cover' && (
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 p-2 rounded-lg bg-emerald-950/40 border border-emerald-800/60">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="font-semibold">Piece Cover Saved Permanently! Intact across resets.</span>
                  </div>
                )}
                {successMessage?.target === 'piece_cover' && permanentSuccessTarget !== 'piece_cover' && (
                  <div className="flex items-center gap-2 text-xs font-mono text-emerald-400">
                    <Check className="w-3.5 h-3.5" />
                    <span>{successMessage.text}</span>
                  </div>
                )}
                {errorMessage?.target === 'piece_cover' && (
                  <div className="flex items-center gap-2 text-xs font-mono text-rose-400">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{errorMessage.text}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <button
                    type="button"
                    id="upload-piece-photo-btn"
                    disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                    onClick={() => pieceCoverInputRef.current?.click()}
                    className="py-2.5 px-4 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-medium text-xs tracking-wider transition-colors flex items-center gap-2 cursor-pointer shadow-md shadow-sky-950"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{selectedPiece.coverImage ? 'Change Photo' : 'Upload Piece Photo'}</span>
                  </button>

                  {selectedPiece.coverImage && (
                    <>
                      <button
                        type="button"
                        id="save-permanently-piece-cover-btn"
                        disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                        onClick={() => handleSavePermanently('piece_cover', selectedPiece.id)}
                        className="py-2.5 px-4 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white font-semibold text-xs tracking-wider transition-colors flex items-center gap-2 cursor-pointer shadow-md shadow-emerald-950 border border-emerald-600/60"
                        title="Store permanently into database and persistent storage"
                      >
                        <Database className="w-3.5 h-3.5 text-emerald-300" />
                        <span>Save Permanently</span>
                      </button>

                      <button
                        type="button"
                        id="crop-piece-photo-btn"
                        disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                        onClick={() => {
                          setCropImageUrl(selectedPiece.coverImageOriginal || selectedPiece.coverImage || '');
                          setCropInitialSettings(selectedPiece.coverImageCrop as CropSettings | undefined);
                          setCropTargetInfo({
                            target: 'piece_cover',
                            articleId: selectedPiece.id,
                            originalUrl: selectedPiece.coverImageOriginal || selectedPiece.coverImage
                          });
                          setCropModalOpen(true);
                        }}
                        className="py-2.5 px-4 rounded-xl bg-sky-950/80 hover:bg-sky-900/90 text-sky-300 border border-sky-800/80 transition-colors text-xs font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <Crop className="w-3.5 h-3.5 text-sky-400" />
                        <span>Crop &amp; Fit</span>
                      </button>

                      <button
                        type="button"
                        id="remove-piece-photo-btn"
                        disabled={uploadingTarget !== null || savingPermanentTarget !== null}
                        onClick={() => handleRemove('piece_cover', selectedPiece.id)}
                        className="py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-rose-950/60 hover:text-rose-400 text-slate-400 border border-slate-800 transition-colors text-xs font-medium flex items-center gap-2 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Remove Photo</span>
                      </button>
                    </>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 font-mono">
                  Permanent save active. Uploaded image will immediately display on public catalog, search cards, and reader view, and automatically reload whenever you reopen the workspace.
                </p>
              </div>

            </div>
          </div>
        ) : (
          <div className="py-8 text-center text-slate-500 text-xs">
            No pieces found. Create a monograph in the editor first.
          </div>
        )}
      </div>

      {/* Image Crop Modal */}
      <ImageCropModal
        isOpen={cropModalOpen}
        imageUrl={cropImageUrl}
        originalImageUrl={cropTargetInfo?.originalUrl}
        initialCropSettings={cropInitialSettings}
        title="Crop & Fit Piece Cover"
        onSave={async (res) => {
          if (!cropTargetInfo) return;
          const { target, articleId, originalUrl } = cropTargetInfo;
          setUploadingTarget(target);
          try {
            const apiRes = await api.savePermanentImage(target, res.croppedDataUrl, articleId, {
              dataUrl: res.croppedDataUrl,
              cropSettings: res.cropSettings,
              originalUrl: originalUrl || res.croppedDataUrl
            });
            if (target === 'author_avatar') {
              onAuthorUpdated({ ...author, avatarUrl: apiRes.url, avatarSavedPermanently: true, avatarSavedAt: apiRes.savedAt });
            } else if (target === 'author_cover') {
              onAuthorUpdated({ ...author, coverPhotoUrl: apiRes.url, coverPhotoSavedPermanently: true, coverPhotoSavedAt: apiRes.savedAt });
            } else if (target === 'welcome_background') {
              onAuthorUpdated({ ...author, welcomeBackgroundUrl: apiRes.url, welcomeBackgroundSavedPermanently: true, welcomeBackgroundSavedAt: apiRes.savedAt });
            } else if (target === 'piece_cover' && articleId && onPiecesUpdated) {
              const updated = pieces.map(p => p.id === articleId ? {
                ...p,
                coverImage: apiRes.url,
                coverImageOriginal: originalUrl || p.coverImageOriginal || p.coverImage,
                coverImageCrop: res.cropSettings,
                coverImageSavedPermanently: true,
                coverImageSavedAt: apiRes.savedAt
              } : p);
              onPiecesUpdated(updated);
            }
            showSuccess(target, 'Cover cropped and permanently saved in database!');
          } catch (err: any) {
            showError(target, err.message || 'Failed to apply crop.');
          } finally {
            setUploadingTarget(null);
          }
        }}
        onClose={() => setCropModalOpen(false)}
      />

    </div>
  );
};


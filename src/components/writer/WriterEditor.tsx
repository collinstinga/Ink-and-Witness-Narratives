import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Save, 
  Globe, 
  Eye, 
  ArrowLeft, 
  Sparkles, 
  Bold, 
  Italic, 
  Heading1, 
  Heading2, 
  Heading3, 
  Quote, 
  List, 
  ListOrdered, 
  Link as LinkIcon, 
  Minus, 
  Clock, 
  Check, 
  AlertCircle, 
  DollarSign, 
  Image as ImageIcon, 
  Tag, 
  Layers,
  Wand2,
  RefreshCw,
  FileText,
  Plus,
  X,
  History,
  Calendar,
  Search,
  Upload,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Share2,
  Crop,
  Move,
  Maximize2,
  Compass
} from 'lucide-react';
import { Article, ArticleStatus, ArticleRevision, Category, Topic } from '../../types.js';
import { api } from '../../utils/api.js';
import { ImageCropModal, CropSettings } from './ImageCropModal.js';
import { CategoryManagerModal } from './CategoryManagerModal.js';
import { SaveStatusBar } from '../common/SaveStatusBar.js';
import { UnsavedChangesPromptModal } from '../common/UnsavedChangesPromptModal.js';

interface WriterEditorProps {
  initialArticle: Article | null;
  allPublishedArticles?: Article[];
  onSave: (article: Partial<Article>) => Promise<Article>;
  onCancel: () => void;
  onPreview: (article: Article) => void;
}

const PRESET_COVERS = [
  { label: "Modern Skyscraper", url: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80" },
  { label: "Executive Suit", url: "https://images.unsplash.com/photo-1507679799987-c73779587ccf?auto=format&fit=crop&w=1200&q=80" },
  { label: "Nairobi Skyline", url: "https://images.unsplash.com/photo-1578575437130-527eed3abbec?auto=format&fit=crop&w=1200&q=80" },
  { label: "Vintage Typewriter", url: "https://images.unsplash.com/photo-1455390582262-044cdead277a?auto=format&fit=crop&w=1200&q=80" },
  { label: "Financial Ledger", url: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1200&q=80" },
  { label: "Global Atlas", url: "https://images.unsplash.com/photo-1526778548025-fa2f459cd5c1?auto=format&fit=crop&w=1200&q=80" },
];

const POPULAR_TAGS = [
  "Monograph",
  "Poetry",
  "Romance",
  "Masculinity",
  "Strategy",
  "Power",
  "African Archive",
  "Intimacy",
  "Philosophy",
  "Executive",
  "Heartbreak",
  "Kenyan Life"
];

export const WriterEditor: React.FC<WriterEditorProps> = ({
  initialArticle,
  allPublishedArticles = [],
  onSave,
  onCancel,
  onPreview
}) => {
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(initialArticle?.id || null);
  const [title, setTitle] = useState(initialArticle?.title || '');
  const [subtitle, setSubtitle] = useState(initialArticle?.subtitle || '');
  const [excerpt, setExcerpt] = useState(initialArticle?.excerpt || '');
  const [synopsis, setSynopsis] = useState(initialArticle?.synopsis || '');
  const [content, setContent] = useState(initialArticle?.content || '');
  const [category, setCategory] = useState(initialArticle?.category || '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialArticle?.categories && initialArticle.categories.length > 0
      ? initialArticle.categories
      : (initialArticle?.category ? [initialArticle.category] : [])
  );
  const [availableCategories, setAvailableCategories] = useState<Category[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [selectedTopics, setSelectedTopics] = useState<string[]>(initialArticle?.topics || []);
  const [availableTopics, setAvailableTopics] = useState<Topic[]>([]);
  const [status, setStatus] = useState<ArticleStatus>(initialArticle?.status || 'draft');
  const [scheduledAt, setScheduledAt] = useState<string>(initialArticle?.scheduledAt || '');
  const [isPaid, setIsPaid] = useState<boolean>(initialArticle?.isPaid !== false);
  const [priceKes, setPriceKes] = useState<number>(initialArticle?.priceKes || 1050);
  const [prices, setPrices] = useState<Record<string, number>>(initialArticle?.prices || {});
  const [currencyOverrides, setCurrencyOverrides] = useState<string[]>(initialArticle?.currencyOverrides || []);
  const [kesRates, setKesRates] = useState<Record<string, number>>({
    KES: 1,
    USD: 130.0,
    EUR: 141.5,
    GBP: 165.2,
    CAD: 96.5,
    AUD: 85.0,
    ZAR: 7.2
  });
  const [showCurrencyConfig, setShowCurrencyConfig] = useState<boolean>(false);
  const [coverImage, setCoverImage] = useState(initialArticle?.coverImage || PRESET_COVERS[0].url);
  const [coverImageOriginal, setCoverImageOriginal] = useState(initialArticle?.coverImageOriginal || initialArticle?.coverImage || PRESET_COVERS[0].url);
  const [coverImageCrop, setCoverImageCrop] = useState<CropSettings | undefined>(initialArticle?.coverImageCrop as CropSettings | undefined);
  const [showCropModal, setShowCropModal] = useState(false);
  const [cropModalImageUrl, setCropModalImageUrl] = useState('');
  const coverImageFileInputRef = useRef<HTMLInputElement>(null);
  const [tags, setTags] = useState<string[]>(initialArticle?.tags || ['Monograph', 'Strategy']);
  const [customTagInput, setCustomTagInput] = useState('');
  const [featured, setFeatured] = useState<boolean>(initialArticle?.featured || false);

  // SEO & Metadata
  const [seoTitle, setSeoTitle] = useState(initialArticle?.seoTitle || '');
  const [metaDescription, setMetaDescription] = useState(initialArticle?.metaDescription || '');

  // Manual Related Pieces
  const [manualRelatedPieceIds, setManualRelatedPieceIds] = useState<string[]>(initialArticle?.manualRelatedPieceIds || []);

  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaving, setAutosaving] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(initialArticle?.updatedAt || null);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showUnsavedPrompt, setShowUnsavedPrompt] = useState(false);
  const isInitialMount = useRef(true);

  // Revision History State
  const [showRevisionsModal, setShowRevisionsModal] = useState(false);
  const [revisions, setRevisions] = useState<ArticleRevision[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(false);
  const [selectedRevision, setSelectedRevision] = useState<ArticleRevision | null>(null);

  // AI Assistant State
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiMode, setAiMode] = useState<'generate_outline' | 'refine_draft' | 'generate_excerpt'>('refine_draft');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<string | null>(null);

  // Image Upload helper
  const imageUploadInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingPermanentCover, setSavingPermanentCover] = useState(false);
  const [permanentCoverSaved, setPermanentCoverSaved] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Word count & Read time
  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
  const charCount = content.length;
  const readTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));

  // Load categories and exchange rates from backend
  useEffect(() => {
    api.getCategories()
      .then(cats => setAvailableCategories(cats || []))
      .catch(err => console.error("Failed to load categories in editor:", err));

    api.getTopics(true)
      .then(topList => setAvailableTopics(topList || []))
      .catch(err => console.warn("Failed to load topics in editor:", err));

    api.getExchangeRates()
      .then(data => {
        if (data?.kesRates) {
          setKesRates(data.kesRates);
        }
      })
      .catch(err => console.warn("Could not load rates in editor:", err));
  }, []);

  // BeforeUnload browser warning if unsaved
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Mark dirty on subsequent user modifications
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setIsDirty(true);
  }, [
    title, 
    subtitle, 
    excerpt, 
    synopsis,
    content, 
    category,
    selectedCategories,
    status, 
    scheduledAt, 
    isPaid, 
    priceKes, 
    prices,
    currencyOverrides,
    coverImage, 
    tags, 
    featured,
    seoTitle,
    metaDescription,
    manualRelatedPieceIds
  ]);

  // Load revisions when opening revisions panel
  const loadRevisions = async () => {
    if (!currentArticleId) return;
    setLoadingRevisions(true);
    try {
      const res = await api.getArticleRevisions(currentArticleId);
      setRevisions(res.revisions || []);
      if (res.revisions?.length > 0) {
        setSelectedRevision(res.revisions[0]);
      }
    } catch (err) {
      console.error("Failed to load revisions", err);
    } finally {
      setLoadingRevisions(false);
    }
  };

  const handleOpenRevisions = () => {
    setShowRevisionsModal(true);
    loadRevisions();
  };

  const handleRestoreRevision = async (rev: ArticleRevision) => {
    if (!currentArticleId) return;
    if (!window.confirm(`Restore revision from ${new Date(rev.createdAt).toLocaleString()}? Current draft will be backed up.`)) {
      return;
    }

    try {
      setSaving(true);
      const res = await api.restoreArticleRevision(currentArticleId, rev.id);
      if (res.article) {
        setTitle(res.article.title);
        setSubtitle(res.article.subtitle || '');
        setExcerpt(res.article.excerpt || '');
        setSynopsis(res.article.synopsis || '');
        setContent(res.article.content || '');
        setCategory(res.article.category || '');
        setSelectedCategories(
          res.article.categories && res.article.categories.length > 0
            ? res.article.categories
            : (res.article.category ? [res.article.category] : [])
        );
        setStatus(res.article.status);
        setIsPaid(res.article.isPaid !== false);
        setPriceKes(res.article.priceKes || 300);
        setCoverImage(res.article.coverImage || PRESET_COVERS[0].url);
        setTags(res.article.tags || []);
        setFeatured(Boolean(res.article.featured));
        setIsDirty(false);
        setSaveSuccessMsg(`Restored revision from ${new Date(rev.createdAt).toLocaleTimeString()}`);
        setShowRevisionsModal(false);
      }
    } catch (err: any) {
      setError(err.message || "Failed to restore revision");
    } finally {
      setSaving(false);
    }
  };

  // Background Autosave every 20 seconds if dirty and article ID exists
  useEffect(() => {
    if (!currentArticleId || !isDirty || saving || autosaving) return;

    const timer = setTimeout(async () => {
      if (!isDirty || !title.trim() || !content.trim()) return;
      try {
        setAutosaving(true);
        const payload: Partial<Article> = {
          title: title.trim(),
          subtitle: subtitle.trim(),
          excerpt: excerpt.trim(),
          synopsis: synopsis.trim(),
          content: content.trim(),
          category: category.trim(),
          status,
          scheduledAt: scheduledAt || undefined,
          isPaid,
          priceKes: isPaid ? (isNaN(Number(priceKes)) || Number(priceKes) < 1 ? 1050 : Number(priceKes)) : 0,
          prices,
          currencyOverrides,
          readTimeMinutes,
          coverImage,
          tags,
          featured,
          seoTitle: seoTitle || undefined,
          metaDescription: metaDescription || undefined,
          manualRelatedPieceIds
        };
        await api.autosaveArticle(currentArticleId, payload);
        setIsDirty(false);
        setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (err) {
        // silent fail on autosave
      } finally {
        setAutosaving(false);
      }
    }, 20000);

    return () => clearTimeout(timer);
  }, [
    currentArticleId, 
    isDirty, 
    title, 
    subtitle, 
    excerpt, 
    synopsis,
    content, 
    category, 
    status, 
    scheduledAt, 
    isPaid, 
    priceKes, 
    readTimeMinutes, 
    coverImage, 
    tags, 
    featured, 
    seoTitle, 
    metaDescription, 
    manualRelatedPieceIds, 
    saving, 
    autosaving
  ]);

  const handleAddTag = (tagToAdd: string) => {
    const trimmed = tagToAdd.trim().replace(/^#/, '');
    if (!trimmed) return;
    if (!tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setCustomTagInput('');
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(customTagInput);
    }
  };

  // Text formatting tool helper
  const insertFormatting = (prefix: string, suffix = '') => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selectedText = content.substring(start, end);
    const replacement = `${prefix}${selectedText || 'text'}${suffix}`;

    const newContent = content.substring(0, start) + replacement + content.substring(end);
    setContent(newContent);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length);
    }, 0);
  };

  // Inline Image Upload Handler
  const handleImageFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      setError('Image file exceeds 12MB size limit.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    setUploadingImage(true);
    setError(null);

    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) {
        setUploadingImage(false);
        return;
      }

      try {
        const res = await api.uploadImage(dataUrl, 'piece_cover', currentArticleId || undefined);
        const imageUrl = res.url || dataUrl;
        
        // Insert markdown image at cursor
        insertFormatting(`\n\n![${file.name.replace(/\.[^/.]+$/, '')}](${imageUrl})\n\n`);
        setSaveSuccessMsg('Image uploaded and inserted into piece!');
        setTimeout(() => setSaveSuccessMsg(null), 3000);
      } catch (err: any) {
        setError(err.message || 'Failed to upload image.');
      } finally {
        setUploadingImage(false);
        if (imageUploadInputRef.current) {
          imageUploadInputRef.current.value = '';
        }
      }
    };

    reader.readAsDataURL(file);
  };

  // Cover Image File Selection & Cropping
  const handleCoverFileSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      setError('Image file exceeds 12MB size limit.');
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setCropModalImageUrl(dataUrl);
        setCoverImageOriginal(dataUrl);
        setShowCropModal(true);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleOpenCropModal = () => {
    setCropModalImageUrl(coverImageOriginal || coverImage);
    setShowCropModal(true);
  };

  const handleCropSaved = async (result: {
    croppedDataUrl: string;
    cropSettings: CropSettings;
    originalUrl?: string;
  }) => {
    try {
      // Upload cropped image to backend storage
      const res = await api.uploadImage(result.croppedDataUrl, 'piece_cover', currentArticleId || undefined);
      const finalUrl = res.url || result.croppedDataUrl;
      
      setCoverImage(finalUrl);
      if (result.originalUrl) {
        setCoverImageOriginal(result.originalUrl);
      }
      setCoverImageCrop(result.cropSettings);
      setIsDirty(true);
      setSaveSuccessMsg('Cover crop & framing applied successfully!');
      setTimeout(() => setSaveSuccessMsg(null), 3000);
    } catch (err: any) {
      setCoverImage(result.croppedDataUrl);
      if (result.originalUrl) {
        setCoverImageOriginal(result.originalUrl);
      }
      setCoverImageCrop(result.cropSettings);
      setIsDirty(true);
    }
  };

  const handleSavePermanentCover = async () => {
    if (!coverImage) return;
    try {
      setSavingPermanentCover(true);
      setError(null);
      await api.savePermanentImage(coverImage, 'piece_cover', currentArticleId || undefined);
      setPermanentCoverSaved(true);
      setSaveSuccessMsg('Cover photo saved permanently to database & storage!');
      setTimeout(() => {
        setPermanentCoverSaved(false);
        setSaveSuccessMsg(null);
      }, 4000);
    } catch (err: any) {
      console.error('Failed to permanently save cover image:', err);
      setError(err.message || 'Failed to save cover image permanently.');
    } finally {
      setSavingPermanentCover(false);
    }
  };

  const handleSaveAction = async (targetStatus?: ArticleStatus) => {
    if (!title.trim()) {
      setError('Please provide a piece title.');
      return;
    }
    if (!content.trim()) {
      setError('Please write piece content before saving.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const finalStatus = targetStatus || status;
      let finalTags = [...tags];
      if (customTagInput.trim()) {
        const extra = customTagInput.trim().replace(/^#/, '');
        if (!finalTags.includes(extra)) {
          finalTags.push(extra);
        }
      }
      finalTags = finalTags.map(t => t.trim()).filter(Boolean);

      const payload: Partial<Article> = {
        title: title.trim(),
        subtitle: subtitle.trim(),
        excerpt: excerpt.trim(),
        synopsis: synopsis.trim() || undefined,
        content: content.trim(),
        category: selectedCategories[0] || category.trim() || '',
        categories: selectedCategories,
        status: finalStatus,
        scheduledAt: finalStatus === 'scheduled' ? scheduledAt : undefined,
        isPaid,
        priceKes: isPaid ? (isNaN(Number(priceKes)) || Number(priceKes) < 1 ? 1050 : Number(priceKes)) : 0,
        prices,
        currencyOverrides,
        readTimeMinutes,
        coverImage,
        coverImageOriginal,
        coverImageCrop: coverImageCrop ? {
          aspectRatio: coverImageCrop.aspectRatio,
          zoom: coverImageCrop.zoom,
          positionX: coverImageCrop.positionX,
          positionY: coverImageCrop.positionY
        } : undefined,
        tags: finalTags,
        topics: selectedTopics,
        featured,
        seoTitle: seoTitle.trim() || undefined,
        metaDescription: metaDescription.trim() || undefined,
        manualRelatedPieceIds: manualRelatedPieceIds.length > 0 ? manualRelatedPieceIds : undefined
      };

      const saved = await onSave(payload);
      setCurrentArticleId(saved.id);
      setStatus(saved.status);
      setIsDirty(false);
      setLastSavedTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setSaveSuccessMsg(
        finalStatus === 'published' 
          ? 'Piece published successfully to live publication!' 
          : finalStatus === 'scheduled' 
            ? `Piece scheduled for publication on ${new Date(scheduledAt).toLocaleDateString()}!` 
            : 'Draft saved securely with version revision recorded.'
      );
      setTimeout(() => setSaveSuccessMsg(null), 4000);
    } catch (err: any) {
      setError(err.message || 'Failed to save piece.');
    } finally {
      setSaving(false);
    }
  };

  const handleAiAssist = async () => {
    setAiLoading(true);
    setAiResult(null);
    try {
      const res = await api.aiAssist(aiPrompt, content, aiMode);
      setAiResult(res);
    } catch (err: any) {
      setError(err.message || 'AI Assistant unavailable. Check API key configuration.');
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiResult = () => {
    if (!aiResult) return;
    if (aiMode === 'generate_excerpt') {
      setExcerpt(aiResult);
    } else {
      setContent(prev => prev + '\n\n' + aiResult);
    }
    setShowAiModal(false);
    setAiResult(null);
  };

  const handleOpenPreview = () => {
    const previewObj: Article = {
      id: currentArticleId || `preview-${Date.now()}`,
      title: title || 'Untitled Monograph',
      subtitle,
      slug: 'preview',
      excerpt: excerpt.trim(),
      synopsis: synopsis.trim() || undefined,
      content,
      category,
      status,
      scheduledAt,
      isPaid,
      priceKes,
      readTimeMinutes,
      publishedAt: new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      coverImage,
      tags: tags.map(t => t.trim()).filter(Boolean),
      downloadsCount: initialArticle?.downloadsCount || 0,
      previewParagraphs: [],
      isUnlocked: true,
      seoTitle,
      metaDescription,
      manualRelatedPieceIds
    };
    onPreview(previewObj);
  };

  const toggleRelatedPiece = (id: string) => {
    if (manualRelatedPieceIds.includes(id)) {
      setManualRelatedPieceIds(manualRelatedPieceIds.filter(item => item !== id));
    } else {
      if (manualRelatedPieceIds.length >= 4) {
        setError('Maximum 4 related pieces can be curated for a single monograph.');
        setTimeout(() => setError(null), 3000);
        return;
      }
      setManualRelatedPieceIds([...manualRelatedPieceIds, id]);
    }
  };

  return (
    <div id="writer-editor-container" className="space-y-6">
      
      {/* Hidden Image Input */}
      <input
        ref={imageUploadInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFileSelected}
      />

      {/* Top Action Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        
        {/* Left: Back & Dirty status */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (isDirty) {
                setShowUnsavedPrompt(true);
              } else {
                onCancel();
              }
            }}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors flex items-center gap-1.5 text-xs font-mono cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>All Pieces</span>
          </button>

          <div className="h-4 w-px bg-slate-800 hidden sm:block" />

          <div className="flex items-center gap-2 text-xs font-mono">
            {autosaving ? (
              <span className="text-sky-400 flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                Autosaving...
              </span>
            ) : isDirty ? (
              <span className="text-amber-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Unsaved changes
              </span>
            ) : (
              <span className="text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                {lastSavedTime ? `Saved at ${lastSavedTime}` : 'All changes saved'}
              </span>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          
          {/* Revisions History Button */}
          {currentArticleId && (
            <button
              onClick={handleOpenRevisions}
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
              title="View past saved revisions and restore points"
            >
              <History className="w-3.5 h-3.5 text-amber-400" />
              <span>Version Revisions</span>
            </button>
          )}

          {/* AI Writing Assistant Button */}
          <button
            onClick={() => setShowAiModal(true)}
            className="px-3 py-2 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 hover:text-indigo-100 border border-indigo-800/70 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
            <span>AI Assist</span>
          </button>

          {/* Reader Preview */}
          <button
            onClick={handleOpenPreview}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-800 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Eye className="w-3.5 h-3.5" />
            <span>Preview Mode</span>
          </button>

          {/* Save Draft */}
          <button
            onClick={() => handleSaveAction('draft')}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border border-slate-700 text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Draft'}</span>
          </button>

          {/* Publish / Update Button */}
          <button
            onClick={() => handleSaveAction('published')}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer shadow-md shadow-emerald-950/50 disabled:opacity-50"
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{status === 'published' ? 'Update Published' : 'Publish Live'}</span>
          </button>

        </div>
      </div>

      {/* Success Notification */}
      {saveSuccessMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/90 border border-emerald-800/90 text-emerald-200 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Error Alert */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/90 border border-rose-800/90 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Grid: Left Editor & Right Metadata Settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: Title, Subtitle, Excerpt & Writing Area */}
        <div className="lg:col-span-8 space-y-6">
          
          {/* Title input */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
              Monograph Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. The Architecture of Unspoken Leverage"
              className="w-full px-4 py-3 rounded-xl bg-[#0b1120] border border-slate-700 text-xl sm:text-2xl font-serif font-bold text-white placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Subtitle input */}
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">
              Subtitle / Hook
            </label>
            <input
              type="text"
              value={subtitle}
              onChange={(e) => setSubtitle(e.target.value)}
              placeholder="e.g. Why true influence operates in silence while mediocrity begs for an audience."
              className="w-full px-4 py-2.5 rounded-xl bg-[#0b1120] border border-slate-700 text-sm font-sans text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors"
            />
          </div>

          {/* Excerpt / Limited Preview Excerpt input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-slate-400">
                Piece Excerpt / Preview Text (Visible under "Preview" button)
              </label>
              <span className="text-[10px] font-mono text-slate-500">Deliberately short reading excerpt</span>
            </div>
            <textarea
              rows={2}
              value={excerpt}
              onChange={(e) => setExcerpt(e.target.value)}
              placeholder="Short teaser excerpt read when readers click the 'Preview' action before unlocking..."
              className="w-full px-4 py-2.5 rounded-xl bg-[#0b1120] border border-slate-700 text-xs font-sans text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-500 transition-colors resize-none"
            />
          </div>

          {/* Editorial Synopsis input */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-mono uppercase tracking-wider text-amber-400">
                Editorial Synopsis (Visible under "Synopsis" button)
              </label>
              <span className="text-[10px] font-mono text-slate-500">Story overview, themes &amp; context</span>
            </div>
            <textarea
              rows={3}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Contextual description explaining what this piece explores, its deeper themes, and why readers should collect/read it without spoiling the entire story..."
              className="w-full px-4 py-2.5 rounded-xl bg-[#0b1120] border border-slate-700 text-xs font-sans text-slate-300 placeholder-slate-600 focus:outline-none focus:border-amber-500 transition-colors resize-none"
            />
          </div>

          {/* Formatting Toolbar */}
          <div className="bg-[#0b1120] border border-slate-700/80 rounded-xl p-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                onClick={() => insertFormatting('**', '**')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Bold (**text**)"
              >
                <Bold className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('*', '*')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Italic (*text*)"
              >
                <Italic className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-slate-700 mx-1" />

              <button
                type="button"
                onClick={() => insertFormatting('# ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Heading 1"
              >
                <Heading1 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('## ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Heading 2"
              >
                <Heading2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('### ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Heading 3"
              >
                <Heading3 className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-slate-700 mx-1" />

              <button
                type="button"
                onClick={() => insertFormatting('> ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Blockquote"
              >
                <Quote className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('- ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Bullet List"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('1. ')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Numbered List"
              >
                <ListOrdered className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('[', '](https://)')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Hyperlink"
              >
                <LinkIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => insertFormatting('\n---\n')}
                className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Horizontal Divider"
              >
                <Minus className="w-4 h-4" />
              </button>

              <div className="w-px h-4 bg-slate-700 mx-1" />

              {/* Upload Image & Insert */}
              <button
                type="button"
                onClick={() => imageUploadInputRef.current?.click()}
                disabled={uploadingImage}
                className="p-1.5 rounded hover:bg-sky-950 text-sky-400 hover:text-sky-200 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-mono"
                title="Upload image from computer and insert into text"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingImage ? 'Uploading...' : 'Insert Photo'}</span>
              </button>
            </div>

            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 bg-[#080d1a] border border-slate-800 p-0.5 rounded-lg text-xs font-mono">
              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === 'write' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Markdown Editor
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  activeTab === 'preview' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Formatted View
              </button>
            </div>
          </div>

          {/* Writing Content Area */}
          <div className="relative">
            {activeTab === 'write' ? (
              <textarea
                ref={textareaRef}
                rows={22}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your monograph here in clean Markdown. Use headings (#, ##), blockquotes (>), lists (-), and horizontal rules (---)..."
                className="w-full p-5 rounded-2xl bg-[#0b1120] border border-slate-700 text-slate-100 placeholder-slate-600 text-sm sm:text-base font-serif leading-relaxed focus:outline-none focus:border-sky-500 transition-colors resize-y font-normal"
              />
            ) : (
              <div className="w-full min-h-[440px] p-6 rounded-2xl bg-[#0b1120] border border-slate-700 text-slate-200 prose prose-invert max-w-none font-serif leading-relaxed overflow-y-auto">
                <h1 className="text-2xl font-serif font-bold text-white mb-2">{title || 'Untitled Monograph'}</h1>
                {subtitle && <p className="text-slate-400 italic text-sm mb-4">{subtitle}</p>}
                <div className="whitespace-pre-wrap text-sm sm:text-base leading-relaxed text-slate-300">
                  {content || 'Start writing to see the preview here...'}
                </div>
              </div>
            )}
          </div>

          {/* Stats Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 rounded-xl bg-[#0b1120] border border-slate-800 text-xs font-mono text-slate-400">
            <div className="flex items-center gap-4">
              <span>{wordCount} words</span>
              <span>•</span>
              <span>{charCount} characters</span>
              <span>•</span>
              <span className="flex items-center gap-1 text-sky-400">
                <Clock className="w-3.5 h-3.5" />
                ~{readTimeMinutes} min read
              </span>
            </div>
            <span className="text-slate-500">
              Markdown Enabled
            </span>
          </div>

          {/* Curated Related Pieces Selector */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 flex items-center gap-2">
                <Share2 className="w-4 h-4 text-sky-400" />
                <span>"You May Also Want to Read" Recommendations</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-400">
                {manualRelatedPieceIds.length}/4 curated
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans">
              Choose up to 4 specific pieces to display at the conclusion of this article. If unselected, relevant pieces will automatically match by category.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              {allPublishedArticles
                .filter(p => p.id !== currentArticleId)
                .map((art) => {
                  const isSelected = manualRelatedPieceIds.includes(art.id);
                  return (
                    <button
                      key={art.id}
                      type="button"
                      onClick={() => toggleRelatedPiece(art.id)}
                      className={`p-3 rounded-xl border text-left text-xs transition-all cursor-pointer flex items-center justify-between gap-2 ${
                        isSelected 
                          ? 'bg-sky-950/80 border-sky-600 text-white shadow-sm'
                          : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="font-serif font-medium truncate">{art.title}</p>
                        <span className="text-[10px] font-mono text-slate-500">{art.category}</span>
                      </div>
                      {isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
                      ) : (
                        <Plus className="w-4 h-4 text-slate-600 shrink-0" />
                      )}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* SEO & Meta Tags Card */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <Search className="w-4 h-4 text-emerald-400" />
              <span>Search Engine Optimization &amp; Social Metadata</span>
            </h3>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5">
                Custom SEO Meta Title (Defaults to Monograph Title)
              </label>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                placeholder={title || 'Ink & Witness: Executive Monograph'}
                className="w-full px-3.5 py-2 rounded-xl bg-[#080d1a] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-sans"
              />
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5">
                Meta Description (Search Results Snippet)
              </label>
              <textarea
                rows={2}
                value={metaDescription}
                onChange={(e) => setMetaDescription(e.target.value)}
                placeholder={excerpt || 'Executive analysis on sovereign power, commerce, and strategy...'}
                className="w-full px-3.5 py-2 rounded-xl bg-[#080d1a] border border-slate-700 text-xs text-slate-200 focus:outline-none focus:border-sky-500 font-sans resize-none"
              />
            </div>

            {/* Google SERP Preview */}
            <div className="p-3.5 rounded-xl bg-[#080d1a] border border-slate-800 space-y-1">
              <span className="text-[10px] font-mono text-slate-500 block">Search Engine Snippet Preview</span>
              <div className="text-sm text-[#8ab4f8] font-sans hover:underline cursor-pointer truncate">
                {seoTitle || title || 'Monograph Title'} — Ink &amp; Witness
              </div>
              <div className="text-[11px] text-[#34a853] font-mono truncate">
                https://inkandwitness.co.ke/piece/{initialArticle?.slug || 'piece-slug'}
              </div>
              <div className="text-xs text-[#bdc1c6] line-clamp-2">
                {metaDescription || excerpt || 'Executive monograph on strategic power, African enterprise, and personal discipline by Jake.'}
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: Publishing, Monetization & Metadata Controls */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Status & Monetization Card */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-5">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Publishing &amp; Access</span>
            </h3>

            {/* Publishing Status */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-2">
                Visibility Status
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setStatus('draft')}
                  className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    status === 'draft'
                      ? 'bg-amber-950/80 border-amber-600 text-amber-200 shadow-md shadow-amber-950/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="font-semibold text-[11px]">Draft</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStatus('scheduled')}
                  className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    status === 'scheduled'
                      ? 'bg-indigo-950/80 border-indigo-600 text-indigo-200 shadow-md shadow-indigo-950/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-indigo-400" />
                  <span className="font-semibold text-[11px]">Schedule</span>
                </button>

                <button
                  type="button"
                  onClick={() => setStatus('published')}
                  className={`p-2.5 rounded-xl border text-xs font-medium flex flex-col items-center gap-1 transition-all cursor-pointer ${
                    status === 'published'
                      ? 'bg-emerald-950/80 border-emerald-600 text-emerald-200 shadow-md shadow-emerald-950/40'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <span className="font-semibold text-[11px]">Publish</span>
                </button>
              </div>
            </div>

            {/* Scheduled Date Picker */}
            {status === 'scheduled' && (
              <div className="p-3.5 rounded-xl bg-indigo-950/40 border border-indigo-800/60 space-y-2">
                <label className="block text-xs font-mono text-indigo-300 flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>Release Date &amp; Time</span>
                </label>
                <input
                  type="datetime-local"
                  value={scheduledAt ? scheduledAt.substring(0, 16) : ''}
                  onChange={(e) => setScheduledAt(new Date(e.target.value).toISOString())}
                  className="w-full px-3 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-slate-400">
                  Will remain hidden from the public catalog until this date and time.
                </p>
              </div>
            )}

            {/* Monetization Toggle */}
            <div className="pt-3 border-t border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-white block">
                    Pay-to-Read Monetization
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Require M-PESA or Int'l Card to unlock full piece
                  </span>
                </div>
                <input
                  type="checkbox"
                  id="paid-toggle"
                  checked={isPaid}
                  onChange={(e) => setIsPaid(e.target.checked)}
                  className="w-4 h-4 accent-sky-500 rounded cursor-pointer"
                />
              </div>

              {isPaid && (
                <div className="p-3.5 rounded-xl bg-[#080d1a] border border-sky-900/40 space-y-3">
                  <div>
                    <label className="block text-xs font-mono text-sky-300 mb-1">
                      Primary Price (Kenyan Shillings - KES)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">
                        KES
                      </span>
                      <input
                        type="number"
                        min={50}
                        step={50}
                        value={priceKes}
                        onChange={(e) => setPriceKes(Number(e.target.value))}
                        className="w-full pl-12 pr-4 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-sm focus:outline-none focus:border-sky-500 font-bold"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                      Default for new monographs: <span className="text-emerald-400 font-mono">1,050 KES</span> (Routes to Till 1618656).
                    </p>
                  </div>

                  {/* Multi-Currency & International Pricing Accordion */}
                  <div className="pt-2 border-t border-slate-800/80">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span>Int'l Currency Rates</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowCurrencyConfig(!showCurrencyConfig)}
                        className="text-[10px] font-mono text-sky-400 hover:text-sky-300 underline cursor-pointer"
                      >
                        {showCurrencyConfig ? 'Hide Multi-Currency' : 'Manage Multi-Currency'}
                      </button>
                    </div>

                    {/* Quick Live Preview Cards */}
                    <div className="grid grid-cols-3 gap-1.5 text-center font-mono text-[11px]">
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">USD</span>
                        <span className="text-slate-200 font-bold">
                          ${prices['USD'] ? Number(prices['USD']).toFixed(2) : ((priceKes || 1050) / (kesRates['USD'] || 130)).toFixed(2)}
                        </span>
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">EUR</span>
                        <span className="text-slate-200 font-bold">
                          €{prices['EUR'] ? Number(prices['EUR']).toFixed(2) : ((priceKes || 1050) / (kesRates['EUR'] || 141.5)).toFixed(2)}
                        </span>
                      </div>
                      <div className="p-1.5 rounded-lg bg-slate-900/80 border border-slate-800">
                        <span className="text-[10px] text-slate-500 block">GBP</span>
                        <span className="text-slate-200 font-bold">
                          £{prices['GBP'] ? Number(prices['GBP']).toFixed(2) : ((priceKes || 1050) / (kesRates['GBP'] || 165.2)).toFixed(2)}
                        </span>
                      </div>
                    </div>

                    {/* Detailed Override Editor */}
                    {showCurrencyConfig && (
                      <div className="mt-3 p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5 animate-in fade-in duration-200">
                        <p className="text-[10px] text-slate-400">
                          Auto-calculated from live exchange rates unless manually overridden:
                        </p>
                        
                        {[
                          { code: 'USD', symbol: '$', name: 'US Dollar', rate: kesRates['USD'] || 130 },
                          { code: 'EUR', symbol: '€', name: 'Euro', rate: kesRates['EUR'] || 141.5 },
                          { code: 'GBP', symbol: '£', name: 'British Pound', rate: kesRates['GBP'] || 165.2 },
                          { code: 'CAD', symbol: 'CA$', name: 'Canadian Dollar', rate: kesRates['CAD'] || 96.5 },
                          { code: 'AUD', symbol: 'AU$', name: 'Australian Dollar', rate: kesRates['AUD'] || 85.0 },
                          { code: 'ZAR', symbol: 'R', name: 'South African Rand', rate: kesRates['ZAR'] || 7.2 },
                        ].map((curr) => {
                          const autoVal = Number(((priceKes || 1050) / curr.rate).toFixed(2));
                          const isOverridden = currencyOverrides.includes(curr.code) || prices[curr.code] !== undefined;
                          const currentVal = prices[curr.code] !== undefined ? prices[curr.code] : autoVal;

                          return (
                            <div key={curr.code} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-900/90 border border-slate-800">
                              <div>
                                <span className="text-xs font-mono font-bold text-white flex items-center gap-1">
                                  <span>{curr.code}</span>
                                  <span className="text-slate-500 font-normal">({curr.name})</span>
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono">
                                  1 {curr.code} ≈ {curr.rate.toFixed(1)} KES
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className="relative w-24">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs font-mono text-slate-500">
                                    {curr.symbol}
                                  </span>
                                  <input
                                    type="number"
                                    step="0.1"
                                    min="0.5"
                                    value={currentVal}
                                    onChange={(e) => {
                                      const val = parseFloat(e.target.value);
                                      setPrices(prev => ({ ...prev, [curr.code]: isNaN(val) ? 0 : val }));
                                      if (!currencyOverrides.includes(curr.code)) {
                                        setCurrencyOverrides(prev => [...prev, curr.code]);
                                      }
                                    }}
                                    className="w-full pl-6 pr-2 py-1 rounded bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-sky-500 text-right"
                                  />
                                </div>

                                {isOverridden && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setPrices(prev => {
                                        const next = { ...prev };
                                        delete next[curr.code];
                                        return next;
                                      });
                                      setCurrencyOverrides(prev => prev.filter(c => c !== curr.code));
                                    }}
                                    title="Reset to live auto-calculated rate"
                                    className="p-1 rounded text-slate-500 hover:text-amber-400 text-[10px] font-mono cursor-pointer"
                                  >
                                    Reset
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Featured piece toggle */}
            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-white block">
                  Featured Monograph
                </span>
                <span className="text-[11px] text-slate-400">
                  Highlight prominently on home page
                </span>
              </div>
              <input
                type="checkbox"
                id="featured-toggle"
                checked={featured}
                onChange={(e) => setFeatured(e.target.checked)}
                className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
              />
            </div>

          </div>

          {/* Category & Tags Card */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-5">
            {/* Category & Taxonomy Section */}
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-400" />
                <span>Category &amp; Taxonomy</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsCategoryModalOpen(true)}
                className="text-[10px] font-mono text-sky-400 hover:text-sky-300 bg-sky-950/60 hover:bg-sky-900/60 px-2 py-0.5 rounded border border-sky-800/50 flex items-center gap-1 transition-colors cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Manage Categories</span>
              </button>
            </div>

            {/* Custom Category Selection Checklist */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-mono text-slate-300">
                  Select Categories {selectedCategories.length > 0 && `(${selectedCategories.length})`}
                </label>
                <span className="text-[10px] text-slate-500 font-mono">Custom categories</span>
              </div>

              {availableCategories.length === 0 ? (
                <div className="p-3.5 rounded-xl bg-[#080d1a] border border-dashed border-slate-800 text-center space-y-2">
                  <p className="text-xs text-slate-400">No custom categories created yet.</p>
                  <button
                    type="button"
                    onClick={() => setIsCategoryModalOpen(true)}
                    className="px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-mono inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Add Category</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-1.5 p-2 rounded-xl bg-[#080d1a] border border-slate-800 max-h-48 overflow-y-auto scrollbar-thin">
                  {availableCategories.map((cat) => {
                    const isChecked = selectedCategories.includes(cat.name);
                    return (
                      <label
                        key={cat.id}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all border ${
                          isChecked
                            ? 'bg-sky-950/70 border-sky-500/50 text-white shadow-sm'
                            : 'hover:bg-slate-900/60 text-slate-300 border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            if (isChecked) {
                              const updated = selectedCategories.filter(c => c !== cat.name);
                              setSelectedCategories(updated);
                              if (category === cat.name) {
                                setCategory(updated[0] || '');
                              }
                            } else {
                              const updated = [...selectedCategories, cat.name];
                              setSelectedCategories(updated);
                              if (!category) setCategory(cat.name);
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-0 focus:ring-1"
                        />
                        <span className="text-xs font-medium">{cat.name}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Manual Tag Manager */}
            <div className="space-y-3 pt-2 border-t border-slate-800/80">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-mono text-slate-300">
                  Piece Tags ({tags.length})
                </label>
                <span className="text-[10px] text-slate-500 font-mono">Press Enter or click +</span>
              </div>

              {/* Active Tags Chips */}
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 p-2 rounded-xl bg-[#080d1a]/80 border border-slate-800 min-h-[38px] items-center">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-sky-950/60 border border-sky-800/60 text-sky-300 text-[11px] font-mono group"
                    >
                      <span>#{t}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(t)}
                        className="text-sky-400/60 hover:text-red-400 transition-colors cursor-pointer"
                        title={`Remove tag ${t}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-slate-500 italic">No tags added yet. Add custom tags below.</p>
              )}

              {/* Add Custom Tag Input */}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={customTagInput}
                  onChange={(e) => setCustomTagInput(e.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                  placeholder="Type custom tag & hit Enter..."
                  className="flex-1 px-3 py-2 rounded-xl bg-[#080d1a] border border-slate-700 text-slate-100 text-xs focus:outline-none focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => handleAddTag(customTagInput)}
                  disabled={!customTagInput.trim()}
                  className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-xs font-medium flex items-center gap-1 border border-slate-700 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </div>

              {/* Suggested Tag Pills */}
              <div className="pt-1">
                <div className="text-[10px] font-mono text-slate-400 mb-1.5">Suggested Tags:</div>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_TAGS.map(tagSuggestion => {
                    const isAlreadyAdded = tags.includes(tagSuggestion);
                    return (
                      <button
                        key={tagSuggestion}
                        type="button"
                        onClick={() => handleAddTag(tagSuggestion)}
                        disabled={isAlreadyAdded}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                          isAlreadyAdded
                            ? 'bg-slate-900 border-slate-800 text-slate-600 cursor-not-allowed opacity-50'
                            : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-sky-300 hover:border-sky-800'
                        }`}
                      >
                        <span>#{tagSuggestion}</span>
                        {!isAlreadyAdded && <Plus className="w-2.5 h-2.5 opacity-60" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Reader Discovery Topics Card */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Compass className="w-4 h-4 text-sky-400" />
                <span>Discovery Topics</span>
              </h3>
              <span className="text-[10px] font-mono text-slate-500">
                {selectedTopics.length} selected
              </span>
            </div>

            <p className="text-xs text-slate-400 font-sans">
              Assign this piece to reader discovery topics (e.g. <em>Erotica, Power & Influence, Human Nature</em>) to feature in the homepage catalogue and reader dialogues.
            </p>

            {availableTopics.length === 0 ? (
              <div className="p-3 rounded-xl bg-[#080d1a] border border-dashed border-slate-800 text-center">
                <p className="text-xs text-slate-400">No topics in catalogue yet.</p>
              </div>
            ) : (
              <div className="space-y-1.5 p-2 rounded-xl bg-[#080d1a] border border-slate-800 max-h-48 overflow-y-auto scrollbar-thin">
                {availableTopics.map((top) => {
                  const isChecked = selectedTopics.includes(top.name) || selectedTopics.includes(top.slug);
                  return (
                    <label
                      key={top.id}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-all border ${
                        isChecked
                          ? 'bg-sky-950/70 border-sky-500/50 text-white shadow-sm'
                          : 'hover:bg-slate-900/60 text-slate-300 border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          if (isChecked) {
                            setSelectedTopics(selectedTopics.filter(t => t !== top.name && t !== top.slug));
                          } else {
                            setSelectedTopics([...selectedTopics, top.name]);
                          }
                        }}
                        className="w-4 h-4 rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-500 focus:ring-offset-0 focus:ring-1"
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-medium block truncate">{top.name}</span>
                        {top.description && (
                          <span className="text-[10px] text-slate-500 block truncate">{top.description}</span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Cover Image Card with Custom Cropping & Sizing */}
          <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <span>Featured Cover Image</span>
              </h3>
              {coverImageCrop && (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-sky-950/80 border border-sky-800/80 text-sky-400">
                  {coverImageCrop.aspectRatio.toUpperCase()} • {coverImageCrop.zoom}%
                </span>
              )}
            </div>

            {/* Hidden File Input for Cover Upload */}
            <input
              type="file"
              ref={coverImageFileInputRef}
              onChange={handleCoverFileSelected}
              accept="image/*"
              className="hidden"
            />

            {coverImage && (
              <div className="relative group w-full h-36 rounded-xl overflow-hidden border border-slate-700 bg-slate-900 shadow-inner">
                <img
                  src={coverImage}
                  alt="Cover Preview"
                  className="w-full h-full object-cover"
                />
                
                {/* Floating overlay actions on hover */}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2 backdrop-blur-xs">
                  <button
                    type="button"
                    onClick={handleOpenCropModal}
                    className="px-3 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium flex items-center gap-1.5 shadow-lg transition-colors cursor-pointer"
                  >
                    <Crop className="w-3.5 h-3.5" />
                    <span>Crop &amp; Fit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => coverImageFileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium flex items-center gap-1.5 shadow-lg transition-colors cursor-pointer border border-slate-600"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Replace</span>
                  </button>
                </div>
              </div>
            )}

            {/* Main Action Buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                id="upload-cover-image-btn"
                onClick={() => coverImageFileInputRef.current?.click()}
                className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-sky-400" />
                <span>Upload New</span>
              </button>

              <button
                type="button"
                id="open-crop-modal-btn"
                onClick={handleOpenCropModal}
                disabled={!coverImage}
                className="py-2 px-3 rounded-xl bg-sky-950/80 hover:bg-sky-900/90 text-sky-300 border border-sky-700/80 text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <Crop className="w-3.5 h-3.5 text-sky-400" />
                <span>Crop &amp; Fit</span>
              </button>
            </div>

            <div>
              <label className="block text-xs font-mono text-slate-400 mb-1.5">
                Image URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={coverImage}
                  onChange={(e) => {
                    setCoverImage(e.target.value);
                    setCoverImageOriginal(e.target.value);
                  }}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-slate-200 text-xs focus:outline-none focus:border-sky-500 font-mono"
                />
                {coverImage && (
                  <button
                    type="button"
                    onClick={handleOpenCropModal}
                    title="Crop this URL image"
                    className="p-2 rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:text-white hover:border-sky-500 cursor-pointer transition-colors"
                  >
                    <Crop className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-mono text-slate-500 mb-1.5">
                Curated Executive Presets:
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                {PRESET_COVERS.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setCoverImage(preset.url);
                      setCoverImageOriginal(preset.url);
                      setCoverImageCrop(undefined);
                    }}
                    className="p-1 rounded bg-slate-900 border border-slate-800 hover:border-sky-500 text-[10px] text-slate-400 hover:text-white truncate text-center cursor-pointer transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

        </div>

      </div>

      {/* Revision History Modal Drawer */}
      {showRevisionsModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <History className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Revision History</h3>
                  <p className="text-xs text-slate-400">Restore points saved automatically during editorial work.</p>
                </div>
              </div>
              <button
                onClick={() => setShowRevisionsModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 flex-1 min-h-0">
              {/* Revision List */}
              <div className="md:col-span-5 border border-slate-800 rounded-xl overflow-y-auto max-h-80 divide-y divide-slate-800/60">
                {loadingRevisions ? (
                  <div className="p-8 text-center text-xs font-mono text-slate-500">
                    Loading history...
                  </div>
                ) : revisions.length === 0 ? (
                  <div className="p-8 text-center text-xs font-mono text-slate-500">
                    No revision snapshots recorded yet for this piece.
                  </div>
                ) : (
                  revisions.map((rev) => (
                    <button
                      key={rev.id}
                      type="button"
                      onClick={() => setSelectedRevision(rev)}
                      className={`w-full p-3 text-left transition-colors cursor-pointer ${
                        selectedRevision?.id === rev.id
                          ? 'bg-amber-950/50 border-l-2 border-amber-500'
                          : 'hover:bg-slate-900/80'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs font-mono text-slate-300 mb-0.5">
                        <span className="font-bold">{new Date(rev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        <span className="text-[10px] text-slate-500">{new Date(rev.timestamp).toLocaleDateString()}</span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">{rev.summary || 'Author update'}</p>
                      <span className="text-[10px] font-mono text-slate-500">{rev.wordCount} words</span>
                    </button>
                  ))
                )}
              </div>

              {/* Revision Preview */}
              <div className="md:col-span-7 border border-slate-800 rounded-xl p-4 flex flex-col justify-between max-h-80 overflow-y-auto bg-slate-950/60">
                {selectedRevision ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs font-mono border-b border-slate-800 pb-2">
                      <span className="text-amber-400 font-bold">{selectedRevision.title}</span>
                      <span className="text-slate-500">{selectedRevision.wordCount} words</span>
                    </div>
                    <div className="text-xs text-slate-300 font-serif line-clamp-8 whitespace-pre-wrap">
                      {selectedRevision.content}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic text-center py-12">Select a revision on the left to preview</p>
                )}

                {selectedRevision && (
                  <div className="pt-3 border-t border-slate-800 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRestoreRevision(selectedRevision)}
                      className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium font-sans flex items-center gap-2 cursor-pointer shadow-md"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Restore This Snapshot</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Assistant Modal Drawer */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-[#0f172a] border border-slate-800 rounded-2xl shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold text-white">AI Editorial Collaborator</h3>
              </div>
              <button
                onClick={() => setShowAiModal(false)}
                className="text-slate-400 hover:text-white text-xs font-mono"
              >
                Close
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-2">
                  Assistance Mode
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAiMode('refine_draft')}
                    className={`p-2.5 rounded-lg border text-xs font-medium text-center transition-colors cursor-pointer ${
                      aiMode === 'refine_draft'
                        ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Refine &amp; Elevate Prose
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiMode('generate_outline')}
                    className={`p-2.5 rounded-lg border text-xs font-medium text-center transition-colors cursor-pointer ${
                      aiMode === 'generate_outline'
                        ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Monograph Outline
                  </button>
                  <button
                    type="button"
                    onClick={() => setAiMode('generate_excerpt')}
                    className={`p-2.5 rounded-lg border text-xs font-medium text-center transition-colors cursor-pointer ${
                      aiMode === 'generate_excerpt'
                        ? 'bg-indigo-950/90 border-indigo-500 text-indigo-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Synopsis &amp; Teaser
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-2">
                  Prompt / Instructions (Optional for refining current text)
                </label>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="e.g. Focus on sovereign dealmakers in East Africa and highlight capital discipline..."
                  className="w-full p-3 rounded-xl bg-[#080d1a] border border-slate-700 text-white text-xs focus:outline-none focus:border-indigo-500"
                />
              </div>

              <button
                onClick={handleAiAssist}
                disabled={aiLoading}
                className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {aiLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Analyzing &amp; Crafting...</span>
                  </>
                ) : (
                  <>
                    <Wand2 className="w-4 h-4" />
                    <span>Generate Assistance</span>
                  </>
                )}
              </button>

              {aiResult && (
                <div className="space-y-3 pt-3 border-t border-slate-800">
                  <div className="max-h-60 overflow-y-auto p-4 rounded-xl bg-[#080d1a] border border-slate-700 text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
                    {aiResult}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={handleApplyAiResult}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors cursor-pointer"
                    >
                      Insert into Piece
                    </button>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {/* Image Cropping & Sizing Modal */}
      <ImageCropModal
        isOpen={showCropModal}
        imageUrl={cropModalImageUrl || coverImage}
        originalImageUrl={coverImageOriginal}
        initialCropSettings={coverImageCrop}
        title="Featured Piece Cover Framing & Crop"
        onSave={handleCropSaved}
        onClose={() => setShowCropModal(false)}
      />

      {/* Category Manager Modal */}
      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={availableCategories}
        articles={allPublishedArticles}
        onCategoriesUpdated={(updated) => setAvailableCategories(updated)}
      />

      {/* Bottom Sticky Save Status Bar */}
      <div className="sticky bottom-4 z-40">
        <SaveStatusBar
          idPrefix="writer-editor"
          onSave={() => handleSaveAction()}
          isDirty={isDirty}
          isSaving={saving}
          lastSavedAt={lastSavedTime}
          errorMessage={error}
          saveButtonText={status === 'published' ? 'SAVE & UPDATE' : 'SAVE CHANGES'}
        />
      </div>

      {/* Unsaved Changes Prompt Modal */}
      <UnsavedChangesPromptModal
        isOpen={showUnsavedPrompt}
        isSaving={saving}
        onSaveChanges={async () => {
          await handleSaveAction();
          setShowUnsavedPrompt(false);
          onCancel();
        }}
        onLeaveWithoutSaving={() => {
          setIsDirty(false);
          setShowUnsavedPrompt(false);
          onCancel();
        }}
        onCancel={() => setShowUnsavedPrompt(false)}
      />

    </div>
  );
};


import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { Article, ContentBundle, ContentCollection, HomepageConfig, WelcomeBackgroundSettings } from '../../types.js';
import { HOMEPAGE_SECTION_DEFINITIONS, normalizeHomepageSections } from '../../homepageSections.js';
import { api } from '../../utils/api.js';
import { IMAGE_UPLOAD_ACCEPT, getImageUploadValidationError } from '../../utils/imageUploadPolicy.js';
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
    homepageCollectionIds: [],
    homepageBundleIds: [],
    homepagePieceIds: [],
    homepageLibraryHeading: 'Find Your Shelf',
    homepageLibrarySubtitle: 'Browse by feeling, subject, or the kind of story you want today.',
    homepageBundlesHeading: 'Reading Bundles',
    homepageBundlesSubtitle: 'One payment permanently adds every included piece to the reader library.',
    homepageCollectionsHeading: 'Curated Collections',
    homepageCollectionsSubtitle: 'Read by mood, theme, or the thread that calls to you.',
    homepagePiecesHeading: 'Individual Pieces',
    homepagePiecesSubtitle: 'Selected standalone writing from the archive.',
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
    sections: normalizeHomepageSections(undefined)
  });

  const [publishedPieces, setPublishedPieces] = useState<Article[]>([]);
  const [availableCollections, setAvailableCollections] = useState<ContentCollection[]>([]);
  const [availableBundles, setAvailableBundles] = useState<ContentBundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedConfig, setHasLoadedConfig] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [savingPermanent, setSavingPermanent] = useState(false);
  const [permanentSaved, setPermanentSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configRef = useRef(config);
  const persistedConfigSnapshotRef = useRef<string | null>(null);
  const persistedConfigUpdatedAtRef = useRef<string | null>(null);
  const loadRequestSequenceRef = useRef(0);
  const saveRequestSequenceRef = useRef(0);
  configRef.current = config;

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
    const persistedSnapshot = persistedConfigSnapshotRef.current;
    if (persistedSnapshot === null) {
      return;
    }

    setIsDirty(JSON.stringify(config) !== persistedSnapshot);
  }, [config]);

  useEffect(() => {
    if (onDirtyChange) {
      onDirtyChange(isDirty);
    }
  }, [isDirty, onDirtyChange]);

  // Load admin homepage config from server
  const loadHomepageData = React.useCallback(async () => {
    const requestSequence = ++loadRequestSequenceRef.current;
    const configSnapshotAtRequestStart = JSON.stringify(configRef.current);

    try {
      setLoading(true);
      setError(null);
      const data = await api.getAdminHomepageData();

      if (requestSequence !== loadRequestSequenceRef.current) {
        return;
      }

      if (!data?.config) {
        throw new Error('The homepage response did not include its configuration.');
      }

      if (data.config) {
        const loadedCollections = Array.isArray(data.collections) ? data.collections : [];
        const loadedBundles = Array.isArray(data.bundles) ? data.bundles : [];
        const loadedPieces = Array.isArray(data.allPublishedPieces)
          ? data.allPublishedPieces
          : articles.filter(article => article.status === 'published');
        const defaultCollectionIds = loadedCollections
          .filter(collection => collection.isPublished)
          .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
          .slice(0, 4)
          .map(collection => collection.id);
        const availableCollectionIds = new Set(loadedCollections.map(collection => collection.id));
        const defaultBundleIds = loadedBundles
          .filter(bundle => bundle.isPublished)
          .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.name.localeCompare(right.name))
          .slice(0, 4)
          .map(bundle => bundle.id);
        const availableBundleIds = new Set(loadedBundles.map(bundle => bundle.id));
        const homepageCollectionIds = Array.isArray(data.config.homepageCollectionIds)
          ? data.config.homepageCollectionIds.filter(id => availableCollectionIds.has(id)).slice(0, 6)
          : defaultCollectionIds;
        const homepageBundleIds = Array.isArray(data.config.homepageBundleIds)
          ? data.config.homepageBundleIds.filter(id => availableBundleIds.has(id)).slice(0, 6)
          : defaultBundleIds;
        const representedPieceIds = new Set(
          [
            ...loadedCollections
              .filter(collection => homepageCollectionIds.includes(collection.id))
              .flatMap(collection => collection.pieceIds),
            ...loadedBundles
              .filter(bundle => homepageBundleIds.includes(bundle.id))
              .flatMap(bundle => bundle.pieceIds),
          ]
        );
        const availablePieceIds = new Set(loadedPieces.map(piece => piece.id));
        const defaultPieceIds = [...loadedPieces]
          .filter(piece => !representedPieceIds.has(piece.id))
          .sort((left, right) => Date.parse(right.publishedAt || right.createdAt || '') - Date.parse(left.publishedAt || left.createdAt || ''))
          .slice(0, 8)
          .map(piece => piece.id);
        const loadedConfig: HomepageConfig = {
          // Keep every persisted field, including headings, ordering, and
          // metadata that this editor does not render or directly change.
          ...data.config,
          welcomeBackground: {
            ...data.config.welcomeBackground,
            imageUrl: data.config.welcomeBackground?.imageUrl ?? '',
            fit: data.config.welcomeBackground?.fit ?? 'cover',
            positionX: typeof data.config.welcomeBackground?.positionX === 'number' ? data.config.welcomeBackground.positionX : 50,
            positionY: typeof data.config.welcomeBackground?.positionY === 'number' ? data.config.welcomeBackground.positionY : 50,
            zoom: typeof data.config.welcomeBackground?.zoom === 'number' ? data.config.welcomeBackground.zoom : 100,
            overlayStrength: typeof data.config.welcomeBackground?.overlayStrength === 'number' ? data.config.welcomeBackground.overlayStrength : 25,
          },
          homepageCollectionIds,
          homepageBundleIds,
          homepagePieceIds: Array.isArray(data.config.homepagePieceIds)
            ? data.config.homepagePieceIds
              .filter(id => availablePieceIds.has(id) && !representedPieceIds.has(id))
              .slice(0, 8)
            : defaultPieceIds,
          homepageLibraryHeading: data.config.homepageLibraryHeading ?? 'Find Your Shelf',
          homepageLibrarySubtitle: data.config.homepageLibrarySubtitle ?? 'Browse by feeling, subject, or the kind of story you want today.',
          homepageBundlesHeading: data.config.homepageBundlesHeading ?? 'Reading Bundles',
          homepageBundlesSubtitle: data.config.homepageBundlesSubtitle ?? 'One payment permanently adds every included piece to the reader library.',
          homepageCollectionsHeading: data.config.homepageCollectionsHeading ?? 'Curated Collections',
          homepageCollectionsSubtitle: data.config.homepageCollectionsSubtitle ?? 'Read by mood, theme, or the thread that calls to you.',
          homepagePiecesHeading: data.config.homepagePiecesHeading ?? 'Individual Pieces',
          homepagePiecesSubtitle: data.config.homepagePiecesSubtitle ?? 'Selected standalone writing from the archive.',
          mostSellingPieceIds: Array.isArray(data.config.mostSellingPieceIds) ? data.config.mostSellingPieceIds : [],
          pieceOfTheWeekId: data.config.pieceOfTheWeekId ?? '',
          mostSellingMode: data.config.mostSellingMode ?? 'auto',
          banners: Array.isArray(data.config.banners) ? data.config.banners : [
            {
              id: 'banner-01',
              text: 'New Monograph: The Architecture of Sovereignty is now live.',
              linkText: 'Read Monograph',
              linkUrl: '#piece-the-architecture-of-sovereignty',
              bgStyle: 'sky',
              isVisible: false
            }
          ],
          heroHeadline: data.config.heroHeadline ?? 'INK & WITNESS',
          heroQuote: data.config.heroQuote ?? '“I write because the heart keeps a ledger the tongue is too proud to read.”',
          heroSubheadline: data.config.heroSubheadline ?? 'An archive of lived experience, intimacy, power, and memory authored by Jake.',
          heroBadge: data.config.heroBadge ?? 'Ink & Witness Narratives',
          sections: normalizeHomepageSections(data.config.sections)
        };
        const currentConfigSnapshot = JSON.stringify(configRef.current);
        const persistedConfigSnapshot = persistedConfigSnapshotRef.current;
        const configChangedDuringLoad = currentConfigSnapshot !== configSnapshotAtRequestStart;
        const hasUnsavedChanges = configChangedDuringLoad || (
          persistedConfigSnapshot !== null &&
          currentConfigSnapshot !== persistedConfigSnapshot
        );

        // Article refreshes also reload this endpoint. Do not let that response
        // overwrite edits which were made after the last successful hydration/save.
        const loadedConfigSnapshot = JSON.stringify(loadedConfig);
        if (!hasUnsavedChanges) {
          persistedConfigSnapshotRef.current = loadedConfigSnapshot;
          persistedConfigUpdatedAtRef.current = data.config.updatedAt ?? null;
          configRef.current = loadedConfig;
          setConfig(loadedConfig);
          setIsDirty(false);
          setHasLoadedConfig(true);
        } else if (persistedConfigSnapshot === null) {
          // A user can begin editing while the initial request is in flight.
          // Keep that local edit, but establish the server response as its
          // comparison baseline so the unsaved state remains visible.
          persistedConfigSnapshotRef.current = loadedConfigSnapshot;
          persistedConfigUpdatedAtRef.current = data.config.updatedAt ?? null;
          setIsDirty(currentConfigSnapshot !== loadedConfigSnapshot);
          setHasLoadedConfig(true);
        }
        if (!hasUnsavedChanges || persistedConfigSnapshot === null) {
          setLastSavedAt(data.config.lastSavedAt || data.config.updatedAt || null);
        }
        setAvailableCollections(loadedCollections);
        setAvailableBundles(loadedBundles);
      }
      if (data.allPublishedPieces) {
        setPublishedPieces(data.allPublishedPieces);
      } else {
        // Filter from props
        setPublishedPieces(articles.filter(a => a.status === 'published'));
      }
    } catch (err: any) {
      if (requestSequence !== loadRequestSequenceRef.current) {
        return;
      }

      console.error('Failed to load homepage settings:', err);
      setError(persistedConfigSnapshotRef.current === null
        ? 'Failed to load homepage settings from the server. Saving is unavailable until a successful reload.'
        : 'Could not refresh homepage settings. Your current edits are preserved; a save may require conflict resolution.');
      setPublishedPieces(articles.filter(a => a.status === 'published'));
    } finally {
      if (requestSequence === loadRequestSequenceRef.current) {
        setLoading(false);
      }
    }
  }, [articles]);

  useEffect(() => {
    void loadHomepageData();

    return () => {
      // Invalidate the in-flight request on dependency change or unmount.
      loadRequestSequenceRef.current += 1;
    };
  }, [loadHomepageData]);

  const handleSave = async () => {
    if (!hasLoadedConfig) {
      setError('Load the current homepage settings before saving.');
      return;
    }
    const requestSequence = ++saveRequestSequenceRef.current;
    const configToSave = config;
    const configSnapshotToSave = JSON.stringify(configToSave);
    const expectedUpdatedAt = persistedConfigUpdatedAtRef.current;

    try {
      setSaving(true);
      setError(null);
      const response = await api.saveAdminHomepageData(configToSave, expectedUpdatedAt);
      if (requestSequence !== saveRequestSequenceRef.current) return;
      if (!response?.config?.updatedAt) {
        throw new Error('The server did not return the saved homepage version. Reload before saving again.');
      }
      persistedConfigSnapshotRef.current = configSnapshotToSave;
      persistedConfigUpdatedAtRef.current = response.config.updatedAt;
      setIsDirty(JSON.stringify(configRef.current) !== configSnapshotToSave);
      setLastSavedAt(response.config.lastSavedAt || response.config.updatedAt);
      window.dispatchEvent(new Event('ink-homepage-updated'));
      try {
        window.localStorage.setItem('ink-homepage-version', response.config.updatedAt);
      } catch {
        // Storage can be disabled; same-tab updates still use the event above.
      }
      if (onRefreshArticles) onRefreshArticles();
    } catch (err: any) {
      if (requestSequence !== saveRequestSequenceRef.current) return;
      console.error('Error saving homepage configuration:', err);
      setError((err as { status?: number }).status === 409
        ? 'The homepage changed in another session. Your edits are still here and were not saved. Copy them before reloading the latest settings.'
        : err.message || 'Failed to save homepage settings.');
    } finally {
      if (requestSequence === saveRequestSequenceRef.current) {
        setSaving(false);
      }
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validationError = getImageUploadValidationError(file);
    if (validationError) {
      setError(validationError);
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
        mostSellingPieceIds: newIds,
        // Choosing a display slot is an explicit editorial override. Without
        // this switch, the server continues to resolve the automatic ranking
        // and the saved manual selection appears to have been ignored.
        mostSellingMode: 'manual'
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

  const selectedCollectionIds = config.homepageCollectionIds || [];
  const selectedBundleIds = config.homepageBundleIds || [];
  const selectedPieceIds = config.homepagePieceIds || [];
  const homepageSections = useMemo(
    () => normalizeHomepageSections(config.sections),
    [config.sections]
  );
  const selectedCollections = useMemo(() => {
    const byId = new Map(availableCollections.map(collection => [collection.id, collection]));
    return selectedCollectionIds
      .map(id => byId.get(id))
      .filter((collection): collection is ContentCollection => Boolean(collection));
  }, [availableCollections, selectedCollectionIds]);
  const selectedBundles = useMemo(() => {
    const byId = new Map(availableBundles.map(bundle => [bundle.id, bundle]));
    return selectedBundleIds
      .map(id => byId.get(id))
      .filter((bundle): bundle is ContentBundle => Boolean(bundle));
  }, [availableBundles, selectedBundleIds]);
  const piecesRepresentedByGroups = useMemo(
    () => new Set([
      ...selectedCollections.flatMap(collection => collection.pieceIds),
      ...selectedBundles.flatMap(bundle => bundle.pieceIds),
    ]),
    [selectedBundles, selectedCollections]
  );

  const toggleHomepageCollection = (collection: ContentCollection) => {
    setError(null);
    const isSelected = selectedCollectionIds.includes(collection.id);
    if (!isSelected && selectedCollectionIds.length >= 6) {
      setError('The homepage can show up to six collections. Remove one before adding another.');
      return;
    }
    setConfig(previous => {
      const current = previous.homepageCollectionIds || [];
      if (current.includes(collection.id)) {
        return {
          ...previous,
          homepageCollectionIds: current.filter(id => id !== collection.id),
        };
      }
      return {
        ...previous,
        homepageCollectionIds: [...current, collection.id],
        homepagePieceIds: (previous.homepagePieceIds || []).filter(id => !collection.pieceIds.includes(id)),
      };
    });
  };

  const toggleHomepageBundle = (bundle: ContentBundle) => {
    setError(null);
    const isSelected = selectedBundleIds.includes(bundle.id);
    if (!isSelected && selectedBundleIds.length >= 6) {
      setError('The homepage can show up to six bundles. Remove one before adding another.');
      return;
    }
    setConfig(previous => {
      const current = previous.homepageBundleIds || [];
      if (current.includes(bundle.id)) {
        return { ...previous, homepageBundleIds: current.filter(id => id !== bundle.id) };
      }
      return {
        ...previous,
        homepageBundleIds: [...current, bundle.id],
        homepagePieceIds: (previous.homepagePieceIds || []).filter(id => !bundle.pieceIds.includes(id)),
      };
    });
  };

  const toggleHomepagePiece = (pieceId: string) => {
    setError(null);
    if (piecesRepresentedByGroups.has(pieceId)) {
      setError('That piece is already represented by a selected collection or bundle and cannot be repeated.');
      return;
    }
    const isSelected = selectedPieceIds.includes(pieceId);
    if (!isSelected && selectedPieceIds.length >= 8) {
      setError('The homepage can show up to eight individual pieces. Remove one before adding another.');
      return;
    }
    setConfig(previous => {
      const current = previous.homepagePieceIds || [];
      if (current.includes(pieceId)) {
        return { ...previous, homepagePieceIds: current.filter(id => id !== pieceId) };
      }
      return { ...previous, homepagePieceIds: [...current, pieceId] };
    });
  };

  const moveHomepageItem = (
    field: 'homepageCollectionIds' | 'homepageBundleIds' | 'homepagePieceIds',
    id: string,
    direction: -1 | 1
  ) => {
    setConfig(previous => {
      const current = [...(previous[field] || [])];
      const index = current.indexOf(id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return previous;
      [current[index], current[nextIndex]] = [current[nextIndex], current[index]];
      return { ...previous, [field]: current };
    });
  };

  const setHomepageSectionVisibility = (sectionId: string, isVisible: boolean) => {
    setConfig(previous => ({
      ...previous,
      sections: normalizeHomepageSections(previous.sections).map(section => (
        section.id === sectionId ? { ...section, isVisible } : section
      )),
    }));
  };

  const moveHomepageSection = (sectionId: string, direction: -1 | 1) => {
    setConfig(previous => {
      const sections = normalizeHomepageSections(previous.sections);
      const index = sections.findIndex(section => section.id === sectionId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= sections.length) return previous;
      [sections[index], sections[nextIndex]] = [sections[nextIndex], sections[index]];
      return {
        ...previous,
        sections: sections.map((section, sectionIndex) => ({
          ...section,
          order: sectionIndex + 1,
        })),
      };
    });
  };

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
            disabled={loading || !hasLoadedConfig}
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
      {!hasLoadedConfig && !loading && (
        <button
          type="button"
          onClick={() => void loadHomepageData()}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-700 hover:bg-sky-600 text-white text-xs font-semibold"
        >
          <RefreshCw className="w-4 h-4" />
          Retry loading homepage settings
        </button>
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
              accept={IMAGE_UPLOAD_ACCEPT}
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
      {/* 3. PUBLIC LIBRARY, BUNDLES, COLLECTIONS & INDIVIDUAL PIECES */}
      {/* ============================================================ */}
      {activeSubTab === 'overview' && (
      <section id="section-homepage-curation" className="space-y-8 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-sky-400">
              <Layers className="h-4 w-4" />
              <span>Reader discovery</span>
            </div>
            <h3 className="font-display text-xl font-bold text-white">Library, bundles, collections and pieces</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
              Categories act as library shelves. Bundles are paid sets; collections are free browsing groups. Pieces already represented by either are excluded from the individual shelf.
            </p>
          </div>
          <div className="rounded-full border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-[10px] text-slate-400">
            {selectedBundleIds.length}/6 bundles &middot; {selectedCollectionIds.length}/6 collections &middot; {selectedPieceIds.length}/8 pieces
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Library guide heading</span>
            <input
              type="text"
              maxLength={120}
              value={config.homepageLibraryHeading || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageLibraryHeading: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Library guide description</span>
            <input
              type="text"
              maxLength={300}
              value={config.homepageLibrarySubtitle || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageLibrarySubtitle: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Bundles heading</span>
            <input
              type="text"
              maxLength={120}
              value={config.homepageBundlesHeading || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageBundlesHeading: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Bundles description</span>
            <input
              type="text"
              maxLength={300}
              value={config.homepageBundlesSubtitle || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageBundlesSubtitle: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-emerald-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Collections heading</span>
            <input
              type="text"
              maxLength={120}
              value={config.homepageCollectionsHeading || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageCollectionsHeading: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Collections description</span>
            <input
              type="text"
              maxLength={300}
              value={config.homepageCollectionsSubtitle || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepageCollectionsSubtitle: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Individual pieces heading</span>
            <input
              type="text"
              maxLength={120}
              value={config.homepagePiecesHeading || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepagePiecesHeading: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
          <label className="space-y-1.5 text-xs text-slate-300">
            <span className="font-mono">Individual pieces description</span>
            <input
              type="text"
              maxLength={300}
              value={config.homepagePiecesSubtitle || ''}
              onChange={event => setConfig(previous => ({ ...previous, homepagePiecesSubtitle: event.target.value }))}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-white outline-none focus:border-sky-500"
            />
          </label>
        </div>

        <div className="rounded-2xl border border-sky-900/60 bg-sky-950/20 p-4 text-xs leading-relaxed text-slate-300">
          <span className="font-semibold text-sky-200">Library shelf control:</span>{' '}
          the homepage guide uses your enabled Categories in their saved order. Rename, describe, reorder, enable, or disable those shelves through <span className="font-semibold text-white">Categories</span> in Writer Studio; pieces inherit the shelves assigned in the editor.
        </div>

        <div className="space-y-4 rounded-2xl border border-emerald-950/80 bg-emerald-950/10 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-white">Homepage bundles</h4>
              <p className="mt-1 text-[11px] text-slate-500">Select published paid sets and arrange their order within the bundle section. Bundle prices, JPEG covers, and cover focal points are managed in Reader Experience.</p>
            </div>
            <span className="font-mono text-[10px] text-emerald-400">{selectedBundleIds.length}/6</span>
          </div>

          {selectedBundles.length > 0 && (
            <div className="space-y-2">
              {selectedBundles.map((bundle, index) => (
                <div key={bundle.id} className="flex items-center gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/20 p-2.5">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                    {bundle.coverImage ? (
                      <img
                        src={bundle.coverImage}
                        alt=""
                        style={{ objectPosition: `${bundle.coverPosition?.x ?? 50}% ${bundle.coverPosition?.y ?? 50}%` }}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Layers className="m-3 h-6 w-6 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">{bundle.name}</p>
                    <p className="text-[10px] text-slate-500">{bundle.pieceIds.length} pieces &middot; KSh {bundle.priceKes.toLocaleString('en-KE')}</p>
                  </div>
                  <button type="button" aria-label={`Move ${bundle.name} up`} disabled={index === 0} onClick={() => moveHomepageItem('homepageBundleIds', bundle.id, -1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Move ${bundle.name} down`} disabled={index === selectedBundles.length - 1} onClick={() => moveHomepageItem('homepageBundleIds', bundle.id, 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => toggleHomepageBundle(bundle)} className="rounded-lg px-2.5 py-2 text-[10px] font-semibold text-rose-300 hover:bg-rose-950/60">Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {availableBundles.filter(bundle => bundle.isPublished).map(bundle => {
              const selected = selectedBundleIds.includes(bundle.id);
              return (
                <button
                  key={bundle.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleHomepageBundle(bundle)}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-emerald-500 bg-emerald-950/50 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{bundle.name}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">{bundle.pieceIds.length} pieces &middot; KSh {bundle.priceKes.toLocaleString('en-KE')}</span>
                  </span>
                  <span className="font-mono text-[10px] text-emerald-400">{selected ? 'Selected' : 'Add'}</span>
                </button>
              );
            })}
            {availableBundles.filter(bundle => bundle.isPublished).length === 0 && (
              <p className="col-span-full rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
                Create and publish a priced bundle in Reader Experience first; it will then be available here.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-white">Homepage collections</h4>
              <p className="mt-1 text-[11px] text-slate-500">Select published collections, then use the arrows to set their public order.</p>
            </div>
            <span className="font-mono text-[10px] text-sky-400">{selectedCollectionIds.length}/6</span>
          </div>

          {selectedCollections.length > 0 && (
            <div className="space-y-2">
              {selectedCollections.map((collection, index) => (
                <div key={collection.id} className="flex items-center gap-3 rounded-xl border border-sky-900/60 bg-sky-950/20 p-2.5">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
                    {collection.coverImage ? (
                      <img
                        src={collection.coverImage}
                        alt=""
                        style={{ objectPosition: `${collection.coverPosition?.x ?? 50}% ${collection.coverPosition?.y ?? 50}%` }}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Layers className="m-3 h-6 w-6 text-slate-600" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-white">{collection.name}</p>
                    <p className="text-[10px] text-slate-500">{collection.pieceIds.length} pieces</p>
                  </div>
                  <button type="button" aria-label={`Move ${collection.name} up`} disabled={index === 0} onClick={() => moveHomepageItem('homepageCollectionIds', collection.id, -1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                    <ChevronUp className="h-4 w-4" />
                  </button>
                  <button type="button" aria-label={`Move ${collection.name} down`} disabled={index === selectedCollections.length - 1} onClick={() => moveHomepageItem('homepageCollectionIds', collection.id, 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                    <ChevronDown className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => toggleHomepageCollection(collection)} className="rounded-lg px-2.5 py-2 text-[10px] font-semibold text-rose-300 hover:bg-rose-950/60">Remove</button>
                </div>
              ))}
            </div>
          )}

          <div className="grid max-h-64 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {availableCollections.filter(collection => collection.isPublished).map(collection => {
              const selected = selectedCollectionIds.includes(collection.id);
              return (
                <button
                  key={collection.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleHomepageCollection(collection)}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-sky-500 bg-sky-950/50 text-white' : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{collection.name}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">{collection.pieceIds.length} pieces</span>
                  </span>
                  <span className="font-mono text-[10px] text-sky-400">{selected ? 'Selected' : 'Add'}</span>
                </button>
              );
            })}
            {availableCollections.filter(collection => collection.isPublished).length === 0 && (
              <p className="col-span-full rounded-xl border border-dashed border-slate-800 p-4 text-center text-xs text-slate-500">
                Publish a collection in Reader Experience first; it will then be available here.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-950/70 p-4 sm:p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold text-white">Individual pieces</h4>
              <p className="mt-1 text-[11px] text-slate-500">Pieces already represented by a selected collection or bundle are unavailable, preventing duplicate homepage appearances.</p>
            </div>
            <span className="font-mono text-[10px] text-sky-400">{selectedPieceIds.length}/8</span>
          </div>

          {selectedPieceIds.length > 0 && (
            <div className="space-y-2">
              {selectedPieceIds.map((pieceId, index) => {
                const piece = getArticleById(pieceId);
                if (!piece) return null;
                return (
                  <div key={pieceId} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-white">{piece.title}</p>
                      <p className="text-[10px] text-slate-500">{piece.category}</p>
                    </div>
                    <button type="button" aria-label={`Move ${piece.title} up`} disabled={index === 0} onClick={() => moveHomepageItem('homepagePieceIds', pieceId, -1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button type="button" aria-label={`Move ${piece.title} down`} disabled={index === selectedPieceIds.length - 1} onClick={() => moveHomepageItem('homepagePieceIds', pieceId, 1)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-25">
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => toggleHomepagePiece(pieceId)} className="rounded-lg px-2.5 py-2 text-[10px] font-semibold text-rose-300 hover:bg-rose-950/60">Remove</button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {publishedPieces.map(piece => {
              const selected = selectedPieceIds.includes(piece.id);
              const represented = piecesRepresentedByGroups.has(piece.id);
              return (
                <button
                  key={piece.id}
                  type="button"
                  aria-pressed={selected}
                  disabled={represented}
                  onClick={() => toggleHomepagePiece(piece.id)}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors ${selected ? 'border-sky-500 bg-sky-950/50 text-white' : represented ? 'cursor-not-allowed border-slate-900 bg-slate-950 text-slate-600 opacity-60' : 'border-slate-800 bg-slate-900/60 text-slate-300 hover:border-slate-700'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{piece.title}</span>
                    <span className="mt-0.5 block text-[10px] text-slate-500">{piece.category}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-sky-400">{represented ? 'Already grouped' : selected ? 'Selected' : 'Add'}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
      )}

      {(activeSubTab === 'overview' || activeSubTab === 'sections') && (
      <section id="section-layout-ordering" className="space-y-6 rounded-3xl border border-slate-800 bg-slate-900/60 p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-emerald-400">
              <Sliders className="w-4 h-4" />
              <span>Homepage structure</span>
            </div>
            <h3 className="font-display text-xl font-bold text-white">Section visibility and order</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
              Switch any public section on or off, then use the arrows to set the exact order readers see. Hidden sections keep their saved content and can be restored later.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {homepageSections.map((section, index) => {
            const definition = HOMEPAGE_SECTION_DEFINITIONS.find(item => item.id === section.id);
            return (
            <div key={section.id} className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center ${section.isVisible ? 'border-slate-700 bg-slate-950' : 'border-slate-800 bg-slate-950/50 opacity-75'}`}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-800 bg-slate-900 font-mono text-xs text-slate-400">{index + 1}</span>
                <div className="min-w-0">
                  <h5 className="text-sm font-semibold text-slate-100">{definition?.title || section.title || section.id}</h5>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{definition?.description}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-[11px] font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={section.isVisible}
                    onChange={event => setHomepageSectionVisibility(section.id, event.target.checked)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  {section.isVisible ? 'Shown' : 'Hidden'}
                </label>
                <button
                  type="button"
                  aria-label={`Move ${definition?.title || section.id} up`}
                  disabled={index === 0}
                  onClick={() => moveHomepageSection(section.id, -1)}
                  className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${definition?.title || section.id} down`}
                  disabled={index === homepageSections.length - 1}
                  onClick={() => moveHomepageSection(section.id, 1)}
                  className="rounded-lg border border-slate-800 p-2 text-slate-400 hover:border-slate-700 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-25"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>
            </div>
          );})}
        </div>

        <p className="rounded-xl border border-amber-900/50 bg-amber-950/20 px-4 py-3 text-[11px] leading-relaxed text-amber-100/80">
          Use <span className="font-semibold text-amber-100">Save Homepage</span> after arranging the list. Hiding bundles, collections, or pieces never deletes those records or changes reader access.
        </p>
      </section>
      )}

      {/* ============================================================ */}
      {/* 4. MOST SELLING PIECES (3 CURATED PIECES) */}
      {/* ============================================================ */}
      {false && (activeSubTab === 'overview' || activeSubTab === 'sections') && (
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
      {false && (activeSubTab === 'overview' || activeSubTab === 'sections') && (
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
                      {piece.showReadTime !== false && (
                        <>
                          <span>{piece.readTimeMinutes} min read</span>
                          <span>•</span>
                        </>
                      )}
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
          disabled={loading || !hasLoadedConfig}
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
          disabled={loading || !hasLoadedConfig}
        />
      </div>

    </div>
  );
};

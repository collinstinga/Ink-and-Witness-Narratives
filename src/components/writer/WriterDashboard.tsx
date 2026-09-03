import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  LayoutDashboard, 
  FileText, 
  PenTool, 
  Edit3, 
  Globe, 
  CreditCard, 
  Heart, 
  Sliders, 
  ExternalLink, 
  LogOut, 
  Menu, 
  X, 
  Sparkles, 
  ShieldCheck, 
  ChevronRight, 
  BookOpen, 
  LayoutTemplate, 
  BarChart3, 
  Users, 
  Image as ImageIcon, 
  Layers, 
  MessageSquare, 
  Compass, 
  Share2,
  CheckCircle2,
  Save
} from 'lucide-react';
import { 
  Article, 
  AuthorProfile, 
  MpesaConfig, 
  PaymentTransaction, 
  DashboardStats, 
  WriterNavTab, 
  Category,
  User
} from '../../types.js';
import { api, getWriterToken, setWriterToken, clearWriterToken } from '../../utils/api.js';
import { WriterLogin } from './WriterLogin.js';
import { WriterOverview } from './WriterOverview.js';
import { WriterPiecesList } from './WriterPiecesList.js';
import { WriterEditor } from './WriterEditor.js';
import { WriterPayments } from './WriterPayments.js';
import { WriterTips } from './WriterTips.js';
import { WriterSettings } from './WriterSettings.js';
import { HomepageManager } from './HomepageManager.js';
import { WriterAnalytics } from './WriterAnalytics.js';
import { WriterReaders } from './WriterReaders.js';
import { WriterMedia } from './WriterMedia.js';
import { WriterComments } from './WriterComments.js';
import { CategoryManagerModal } from './CategoryManagerModal.js';
import { TopicManagementTab } from './TopicManagementTab.js';
import { AffiliatesAdminTab } from './AffiliatesAdminTab.js';

interface WriterDashboardProps {
  onClose: () => void;
  onPreviewArticle: (article: Article) => void;
  currentUser?: User | null;
  onLoginSuccess?: (user: User) => void;
  onLogout?: () => void;
  initialTab?: WriterNavTab;
  initialSubTab?: string;
  initialPieceId?: string | null;
  onNavigateTab?: (tab: WriterNavTab, subTab?: string, pieceId?: string | null) => void;
}

export const WriterDashboard: React.FC<WriterDashboardProps> = ({
  onClose,
  onPreviewArticle,
  currentUser,
  onLoginSuccess,
  onLogout,
  initialTab = 'overview',
  initialSubTab,
  initialPieceId,
  onNavigateTab
}) => {
  const [authToken, setAuthToken] = useState<string | null>(getWriterToken());
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(currentUser?.role === 'admin');
  const [checkingAuth, setCheckingAuth] = useState<boolean>(currentUser?.role === 'admin' ? false : true);

  // Permanent Save State
  const [savingPermanently, setSavingPermanently] = useState<boolean>(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState<string | null>(null);

  // Active View Tab
  const [currentTab, setCurrentTab] = useState<WriterNavTab>(initialTab || 'overview');
  const [currentSubTab, setCurrentSubTab] = useState<string | undefined>(initialSubTab);
  const [mobileNavOpen, setMobileNavOpen] = useState<boolean>(false);

  // Sync with initialTab prop if it changes externally
  useEffect(() => {
    if (initialTab && initialTab !== currentTab) {
      setCurrentTab(initialTab);
    }
    if (initialSubTab !== undefined) {
      setCurrentSubTab(initialSubTab);
    }
  }, [initialTab, initialSubTab]);

  const handleTabChange = (tab: WriterNavTab, subTab?: string, pieceId?: string | null) => {
    setCurrentTab(tab);
    setCurrentSubTab(subTab);
    setMobileNavOpen(false);
    onNavigateTab?.(tab, subTab, pieceId);
  };

  // Data states
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [pieces, setPieces] = useState<Article[]>([]);
  const [transactions, setTransactions] = useState<PaymentTransaction[]>([]);
  const [tips, setTips] = useState<PaymentTransaction[]>([]);
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [mpesaConfig, setMpesaConfig] = useState<MpesaConfig | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState<boolean>(false);

  // Editor state
  const [editingPiece, setEditingPiece] = useState<Article | null>(null);

  const [loading, setLoading] = useState<boolean>(false);
  const loadedSections = useRef<Set<string>>(new Set());

  // Verify auth session on mount
  useEffect(() => {
    const verify = async () => {
      const token = getWriterToken();
      try {
        const me = await api.authGetMe();
        if (me.authenticated && me.user && me.user.role === 'admin') {
          setIsAuthenticated(true);
          const activeTok = token || me.user.sessionId || null;
          setAuthToken(activeTok);
          if (!token && me.user.sessionId) setWriterToken(me.user.sessionId);
          if (onLoginSuccess && me.user) onLoginSuccess(me.user);
          return;
        }

        if (token) {
          const isValid = await api.adminVerifySession(token);
          if (isValid) {
            setIsAuthenticated(true);
            setAuthToken(token);
            return;
          }
        }

        if (currentUser?.role === 'admin') {
          setIsAuthenticated(true);
          return;
        }

        clearWriterToken();
        setIsAuthenticated(false);
        setAuthToken(null);
      } catch {
        if (currentUser?.role === 'admin') {
          setIsAuthenticated(true);
        } else {
          setIsAuthenticated(false);
          setAuthToken(null);
        }
      } finally {
        setCheckingAuth(false);
      }
    };

    verify();
  }, [currentUser]);

  // Fetch the minimum needed to render the overview. Large, section-specific
  // datasets are loaded only when the writer opens the corresponding section.
  const loadOverviewData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    const startedAt = Date.now();
    try {
      const [statsData, piecesData] = await Promise.all([
        api.getDashboardStats().catch(() => null),
        api.getAdminArticles().catch(() => [])
      ]);

      if (statsData) setStats(statsData);
      setPieces(piecesData);
      loadedSections.current.add('overview');
      console.info(`[Writer Studio] Overview ready in ${Date.now() - startedAt}ms`);
    } catch (err) {
      console.error('Failed to load writer overview', err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Full refresh remains available after explicit save/edit actions, where all
  // related views need to reflect the newly persisted state.
  const loadDashboardData = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const [statsData, piecesData, txData, tipsData, authorData, mpesaData, categoriesData] = await Promise.all([
        api.getDashboardStats().catch(() => null),
        api.getAdminArticles().catch(() => []),
        api.getAdminTransactions().catch(() => ({ totalRevenueKes: 0, count: 0, transactions: [] })),
        api.getAdminTips().catch(() => ({ totalTipsKes: 0, count: 0, verifiedCount: 0, tips: [] })),
        api.getAuthor().catch(() => null),
        api.getMpesaConfig().catch(() => null),
        api.getCategories().catch(() => [])
      ]);

      if (statsData) setStats(statsData);
      setPieces(piecesData);
      setTransactions(txData.transactions || []);
      setTips(tipsData.tips || []);
      if (authorData) setAuthor(authorData);
      if (mpesaData) setMpesaConfig(mpesaData);
      setCategories(categoriesData || []);
    } catch (err) {
      console.error("Failed to load dashboard data", err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated) {
      loadOverviewData();
    }
  }, [isAuthenticated, loadOverviewData]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const loadSectionData = async () => {
      if (currentTab === 'payments' && !loadedSections.current.has('payments')) {
        const data = await api.getAdminTransactions().catch(() => ({ totalRevenueKes: 0, count: 0, transactions: [] }));
        setTransactions(data.transactions || []);
        loadedSections.current.add('payments');
      } else if (currentTab === 'tips' && !loadedSections.current.has('tips')) {
        const data = await api.getAdminTips().catch(() => ({ totalTipsKes: 0, count: 0, verifiedCount: 0, tips: [] }));
        setTips(data.tips || []);
        loadedSections.current.add('tips');
      } else if (currentTab === 'media' && !loadedSections.current.has('author')) {
        const data = await api.getAuthor().catch(() => null);
        if (data) setAuthor(data);
        loadedSections.current.add('author');
      } else if (currentTab === 'settings' && !loadedSections.current.has('settings')) {
        const [authorData, mpesaData] = await Promise.all([
          api.getAuthor().catch(() => null),
          api.getMpesaConfig().catch(() => null)
        ]);
        if (authorData) setAuthor(authorData);
        if (mpesaData) setMpesaConfig(mpesaData);
        loadedSections.current.add('author');
        loadedSections.current.add('settings');
      }
    };

    void loadSectionData();
  }, [currentTab, isAuthenticated]);

  const openCategoryManager = async () => {
    setIsCategoryModalOpen(true);
    setMobileNavOpen(false);
    if (loadedSections.current.has('categories')) return;
    const data = await api.getCategories().catch(() => []);
    setCategories(data || []);
    loadedSections.current.add('categories');
  };

  // Handlers
  const handleLoginSuccess = (token: string, user?: any) => {
    setWriterToken(token);
    setAuthToken(token);
    setIsAuthenticated(true);
    if (user && onLoginSuccess) {
      onLoginSuccess(user);
    }
    setCurrentTab('overview');
    loadDashboardData();
  };

  const handleLogout = async () => {
    try {
      await api.adminLogout();
    } catch {}
    clearWriterToken();
    setAuthToken(null);
    setIsAuthenticated(false);
    if (onLogout) {
      onLogout();
    }
    onClose();
    if (window.location.hash.startsWith('#writer') || window.location.hash.startsWith('#sign-in')) {
      window.location.hash = '#home';
    }
  };

  const handleSavePermanently = async () => {
    if (savingPermanently) return;
    setSavingPermanently(true);
    setSaveSuccessNotice(null);
    try {
      const res = await api.savePermanently('author_portal_action');
      if (res.success) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLastSavedTimestamp(timeStr);
        setSaveSuccessNotice(`Baseline Permanently Saved (${res.piecesCount} pieces)`);
        setTimeout(() => {
          setSaveSuccessNotice(null);
        }, 5000);
        await loadDashboardData();
      } else {
        alert(res.message || 'Failed to save permanently.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error while saving permanently.');
    } finally {
      setSavingPermanently(false);
    }
  };

  const handleNewPiece = () => {
    setEditingPiece(null);
    handleTabChange('editor', 'content', null);
  };

  const handleEditPiece = (piece: Article) => {
    setEditingPiece(piece);
    handleTabChange('editor', 'content', piece.id);
  };

  const handleSavePiece = async (articleData: Partial<Article>): Promise<Article> => {
    let saved: Article;
    if (editingPiece?.id) {
      const res = await api.updateArticle(editingPiece.id, articleData);
      saved = res.article;
      setPieces(prev => prev.map(p => p.id === saved.id ? saved : p));
    } else {
      const res = await api.createArticle(articleData);
      saved = res.article;
      setPieces(prev => [saved, ...prev]);
    }
    setEditingPiece(saved);
    await loadDashboardData();
    return saved;
  };

  const handleTogglePublish = async (id: string) => {
    try {
      const piece = pieces.find(p => p.id === id);
      if (!piece) return;
      const nextStatus = piece.status === 'published' ? 'draft' : 'published';
      const updated = await api.updateArticle(id, { status: nextStatus });
      setPieces(prev => prev.map(p => p.id === id ? updated : p));
      await loadDashboardData();
    } catch (err) {
      console.error("Failed to toggle publish status", err);
    }
  };

  const handleDeletePiece = async (id: string) => {
    if (!window.confirm("Are you sure you want to permanently delete this monograph? This action cannot be undone.")) {
      return;
    }
    try {
      await api.deleteArticle(id);
      setPieces(prev => prev.filter(p => p.id !== id));
      await loadDashboardData();
    } catch (err) {
      console.error("Failed to delete piece", err);
    }
  };

  // Checking Auth State
  if (checkingAuth) {
    return (
      <div className="fixed inset-0 z-50 bg-[#050811] flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin" />
          <p className="text-xs font-mono text-slate-400">Verifying secure author session...</p>
        </div>
      </div>
    );
  }

  // Not authenticated -> Show Login screen
  if (!isAuthenticated) {
    return (
      <WriterLogin
        onSuccess={handleLoginSuccess}
        onCancel={onClose}
      />
    );
  }

  const draftCount = pieces.filter(p => p.status === 'draft').length;
  const publishedCount = pieces.filter(p => p.status === 'published').length;

  return (
    <div id="writer-dashboard-root" className="fixed inset-0 z-50 bg-[#050811] text-slate-100 flex flex-col md:flex-row overflow-hidden font-sans">
      
      {/* Mobile Top Header */}
      <header className="md:hidden flex items-center justify-between px-4 py-3 bg-[#080d1a] border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold font-serif">
            IW
          </div>
          <span className="font-serif font-bold text-sm tracking-tight text-white">Writer Studio</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            id="mobile-save-permanently-btn"
            onClick={handleSavePermanently}
            disabled={savingPermanently}
            className="px-2.5 py-1.5 rounded-lg bg-sky-950 border border-sky-600/70 text-sky-200 text-xs font-mono flex items-center gap-1.5 cursor-pointer"
            title="Save Permanently"
          >
            {savingPermanently ? (
              <div className="w-3 h-3 rounded-full border border-sky-400 border-t-transparent animate-spin" />
            ) : saveSuccessNotice ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Save className="w-3.5 h-3.5 text-sky-400" />
            )}
            <span className="text-[11px]">{savingPermanently ? 'Saving...' : saveSuccessNotice ? 'Saved' : 'Save'}</span>
          </button>

          <button
            onClick={() => setMobileNavOpen(!mobileNavOpen)}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white"
          >
            {mobileNavOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* Sidebar Navigation */}
      <aside className={`
        fixed inset-y-0 left-0 z-40 w-64 bg-[#080d1a] border-r border-slate-800/80 flex flex-col transition-transform duration-200 md:static md:translate-x-0
        ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        
        {/* Sidebar Brand Header */}
        <div className="p-5 border-b border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center text-white font-serif font-bold text-base shadow-lg shadow-sky-500/20">
              IW
            </div>
            <div>
              <h1 className="font-serif font-bold text-sm text-white tracking-tight leading-tight">
                Ink &amp; Witness
              </h1>
              <p className="text-[10px] font-mono text-sky-400 tracking-wider uppercase flex items-center gap-1 mt-0.5">
                <ShieldCheck className="w-3 h-3 text-sky-400" />
                Author Workspace
              </p>
            </div>
          </div>
        </div>

        {/* Global Save Permanently Action Button */}
        <div className="px-3 pt-3 pb-1">
          <button
            id="sidebar-save-permanently-btn"
            onClick={handleSavePermanently}
            disabled={savingPermanently}
            className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer shadow-md text-xs font-mono font-semibold ${
              savingPermanently
                ? 'bg-amber-950/70 border-amber-500/80 text-amber-300 animate-pulse'
                : saveSuccessNotice
                ? 'bg-emerald-950/80 border-emerald-500/80 text-emerald-200'
                : 'bg-gradient-to-r from-sky-950/90 via-indigo-950/90 to-slate-900 border-sky-600/70 hover:border-sky-400 text-sky-200 hover:text-white shadow-sky-950/50'
            }`}
            title="Atomically synchronize all monographs, configs, media, and settings to Cloud Firestore and take a recovery snapshot"
          >
            <div className="flex items-center gap-2">
              {savingPermanently ? (
                <div className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin" />
              ) : saveSuccessNotice ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <ShieldCheck className="w-4 h-4 text-sky-400" />
              )}
              <span>
                {savingPermanently
                  ? 'Saving to Cloud...'
                  : saveSuccessNotice
                  ? 'Saved Permanently ✓'
                  : 'Save Permanently'}
              </span>
            </div>
            {lastSavedTimestamp && !savingPermanently && !saveSuccessNotice && (
              <span className="text-[10px] text-slate-400 font-mono">
                {lastSavedTimestamp}
              </span>
            )}
          </button>
        </div>

        {/* Navigation Items */}
        <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          
          {/* Overview */}
          <button
            onClick={() => handleTabChange('overview')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'overview'
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutDashboard className="w-4 h-4 text-sky-400" />
              <span>Overview</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 opacity-40" />
          </button>

          {/* Write New Piece */}
          <button
            onClick={handleNewPiece}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'editor' && !editingPiece
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <PenTool className="w-4 h-4 text-cyan-400" />
              <span>Write New Piece</span>
            </div>
          </button>

          {/* My Pieces */}
          <button
            onClick={() => handleTabChange('pieces')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'pieces'
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <FileText className="w-4 h-4 text-indigo-400" />
              <span>All Pieces</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 border border-slate-800">
              {pieces.length}
            </span>
          </button>

          {/* Private Drafts */}
          <button
            onClick={() => handleTabChange('drafts')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'drafts'
                ? 'bg-amber-950/80 text-amber-200 border border-amber-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Edit3 className="w-4 h-4 text-amber-400" />
              <span>Private Drafts</span>
            </div>
            {draftCount > 0 && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800">
                {draftCount}
              </span>
            )}
          </button>

          {/* Published */}
          <button
            onClick={() => handleTabChange('published')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'published'
                ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Globe className="w-4 h-4 text-emerald-400" />
              <span>Published</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
              {publishedCount}
            </span>
          </button>

          {/* Homepage Curation */}
          <button
            id="nav-tab-homepage"
            onClick={() => handleTabChange('homepage', 'overview')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'homepage'
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <LayoutTemplate className="w-4 h-4 text-sky-400" />
              <span>Homepage Layout</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
              Curate
            </span>
          </button>

          {/* Topic Catalogue (Reader Discovery) */}
          <button
            id="nav-tab-topics"
            onClick={() => handleTabChange('topics')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'topics'
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm ring-1 ring-sky-500/30'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Compass className="w-4 h-4 text-sky-400" />
              <span>Topic Catalogue</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-300 border border-sky-800">
              Discovery
            </span>
          </button>

          {/* Custom Categories Manager */}
          <button
            id="nav-tab-categories"
            onClick={() => { void openCategoryManager(); }}
            className="w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between text-slate-400 hover:text-slate-100 hover:bg-slate-900/60 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2.5">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Categories</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-900 text-sky-300 border border-slate-800">
              {categories.length}
            </span>
          </button>

          {/* Media & Photos */}
          <button
            id="nav-tab-media"
            onClick={() => handleTabChange('media')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'media'
                ? 'bg-sky-950/80 text-sky-200 border border-sky-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <ImageIcon className="w-4 h-4 text-indigo-400" />
              <span>Media &amp; Branding</span>
            </div>
          </button>

          <div className="my-3 border-t border-slate-800/80" />

          {/* Analytics Dashboard */}
          <button
            id="nav-tab-analytics"
            onClick={() => handleTabChange('analytics')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'analytics'
                ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              <span>Analytics &amp; Sales</span>
            </div>
          </button>

          {/* Readers & Licenses */}
          <button
            id="nav-tab-readers"
            onClick={() => handleTabChange('readers')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'readers'
                ? 'bg-teal-950/80 text-teal-200 border border-teal-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4 text-teal-400" />
              <span>Readers &amp; Licenses</span>
            </div>
          </button>

          {/* Payments */}
          <button
            onClick={() => handleTabChange('payments')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'payments'
                ? 'bg-emerald-950/80 text-emerald-200 border border-emerald-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <CreditCard className="w-4 h-4 text-emerald-400" />
              <span>Pay-to-Read M-Pesa</span>
            </div>
          </button>

          {/* Tips */}
          <button
            onClick={() => handleTabChange('tips')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'tips'
                ? 'bg-rose-950/80 text-rose-200 border border-rose-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Heart className="w-4 h-4 text-rose-400" />
              <span>Reader Tips</span>
            </div>
          </button>

          {/* Reader Comments & Moderation */}
          <button
            id="nav-tab-comments"
            onClick={() => handleTabChange('comments')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'comments'
                ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-800/80 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <span>Comments</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
              Discussions
            </span>
          </button>

          {/* Affiliates & Referrals Admin */}
          <button
            id="nav-tab-affiliates"
            onClick={() => handleTabChange('affiliates')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'affiliates'
                ? 'bg-cyan-950/80 text-cyan-200 border border-cyan-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Share2 className="w-4 h-4 text-cyan-400" />
              <span>Affiliates Control</span>
            </div>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
              Partners
            </span>
          </button>

          {/* Settings */}
          <button
            onClick={() => handleTabChange('settings')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              currentTab === 'settings'
                ? 'bg-slate-800 text-white border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Sliders className="w-4 h-4 text-slate-300" />
              <span>Settings &amp; Till</span>
            </div>
          </button>

        </div>

        {/* Sidebar Footer */}
        <div className="p-4 border-t border-slate-800/80 space-y-2">
          {/* Explicit Exit Action */}
          <button
            id="btn-exit-writer-portal"
            onClick={onClose}
            className="w-full px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-sky-400 hover:text-sky-300 border border-slate-800 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Exit Writer Portal</span>
          </button>

          <button
            onClick={handleLogout}
            className="w-full px-3 py-2 rounded-xl hover:bg-rose-950/40 text-slate-400 hover:text-rose-300 border border-transparent hover:border-rose-900/40 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>

      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 overflow-y-auto">
        <div className="max-w-6xl mx-auto">
          {currentTab === 'overview' && (
            <WriterOverview
              stats={stats}
              loading={loading}
              onNavigateTab={(tab) => setCurrentTab(tab)}
              onEditPiece={handleEditPiece}
              onNewPiece={handleNewPiece}
              onSavePermanently={handleSavePermanently}
              savingPermanently={savingPermanently}
            />
          )}

          {currentTab === 'pieces' && (
            <WriterPiecesList
              pieces={pieces}
              loading={loading}
              filterMode="all"
              onNewPiece={handleNewPiece}
              onEditPiece={handleEditPiece}
              onPreviewPiece={onPreviewArticle}
              onTogglePublish={handleTogglePublish}
              onDeletePiece={handleDeletePiece}
            />
          )}

          {currentTab === 'drafts' && (
            <WriterPiecesList
              pieces={pieces}
              loading={loading}
              filterMode="drafts"
              onNewPiece={handleNewPiece}
              onEditPiece={handleEditPiece}
              onPreviewPiece={onPreviewArticle}
              onTogglePublish={handleTogglePublish}
              onDeletePiece={handleDeletePiece}
            />
          )}

          {currentTab === 'published' && (
            <WriterPiecesList
              pieces={pieces}
              loading={loading}
              filterMode="published"
              onNewPiece={handleNewPiece}
              onEditPiece={handleEditPiece}
              onPreviewPiece={onPreviewArticle}
              onTogglePublish={handleTogglePublish}
              onDeletePiece={handleDeletePiece}
            />
          )}

          {currentTab === 'editor' && (
            <WriterEditor
              initialArticle={editingPiece}
              allPublishedArticles={pieces.filter(p => p.status === 'published')}
              onSave={handleSavePiece}
              onCancel={() => handleTabChange('pieces')}
              onPreview={onPreviewArticle}
            />
          )}

          {currentTab === 'homepage' && (
            <HomepageManager
              articles={pieces}
              onRefreshArticles={loadDashboardData}
            />
          )}

          {currentTab === 'topics' && (
            <TopicManagementTab
              articles={pieces}
              onRefreshArticles={loadDashboardData}
            />
          )}

          {currentTab === 'media' && (
            <WriterMedia
              author={author}
              pieces={pieces}
              onAuthorUpdated={(updated) => setAuthor(updated)}
              onPieceUpdated={(updated) => {
                setPieces(prev => prev.map(p => p.id === updated.id ? updated : p));
              }}
            />
          )}

          {currentTab === 'analytics' && (
            <WriterAnalytics
              articles={pieces}
              onEditPiece={handleEditPiece}
              onPreviewPiece={onPreviewArticle}
              onNavigateTab={(tab) => setCurrentTab(tab)}
              onRefresh={loadDashboardData}
            />
          )}

          {currentTab === 'readers' && (
            <WriterReaders
              articles={pieces}
            />
          )}

          {currentTab === 'payments' && (
            <WriterPayments
              transactions={transactions}
              loading={loading}
              onRefresh={loadDashboardData}
            />
          )}

          {currentTab === 'tips' && (
            <WriterTips
              tips={tips}
              loading={loading}
              onRefresh={loadDashboardData}
            />
          )}

          {currentTab === 'comments' && (
            <WriterComments
              articles={pieces}
              onPreviewPiece={onPreviewArticle}
            />
          )}

          {currentTab === 'affiliates' && (
            <AffiliatesAdminTab
              articles={pieces}
            />
          )}

          {currentTab === 'settings' && author && mpesaConfig && (
            <WriterSettings
              author={author}
              mpesaConfig={mpesaConfig}
              pieces={pieces}
              onAuthorUpdated={(updated) => setAuthor(updated)}
              onMpesaUpdated={(updated) => setMpesaConfig(updated)}
              onPiecesUpdated={(updated) => setPieces(updated)}
            />
          )}
        </div>
      </main>

      {/* Category Manager Modal */}
      <CategoryManagerModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categories}
        articles={pieces}
        onCategoriesUpdated={(updated) => setCategories(updated)}
      />

    </div>
  );
};


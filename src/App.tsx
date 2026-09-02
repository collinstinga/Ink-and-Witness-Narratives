import React, { useState, useEffect } from 'react';
import { 
  Heart,
  Smartphone,
  Instagram,
  Feather,
  BookmarkCheck,
  PenTool,
  ArrowRight,
  LifeBuoy
} from 'lucide-react';
import { Article, AuthorProfile, Category, WriterNavTab, User } from './types.js';
import { api, getStoredTokens } from './utils/api.js';
import { applyFavicon } from './utils/favicon.js';

import { Navbar, PublicViewType } from './components/Navbar.js';
import { HomeView } from './components/views/HomeView.js';
import { AllPiecesView } from './components/views/AllPiecesView.js';
import { AboutAuthorView } from './components/views/AboutAuthorView.js';
import { HowToPayView } from './components/views/HowToPayView.js';

import { ArticleReaderModal } from './components/ArticleReaderModal.js';
import { MpesaCheckoutModal } from './components/MpesaCheckoutModal.js';
import { MyLibraryModal } from './components/MyLibraryModal.js';
import { TipAuthorModal } from './components/TipAuthorModal.js';
import { SupportModal } from './components/SupportModal.js';
import { SignInModal } from './components/auth/SignInModal.js';
import { WriterDashboard } from './components/writer/WriterDashboard.js';
import { AffiliatePortal } from './components/affiliate/AffiliatePortal.js';
import { initReferralTracking } from './utils/affiliateReferral.js';

// Primary Navigation & History State Interface
export interface NavState {
  view: PublicViewType;
  articleSlugOrId: string | null;
  isCheckoutOpen: boolean;
  checkoutArticleId: string | null;
  lockedTab: 'preview' | 'synopsis';
  category: string;
  tag: string | null;
  search: string;
  isLibraryOpen: boolean;
  isTipOpen: boolean;
  tipArticleId: string | null;
  isWriterStudioOpen: boolean;
  isAffiliatePortalOpen?: boolean;
  isSignInOpen?: boolean;
  writerTab?: WriterNavTab;
  writerSubTab?: string;
  writerPieceId?: string | null;
  scrollY?: number;
  readerScrollTop?: number;
}

export default function App() {
  const [author, setAuthor] = useState<AuthorProfile | null>(null);
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Primary Reader Navigation View State
  const [currentView, setCurrentView] = useState<PublicViewType>('home');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [currentLockedTab, setCurrentLockedTab] = useState<'preview' | 'synopsis'>('preview');

  // Writer Studio State (private, separated from reader navigation)
  const [isWriterStudioOpen, setIsWriterStudioOpen] = useState(false);
  const [isAffiliatePortalOpen, setIsAffiliatePortalOpen] = useState(false);
  const [isSignInOpen, setIsSignInOpen] = useState(false);

  // Active Modals & Readers
  const [activeReaderArticle, setActiveReaderArticle] = useState<Article | null>(null);
  const [activeCheckoutArticle, setActiveCheckoutArticle] = useState<Article | null>(null);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const [isTipOpen, setIsTipOpen] = useState(false);
  const [tipTargetArticle, setTipTargetArticle] = useState<Article | null>(null);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  // Unlocked Tokens map (cached locally)
  const [unlockedTokens, setUnlockedTokens] = useState<Record<string, any>>({});

  // Pending article slug or id to open once articles finish loading
  const pendingArticleSlugOrIdRef = React.useRef<string | null>(null);
  const articlesRef = React.useRef<Article[]>([]);
  articlesRef.current = articles;
  const unlockedTokensRef = React.useRef<Record<string, any>>({});
  unlockedTokensRef.current = unlockedTokens;

  // Helper to get window scroll Y
  const getWindowScroll = (): number => {
    if (typeof window === 'undefined') return 0;
    return window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
  };

  // Helper to get reader modal scroll Y
  const getReaderModalScroll = (): number => {
    if (typeof document === 'undefined') return 0;
    const elem = document.getElementById('article-reader-scroll');
    return elem ? elem.scrollTop : 0;
  };

  // Helper to restore scroll positions safely
  const restoreScrollPositions = (scrollY?: number, readerScrollTop?: number) => {
    if (typeof window === 'undefined') return;

    if (scrollY !== undefined) {
      requestAnimationFrame(() => {
        window.scrollTo({ top: scrollY, behavior: 'instant' as ScrollBehavior });
      });
    }

    if (readerScrollTop !== undefined) {
      setTimeout(() => {
        const elem = document.getElementById('article-reader-scroll');
        if (elem) {
          elem.scrollTop = readerScrollTop;
        }
      }, 50);
    }
  };

  // Helper to parse location hash and query into structured navigation state
  const parseLocationToNavState = (): NavState => {
    if (typeof window === 'undefined') {
      return {
        view: 'home',
        articleSlugOrId: null,
        isCheckoutOpen: false,
        checkoutArticleId: null,
        lockedTab: 'preview',
        category: 'ALL',
        tag: null,
        search: '',
        isLibraryOpen: false,
        isTipOpen: false,
        tipArticleId: null,
        isWriterStudioOpen: false
      };
    }

    const rawHash = window.location.hash || '';
    const hashWithoutPound = rawHash.startsWith('#') ? rawHash.slice(1) : rawHash;
    const [hashPath, hashQuery] = hashWithoutPound.split('?');
    const hashParams = new URLSearchParams(hashQuery || '');
    const searchParams = new URLSearchParams(window.location.search || '');

    let view: PublicViewType = 'home';
    let articleSlugOrId: string | null = null;
    let isCheckoutOpen = false;
    let checkoutArticleId: string | null = null;
    let lockedTab: 'preview' | 'synopsis' = 'preview';
    let category = hashParams.get('category') || searchParams.get('category') || 'ALL';
    let tag = hashParams.get('tag') || searchParams.get('tag') || null;
    let search = hashParams.get('q') || searchParams.get('q') || '';
    let isLibraryOpen = false;
    let isTipOpen = false;
    let tipArticleId: string | null = hashParams.get('article') || searchParams.get('article') || null;
    let isWriterStudioOpen = false;
    let isAffiliatePortalOpen = false;
    let isSignInOpen = false;
    let writerTab: WriterNavTab | undefined = undefined;
    let writerSubTab: string | undefined = undefined;
    let writerPieceId: string | null = null;

    // Check pay / checkout parameters
    if (hashParams.get('pay') === 'true' || hashParams.get('checkout') === 'true' || 
        searchParams.get('pay') === 'true' || searchParams.get('checkout') === 'true') {
      isCheckoutOpen = true;
    }

    // Check tab parameter
    if (hashParams.get('tab') === 'synopsis' || searchParams.get('tab') === 'synopsis') {
      lockedTab = 'synopsis';
    }

    // Check for monograph / piece query params first
    const directMonograph = searchParams.get('monograph') || searchParams.get('article') || searchParams.get('id');
    if (directMonograph) {
      articleSlugOrId = decodeURIComponent(directMonograph);
    }

    const normalizedHash = hashPath.toLowerCase();

    if (normalizedHash.startsWith('writer') || normalizedHash.startsWith('admin') || normalizedHash.startsWith('studio')) {
      isWriterStudioOpen = true;
      const parts = hashPath.split('/').filter(Boolean);
      // parts[0] is 'writer' or 'admin' or 'studio'
      const second = parts[1]?.toLowerCase();
      const third = parts[2];
      const fourth = parts[3]?.toLowerCase();

      if (!second || second === 'overview' || second === 'dashboard') {
        writerTab = 'overview';
      } else if (second === 'homepage') {
        writerTab = 'homepage';
        if (third === 'cover' || third === 'banners' || third === 'sections') {
          writerSubTab = third;
        } else {
          writerSubTab = 'overview';
        }
      } else if (second === 'pieces') {
        if (third === 'new') {
          writerTab = 'editor';
          writerPieceId = null;
          writerSubTab = 'content';
        } else if (third) {
          writerTab = 'editor';
          writerPieceId = decodeURIComponent(third);
          writerSubTab = fourth === 'pricing' ? 'pricing' : 'content';
        } else {
          writerTab = 'pieces';
        }
      } else if (second === 'drafts' || second === 'published' || second === 'categories' || 
                 second === 'media' || second === 'analytics' || second === 'readers' || 
                 second === 'payments' || second === 'tips' || second === 'comments' || second === 'settings') {
        writerTab = second as WriterNavTab;
      } else {
        writerTab = 'overview';
      }
    } else if (normalizedHash === 'affiliates' || normalizedHash === 'affiliate' || normalizedHash === 'partners') {
      isAffiliatePortalOpen = true;
    } else if (normalizedHash === 'sign-in' || normalizedHash === 'signin' || normalizedHash === 'login' || normalizedHash === 'auth') {
      isSignInOpen = true;
    } else if (normalizedHash === 'library') {
      isLibraryOpen = true;
    } else if (normalizedHash === 'support' || normalizedHash === 'tip') {
      isTipOpen = true;
    } else if (normalizedHash.startsWith('piece-') || normalizedHash.startsWith('article-')) {
      articleSlugOrId = decodeURIComponent(hashPath.replace(/^(piece|article)-/, ''));
    } else if (normalizedHash.startsWith('pay-')) {
      articleSlugOrId = decodeURIComponent(hashPath.replace(/^pay-/, ''));
      isCheckoutOpen = true;
    } else if (normalizedHash === 'all-pieces' || normalizedHash === 'pieces') {
      view = 'all-pieces';
    } else if (normalizedHash === 'about' || normalizedHash === 'author') {
      view = 'about';
    } else if (normalizedHash === 'how-to-pay' || normalizedHash === 'pay') {
      view = 'how-to-pay';
    } else if (normalizedHash === 'home' || normalizedHash === '') {
      view = 'home';
    }

    if (isCheckoutOpen && articleSlugOrId) {
      checkoutArticleId = articleSlugOrId;
    }

    return {
      view,
      articleSlugOrId,
      isCheckoutOpen,
      checkoutArticleId,
      lockedTab,
      category,
      tag,
      search,
      isLibraryOpen,
      isTipOpen,
      tipArticleId,
      isWriterStudioOpen,
      isAffiliatePortalOpen,
      isSignInOpen,
      writerTab,
      writerSubTab,
      writerPieceId
    };
  };

  // Convert state into URL hash
  const navStateToHash = (state: NavState): string => {
    if (state.isSignInOpen) return '#sign-in';
    if (state.isAffiliatePortalOpen) return '#affiliates';
    if (state.isWriterStudioOpen) {
      const tab = state.writerTab || 'overview';
      if (tab === 'overview') return '#writer/overview';
      if (tab === 'homepage') {
        if (state.writerSubTab === 'cover') return '#writer/homepage/cover';
        if (state.writerSubTab === 'banners') return '#writer/homepage/banners';
        if (state.writerSubTab === 'sections') return '#writer/homepage/sections';
        return '#writer/homepage';
      }
      if (tab === 'editor') {
        if (!state.writerPieceId) return '#writer/pieces/new';
        if (state.writerSubTab === 'pricing') return `#writer/pieces/${encodeURIComponent(state.writerPieceId)}/pricing`;
        return `#writer/pieces/${encodeURIComponent(state.writerPieceId)}`;
      }
      return `#writer/${tab}`;
    }
    if (state.isLibraryOpen) return '#library';
    if (state.isTipOpen) {
      return state.tipArticleId ? `#support?article=${encodeURIComponent(state.tipArticleId)}` : '#support';
    }
    if (state.articleSlugOrId) {
      const base = `#piece-${encodeURIComponent(state.articleSlugOrId)}`;
      const params = new URLSearchParams();
      if (state.isCheckoutOpen) params.set('pay', 'true');
      if (state.lockedTab === 'synopsis') params.set('tab', 'synopsis');
      const queryString = params.toString();
      return queryString ? `${base}?${queryString}` : base;
    }
    if (state.view === 'all-pieces') {
      const params = new URLSearchParams();
      if (state.category && state.category !== 'ALL') params.set('category', state.category);
      if (state.tag) params.set('tag', state.tag);
      if (state.search) params.set('q', state.search);
      const queryString = params.toString();
      return queryString ? `#all-pieces?${queryString}` : '#all-pieces';
    }
    if (state.view === 'about') return '#about';
    if (state.view === 'how-to-pay') return '#how-to-pay';
    return '#home';
  };

  // Load article reader helper
  const loadArticleForReader = async (
    slugOrId: string,
    currentArticleList?: Article[],
    onLoaded?: (loadedArticle: Article) => void
  ) => {
    const list = currentArticleList || articlesRef.current;
    const matched = list.find(
      (a) => a.slug === slugOrId || a.id === slugOrId
    );

    if (matched) {
      const stored = unlockedTokensRef.current;
      const tokenInfo = stored[matched.id] || (matched.slug ? stored[matched.slug] : undefined);
      try {
        const detailed = await api.getArticle(matched.id, tokenInfo?.token);
        setActiveReaderArticle(detailed);
        if (onLoaded) onLoaded(detailed);
        // Telemetry tracking
        api.trackInteraction('view', matched.id, matched.category);
        if (matched.isPaid && !detailed.isUnlocked) {
          api.trackInteraction('preview_read', matched.id, matched.category);
        }
      } catch {
        setActiveReaderArticle(matched);
        if (onLoaded) onLoaded(matched);
        api.trackInteraction('view', matched.id, matched.category);
      }
      pendingArticleSlugOrIdRef.current = null;
    } else {
      // Store pending if articles list isn't ready yet
      pendingArticleSlugOrIdRef.current = slugOrId;
    }
  };

  // Apply state to React view components without modifying the browser history stack
  const applyNavState = (state: NavState) => {
    setCurrentView(state.view || 'home');
    setSelectedCategory(state.category || 'ALL');
    setSelectedTag(state.tag || null);
    setSearchQuery(state.search || '');
    setIsLibraryOpen(Boolean(state.isLibraryOpen));
    setIsTipOpen(Boolean(state.isTipOpen));
    if (state.tipArticleId) {
      const matched = articlesRef.current.find(a => a.id === state.tipArticleId || a.slug === state.tipArticleId);
      setTipTargetArticle(matched || null);
    } else if (!state.isTipOpen) {
      setTipTargetArticle(null);
    }
    setIsWriterStudioOpen(Boolean(state.isWriterStudioOpen));
    setIsAffiliatePortalOpen(Boolean(state.isAffiliatePortalOpen));
    setIsSignInOpen(Boolean(state.isSignInOpen));
    setCurrentLockedTab(state.lockedTab || 'preview');

    if (state.articleSlugOrId) {
      loadArticleForReader(state.articleSlugOrId, undefined, (loaded) => {
        if (state.isCheckoutOpen) {
          setActiveCheckoutArticle(loaded);
        } else {
          setActiveCheckoutArticle(null);
        }
      });
      if (state.isCheckoutOpen) {
        const matched = articlesRef.current.find(a => a.slug === state.articleSlugOrId || a.id === state.articleSlugOrId);
        if (matched) setActiveCheckoutArticle(matched);
      } else {
        setActiveCheckoutArticle(null);
      }
    } else {
      setActiveReaderArticle(null);
      setActiveCheckoutArticle(null);
      pendingArticleSlugOrIdRef.current = null;
    }

    restoreScrollPositions(state.scrollY, state.readerScrollTop);
  };

  // Navigation orchestrator: pushes or replaces history entry cleanly
  const navigate = (
    patch: Partial<NavState>,
    mode: 'push' | 'replace' = 'push'
  ) => {
    const currentState: NavState = (window.history.state as any) || parseLocationToNavState();
    const currentScrollY = getWindowScroll();
    const currentReaderScroll = getReaderModalScroll();

    // If pushing a new state, save current scroll positions to the existing history state
    if (mode === 'push') {
      const updatedCurrentState: NavState = {
        ...currentState,
        scrollY: currentState.articleSlugOrId ? currentState.scrollY : currentScrollY,
        readerScrollTop: currentReaderScroll > 0 ? currentReaderScroll : currentState.readerScrollTop
      };
      window.history.replaceState(updatedCurrentState, '', navStateToHash(updatedCurrentState));
    }

    // Build next consolidated state
    const nextState: NavState = {
      view: patch.view !== undefined ? patch.view : currentState.view,
      articleSlugOrId: patch.articleSlugOrId !== undefined 
        ? patch.articleSlugOrId 
        : (patch.view !== undefined && patch.view !== currentState.view ? null : currentState.articleSlugOrId),
      isCheckoutOpen: patch.isCheckoutOpen !== undefined 
        ? patch.isCheckoutOpen 
        : (patch.articleSlugOrId === null ? false : false),
      checkoutArticleId: patch.checkoutArticleId !== undefined 
        ? patch.checkoutArticleId 
        : (patch.isCheckoutOpen ? (patch.articleSlugOrId || currentState.articleSlugOrId) : null),
      lockedTab: patch.lockedTab !== undefined 
        ? patch.lockedTab 
        : (patch.articleSlugOrId && patch.articleSlugOrId !== currentState.articleSlugOrId ? 'preview' : (currentState.lockedTab || 'preview')),
      category: patch.category !== undefined ? patch.category : (patch.view === 'home' ? 'ALL' : currentState.category),
      tag: patch.tag !== undefined ? patch.tag : (patch.view === 'home' ? null : currentState.tag),
      search: patch.search !== undefined ? patch.search : (patch.view === 'home' ? '' : currentState.search),
      isLibraryOpen: patch.isLibraryOpen !== undefined ? patch.isLibraryOpen : false,
      isTipOpen: patch.isTipOpen !== undefined ? patch.isTipOpen : false,
      tipArticleId: patch.tipArticleId !== undefined ? patch.tipArticleId : null,
      isWriterStudioOpen: patch.isWriterStudioOpen !== undefined ? patch.isWriterStudioOpen : false,
      isAffiliatePortalOpen: patch.isAffiliatePortalOpen !== undefined ? patch.isAffiliatePortalOpen : false,
      isSignInOpen: patch.isSignInOpen !== undefined ? patch.isSignInOpen : false,
      scrollY: patch.scrollY !== undefined ? patch.scrollY : (mode === 'push' && patch.view && patch.view !== currentState.view ? 0 : currentState.scrollY),
      readerScrollTop: patch.readerScrollTop !== undefined ? patch.readerScrollTop : (patch.isCheckoutOpen ? currentReaderScroll : 0)
    };

    const targetHash = navStateToHash(nextState);

    if (mode === 'push') {
      window.history.pushState(nextState, '', targetHash);
    } else {
      window.history.replaceState(nextState, '', targetHash);
    }

    applyNavState(nextState);

    // Smooth scroll to top when changing top-level public views
    if (patch.view && patch.view !== currentState.view && !patch.articleSlugOrId) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // User Actions mapped to Navigation
  const handleOpenReader = (article: Article) => {
    navigate({
      articleSlugOrId: article.slug || article.id,
      isCheckoutOpen: false,
      lockedTab: 'preview'
    }, 'push');
  };

  const handleCloseReader = () => {
    // If the browser history state indicates an active piece was pushed, pop it back
    if (window.history.state && (window.history.state as any).articleSlugOrId) {
      window.history.back();
    } else {
      navigate({ articleSlugOrId: null, isCheckoutOpen: false }, 'replace');
    }
  };

  const handleUnlockRequest = (article: Article) => {
    const currentReaderScroll = getReaderModalScroll();
    navigate({
      articleSlugOrId: article.slug || article.id,
      isCheckoutOpen: true,
      checkoutArticleId: article.id,
      readerScrollTop: currentReaderScroll
    }, 'push');
  };

  const handleCloseCheckout = () => {
    if (window.history.state && (window.history.state as any).isCheckoutOpen) {
      window.history.back();
    } else {
      navigate({ isCheckoutOpen: false, checkoutArticleId: null }, 'replace');
    }
  };

  const handleLockedTabChange = (tab: 'preview' | 'synopsis') => {
    if (activeReaderArticle) {
      navigate({
        articleSlugOrId: activeReaderArticle.slug || activeReaderArticle.id,
        lockedTab: tab,
        isCheckoutOpen: false
      }, 'push');
    }
  };

  const handleNavigateView = (view: PublicViewType) => {
    navigate({
      view,
      articleSlugOrId: null,
      isCheckoutOpen: false,
      isLibraryOpen: false,
      isTipOpen: false,
      isWriterStudioOpen: false
    }, 'push');
  };

  const handleSelectCategory = (category: string) => {
    navigate({
      view: 'all-pieces',
      category,
      tag: null,
      articleSlugOrId: null,
      isCheckoutOpen: false
    }, 'push');
  };

  const handleSelectTag = (tag: string | null) => {
    navigate({
      view: 'all-pieces',
      tag,
      articleSlugOrId: null,
      isCheckoutOpen: false
    }, 'push');
  };

  const handleOpenLibrary = () => {
    navigate({ isLibraryOpen: true, isCheckoutOpen: false }, 'push');
  };

  const handleCloseLibrary = () => {
    if (window.history.state && (window.history.state as any).isLibraryOpen) {
      window.history.back();
    } else {
      navigate({ isLibraryOpen: false }, 'replace');
    }
  };

  const handleOpenTip = (article?: Article | null) => {
    setTipTargetArticle(article || null);
    navigate({ 
      isTipOpen: true, 
      tipArticleId: article ? (article.id || article.slug) : null,
      isCheckoutOpen: false 
    }, 'push');
  };

  const handleCloseTip = () => {
    if (window.history.state && (window.history.state as any).isTipOpen) {
      window.history.back();
    } else {
      navigate({ isTipOpen: false, tipArticleId: null }, 'replace');
    }
  };

  const handleOpenSupport = () => {
    setIsSupportOpen(true);
  };

  const handleCloseSupport = () => {
    setIsSupportOpen(false);
  };

  const handleSupportUnlocked = async (unlockedArticleId: string) => {
    const stored = getStoredTokens();
    setUnlockedTokens(stored);
    unlockedTokensRef.current = stored;
    const art = articles.find(a => a.id === unlockedArticleId || a.slug === unlockedArticleId);
    if (art) {
      const tokenInfo = stored[art.id] || (art.slug ? stored[art.slug] : undefined);
      try {
        const detailed = await api.getArticle(art.id, tokenInfo?.token);
        setActiveReaderArticle({ ...detailed, isUnlocked: true });
      } catch {
        setActiveReaderArticle({ ...art, isUnlocked: true });
      }
    }
  };

  const handleOpenAffiliates = () => {
    navigate({ isAffiliatePortalOpen: true, isCheckoutOpen: false }, 'push');
  };

  const handleCloseAffiliates = () => {
    if (window.history.state && (window.history.state as any).isAffiliatePortalOpen) {
      window.history.back();
    } else {
      navigate({ isAffiliatePortalOpen: false }, 'replace');
    }
  };

  const handleOpenWriterStudio = () => {
    navigate({ isWriterStudioOpen: true, isCheckoutOpen: false }, 'push');
  };

  const handleCloseWriterStudio = () => {
    setIsWriterStudioOpen(false);
    navigate({
      isWriterStudioOpen: false,
      isSignInOpen: false,
      isAffiliatePortalOpen: false,
      isLibraryOpen: false,
      isTipOpen: false,
      view: currentView || 'home'
    }, 'push');
    fetchData();
  };

  const handleAuthSuccess = (user: User) => {
    setCurrentUser(user);
    setIsSignInOpen(false);
    if (user.role === 'admin') {
      navigate({ isWriterStudioOpen: true, isSignInOpen: false }, 'push');
    } else {
      navigate({ isLibraryOpen: true, isSignInOpen: false }, 'push');
    }
  };

  const handleLogout = async () => {
    try {
      await api.authLogout();
    } catch {}
    setCurrentUser(null);
    setIsWriterStudioOpen(false);
    navigate({ view: 'home', isWriterStudioOpen: false }, 'replace');
  };

  // Check current session on mount
  useEffect(() => {
    api.authGetMe().then(res => {
      if (res.authenticated && res.user) {
        setCurrentUser(res.user);
      }
    }).catch(() => {});
  }, []);

  // Fetch initial data
  const fetchData = async () => {
    try {
      setLoading(true);
      const [authorData, articlesData, categoriesData] = await Promise.all([
        api.getAuthor().catch(err => {
          console.warn('Author fetch notice:', err);
          return null;
        }),
        api.getArticles().catch(err => {
          console.warn('Articles fetch notice:', err);
          return [];
        }),
        api.getCategories().catch(() => [])
      ]);
      if (authorData) {
        setAuthor(authorData);
        applyFavicon(authorData?.faviconUrl);
      }
      if (articlesData && articlesData.length > 0) {
        setArticles(articlesData);
      }
      setCategories(categoriesData || []);
      const stored = getStoredTokens();
      setUnlockedTokens(stored);
      unlockedTokensRef.current = stored;

      // If there was a pending article slug/id from initial deep link, load it now
      if (pendingArticleSlugOrIdRef.current) {
        loadArticleForReader(pendingArticleSlugOrIdRef.current, articlesData || []);
      }
    } catch (err: any) {
      console.error('Data load error:', err);
      setError('Failed to load Ink & Witness catalog. Please refresh.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // 0. Extract referral code (?ref=... or ?c=...) from landing URL and store with cookie/localStorage fallback
    initReferralTracking();

    // 1. Parse initial URL and tag the entry point with replaceState (so landing from Google creates NO false extra history step)
    const initialNavState = parseLocationToNavState();
    window.history.replaceState(initialNavState, '', navStateToHash(initialNavState));
    applyNavState(initialNavState);

    // 2. Fetch catalog & author
    fetchData();

    // 3. Listen for browser History API popstate events (Android back gesture, hardware back button, browser back/forward)
    const handlePopState = (event: PopStateEvent) => {
      let targetState: any = event.state;
      if (!targetState || typeof targetState !== 'object') {
        targetState = parseLocationToNavState();
      }
      applyNavState(targetState);
    };
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  const handlePaymentSuccess = (article: Article, token: string, receipt: string) => {
    const updated = {
      ...unlockedTokens,
      [article.id]: { token, receipt, phone: '' }
    };
    setUnlockedTokens(updated);
    unlockedTokensRef.current = updated;
    loadArticleForReader(article.id);
  };

  // Sync document title with active article or view
  useEffect(() => {
    if (activeReaderArticle) {
      document.title = `${activeReaderArticle.title} — Ink & Witness Narratives`;
    } else if (currentView === 'all-pieces') {
      document.title = `Explore Pieces — Ink & Witness Narratives`;
    } else if (currentView === 'about') {
      document.title = `About the Author — Ink & Witness Narratives`;
    } else if (currentView === 'how-to-pay') {
      document.title = `How to Pay (M-PESA) — Ink & Witness Narratives`;
    } else {
      document.title = `Ink & Witness Narratives | Essays, Erotica, Love & Life's Contradictions`;
    }
  }, [activeReaderArticle, currentView]);

  // IF WRITER STUDIO VIEW IS ACTIVE
  if (isWriterStudioOpen) {
    const historyState = (window.history.state as any) || {};
    return (
      <WriterDashboard
        onClose={handleCloseWriterStudio}
        currentUser={currentUser}
        onLoginSuccess={handleAuthSuccess}
        onLogout={handleLogout}
        onPreviewArticle={(art) => {
          handleOpenReader(art);
        }}
        initialTab={historyState.writerTab || undefined}
        initialSubTab={historyState.writerSubTab || undefined}
        initialPieceId={historyState.writerPieceId || null}
        onNavigateTab={(tab, subTab, pieceId) => {
          navigate({
            isWriterStudioOpen: true,
            writerTab: tab,
            writerSubTab: subTab,
            writerPieceId: pieceId
          }, 'replace');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#0b101b] text-slate-100 flex flex-col selection:bg-sky-500/20 selection:text-sky-200">
      
      {/* Primary Clean Navigation */}
      <Navbar
        author={author}
        currentUser={currentUser}
        currentView={currentView}
        onNavigate={handleNavigateView}
        onOpenLibrary={handleOpenLibrary}
        onOpenSupport={handleOpenSupport}
        onOpenAffiliates={handleOpenAffiliates}
        onOpenSignIn={() => setIsSignInOpen(true)}
        onLogout={handleLogout}
      />

      {/* Main View Router */}
      <main className="flex-1">
        {currentView === 'home' && (
          <HomeView
            author={author}
            articles={articles}
            unlockedTokens={unlockedTokens}
            onReadArticle={handleOpenReader}
            onUnlockArticle={handleUnlockRequest}
            onNavigate={handleNavigateView}
            onOpenTip={handleOpenTip}
          />
        )}

        {currentView === 'all-pieces' && (
          <AllPiecesView
            articles={articles}
            categories={categories}
            unlockedTokens={unlockedTokens}
            onReadArticle={handleOpenReader}
            onUnlockArticle={handleUnlockRequest}
            onOpenTip={handleOpenTip}
            onCategoriesUpdated={(updated) => setCategories(updated)}
            onRequestWriterLogin={handleOpenWriterStudio}
            selectedCategory={selectedCategory}
            onSelectCategory={handleSelectCategory}
            selectedTag={selectedTag}
            onSelectTag={handleSelectTag}
            searchQuery={searchQuery}
            onSearchChange={(q) => {
              setSearchQuery(q);
              navigate({ search: q }, 'replace');
            }}
          />
        )}

        {currentView === 'about' && (
          <AboutAuthorView
            author={author}
            onExplorePieces={() => handleNavigateView('all-pieces')}
            onSupportAuthor={() => handleOpenTip(null)}
          />
        )}

        {currentView === 'how-to-pay' && (
          <HowToPayView
            onExplorePieces={() => handleNavigateView('all-pieces')}
            onSupportAuthor={() => handleOpenTip(null)}
            onOpenSupport={handleOpenSupport}
          />
        )}
      </main>

      {/* Simplified Reader Footer */}
      <footer className="bg-[#080d17] border-t border-slate-800/80 py-12 sm:py-16 text-slate-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
            
            {/* Col 1: Brand & Tagline (6 cols) */}
            <div className="md:col-span-6 space-y-3">
              <button 
                onClick={() => handleNavigateView('home')}
                className="font-serif font-bold text-lg sm:text-xl text-white tracking-wider hover:text-sky-300 transition-colors text-left cursor-pointer"
              >
                INK &amp; WITNESS NARRATIVES
              </button>
              <p className="font-serif italic text-xs sm:text-sm text-slate-300 max-w-md">
                “I write because the heart keeps a ledger the tongue is too proud to read.”
              </p>
              <p className="text-xs text-slate-400 font-sans max-w-md leading-relaxed">
                An archive of lived experience, intimacy, power, and memory authored by {author?.name || 'Jake'}.
              </p>
            </div>

            {/* Col 2: Primary Reader Links (3 cols) */}
            <div className="md:col-span-3 space-y-2 font-mono text-xs">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-2">
                Navigation
              </span>
              <ul className="space-y-2">
                <li>
                  <button 
                    onClick={() => handleNavigateView('home')} 
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    Home
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => handleNavigateView('all-pieces')} 
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    Explore Pieces
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => handleNavigateView('about')} 
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    About the Author
                  </button>
                </li>
                <li>
                  <button 
                    onClick={() => handleNavigateView('how-to-pay')} 
                    className="hover:text-white transition-colors cursor-pointer"
                  >
                    How to Read &amp; Pay
                  </button>
                </li>
                <li>
                  <button 
                    id="footer-support-btn"
                    onClick={handleOpenSupport} 
                    className="hover:text-cyan-300 text-cyan-400 transition-colors cursor-pointer flex items-center gap-1.5 font-semibold"
                  >
                    <LifeBuoy className="w-3.5 h-3.5" />
                    <span>Help &amp; Support Desk</span>
                  </button>
                </li>
              </ul>
            </div>

            {/* Col 3: Social & Patronage (3 cols) */}
            <div className="md:col-span-3 space-y-3 text-xs">
              <span className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider block mb-2">
                Patronage &amp; Contact
              </span>
              
              <a
                href={author?.instagramUrl || "https://www.instagram.com/its_bigboy_jake/"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors"
              >
                <Instagram className="w-3.5 h-3.5" />
                <span>@{author?.handle || "its_bigboy_jake"}</span>
              </a>

              <div className="pt-1 flex flex-col gap-2">
                <button
                  onClick={() => handleOpenTip(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 hover:text-white text-xs font-mono transition-colors cursor-pointer w-fit"
                >
                  <Heart className="w-3 h-3 fill-rose-400/40" />
                  <span>Tip the Author</span>
                </button>

                <button
                  onClick={handleOpenSupport}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-cyan-300 hover:text-white text-xs font-mono transition-colors cursor-pointer w-fit"
                >
                  <LifeBuoy className="w-3 h-3 text-cyan-400" />
                  <span>Reader Support</span>
                </button>
              </div>
            </div>

          </div>

          {/* Bottom sub-footer */}
          <div className="pt-6 border-t border-slate-800/60 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-400">
            <div>
              © 2026 Ink &amp; Witness. All rights reserved.
            </div>
            
            <div className="flex items-center gap-4 flex-wrap">
              <span>Safaricom Till 1618656</span>
              <span>•</span>
              <button
                onClick={handleOpenSupport}
                className="text-cyan-400 hover:text-cyan-200 transition-colors cursor-pointer"
              >
                Help Desk
              </button>
              <span>•</span>
              <button
                id="footer-affiliates-btn"
                onClick={handleOpenAffiliates}
                className="text-cyan-400 hover:text-cyan-200 transition-colors cursor-pointer font-medium"
                title="Affiliates & Referral Partners"
              >
                Affiliates
              </button>
              <span>•</span>
              <button 
                id="footer-signin-btn"
                onClick={() => setIsSignInOpen(true)}
                className="text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
                title="Sign In to Ink & Witness"
              >
                {currentUser ? (currentUser.role === 'admin' ? 'Writer Studio' : 'My Account') : 'Member Sign-In'}
              </button>
            </div>
          </div>

        </div>
      </footer>

      {/* MODALS */}
      {/* 1. Article Reader Modal */}
      <ArticleReaderModal
        article={activeReaderArticle}
        isOpen={Boolean(activeReaderArticle)}
        isUnlocked={activeReaderArticle ? Boolean(unlockedTokens[activeReaderArticle.id] || activeReaderArticle.isUnlocked) : false}
        onClose={handleCloseReader}
        author={author}
        currentUser={currentUser}
        onOpenAuth={(mode) => {
          setIsSignInOpen(true);
        }}
        onSelectTag={(tag) => {
          handleSelectTag(tag);
        }}
        onUnlockRequest={(art) => {
          handleUnlockRequest(art);
        }}
        onTipAuthor={handleOpenTip}
        onOpenSupport={handleOpenSupport}
        onAccessUnlocked={handleSupportUnlocked}
        activeTab={currentLockedTab}
        onTabChange={handleLockedTabChange}
      />

      {/* 2. M-Pesa Checkout Modal */}
      <MpesaCheckoutModal
        article={activeCheckoutArticle}
        isOpen={Boolean(activeCheckoutArticle)}
        onClose={handleCloseCheckout}
        onPaymentSuccess={handlePaymentSuccess}
        onOpenSupport={handleOpenSupport}
      />

      {/* 3. My Library Modal */}
      <MyLibraryModal
        isOpen={isLibraryOpen}
        onClose={handleCloseLibrary}
        articles={articles}
        onReadArticle={handleOpenReader}
        onExploreCatalog={() => {
          handleCloseLibrary();
          handleNavigateView('all-pieces');
        }}
      />

      {/* 4. Tip Author Modal */}
      <TipAuthorModal
        isOpen={isTipOpen}
        onClose={handleCloseTip}
        article={tipTargetArticle}
        author={author}
        authorPhone="0705275647"
      />

      {/* 5. Reader Support & Help Desk Modal */}
      <SupportModal
        isOpen={isSupportOpen}
        onClose={handleCloseSupport}
        author={author}
        onUnlockedSuccess={handleSupportUnlocked}
      />

      {/* 6. Secure Affiliate & Referral Sales Portal */}
      <AffiliatePortal
        isOpen={isAffiliatePortalOpen}
        onClose={handleCloseAffiliates}
        articles={articles}
      />

      {/* 7. Unified Authentication Modal (Public /sign-in) */}
      <SignInModal
        isOpen={isSignInOpen}
        onClose={() => {
          setIsSignInOpen(false);
          if (window.location.hash.includes('sign-in') || window.location.hash.includes('signin') || window.location.hash.includes('login')) {
            navigate({ isSignInOpen: false }, 'replace');
          }
        }}
        onSuccess={handleAuthSuccess}
      />

    </div>
  );
}

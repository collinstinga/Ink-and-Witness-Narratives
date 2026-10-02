import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { 
  X, 
  Lock, 
  Smartphone, 
  CheckCircle2, 
  Calendar, 
  Clock, 
  Share2, 
  Instagram, 
  Bookmark, 
  FileText, 
  Copy, 
  Check, 
  ZoomIn, 
  ZoomOut, 
  Twitter, 
  MessageCircle, 
  Quote, 
  Link, 
  ExternalLink, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  Headphones, 
  Volume2, 
  VolumeX, 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  RotateCcw, 
  Radio, 
  Heart, 
  Eye, 
  BookOpen, 
  Info, 
  Building2, 
  LifeBuoy,
  ShieldCheck,
  KeyRound,
  AlertCircle,
  Unlock,
  Shield,
  Star,
  Music2,
  Bell
} from 'lucide-react';
import {
  Article,
  AuthorProfile,
  PieceSocialProof,
  ReaderArticleProgress,
  ReaderReactionType,
  User
} from '../types.js';
import { api, getArticleReceipt } from '../utils/api.js';
import { chooseNarrationVoice, cleanTextForNarration, splitNarrationText } from '../utils/narration.js';
import { SafeMarkdown } from './common/SafeMarkdown.js';
import { ArticleCard } from './ArticleCard.js';

const EMPTY_ARTICLES: Article[] = [];

const REACTION_LABELS: Array<{ type: ReaderReactionType; label: string }> = [
  { type: 'this_hurt', label: 'This hurt' },
  { type: 'felt_seen', label: 'I felt seen' },
  { type: 'beautiful', label: 'Beautiful' },
  { type: 'reread', label: 'I need to reread this' },
  { type: 'damn', label: 'Damn' }
];

interface ArticleReaderModalProps {
  article: Article | null;
  isOpen: boolean;
  isUnlocked: boolean;
  onClose: () => void;
  onUnlockRequest: (article: Article) => void;
  author?: AuthorProfile | null;
  currentUser?: User | null;
  onOpenAuth?: (mode?: 'signin' | 'register') => void;
  onSelectTag?: (tag: string) => void;
  onTipAuthor?: (article: Article) => void;
  onOpenSupport?: () => void;
  onAccessUnlocked?: (articleId: string) => void;
  activeTab?: 'preview' | 'synopsis';
  onTabChange?: (tab: 'preview' | 'synopsis') => void;
  articles?: Article[];
  onReadArticle?: (article: Article) => void;
  isArticleUnlocked?: (article: Article) => boolean;
}

interface SpeechChunk {
  id: string;
  type: 'intro' | 'header' | 'quote' | 'paragraph' | 'outro';
  label: string;
  text: string;
  rawIndex?: number;
  pauseAfterMs?: number;
}

export function selectReaderRecommendations(
  currentArticle: Article | null,
  articles: Article[],
  limit = 4
): Article[] {
  if (!currentArticle || limit <= 0) return [];

  const available = articles.filter(candidate =>
    candidate.id !== currentArticle.id && candidate.status === 'published'
  );
  const byId = new Map(available.map(candidate => [candidate.id, candidate]));
  const selected: Article[] = [];
  const selectedIds = new Set<string>();

  for (const relatedId of currentArticle.manualRelatedPieceIds || []) {
    const candidate = byId.get(relatedId);
    if (!candidate || selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    if (selected.length >= limit) return selected;
  }

  const currentCategories = new Set(
    [currentArticle.category, ...(currentArticle.categories || [])].filter(Boolean)
  );
  const currentTags = new Set(currentArticle.tags || []);
  const currentTopics = new Set(currentArticle.topics || []);
  const relevance = (candidate: Article) => {
    let score = 0;
    const candidateCategories = [candidate.category, ...(candidate.categories || [])];
    if (candidateCategories.some(category => currentCategories.has(category))) score += 8;
    score += (candidate.tags || []).filter(tag => currentTags.has(tag)).length * 3;
    score += (candidate.topics || []).filter(topic => currentTopics.has(topic)).length * 2;
    if (candidate.featured) score += 1;
    return score;
  };
  const publishedTime = (candidate: Article) => {
    const parsed = Date.parse(candidate.publishedAt || candidate.createdAt || '');
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const fallback = available
    .filter(candidate => !selectedIds.has(candidate.id))
    .sort((left, right) => relevance(right) - relevance(left) || publishedTime(right) - publishedTime(left));

  for (const candidate of fallback) {
    selected.push(candidate);
    if (selected.length >= limit) break;
  }
  return selected;
}

export const ArticleReaderModal: React.FC<ArticleReaderModalProps> = ({
  article,
  isOpen,
  isUnlocked,
  onClose,
  onUnlockRequest,
  author,
  currentUser,
  onOpenAuth,
  onSelectTag,
  onTipAuthor,
  onOpenSupport,
  onAccessUnlocked,
  activeTab,
  onTabChange,
  articles = EMPTY_ARTICLES,
  onReadArticle,
  isArticleUnlocked
}) => {
  const [copiedQuote, setCopiedQuote] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [fontSizeClass, setFontSizeClass] = useState<'text-base' | 'text-lg' | 'text-xl'>('text-lg');
  const [lockedTab, setLockedTab] = useState<'preview' | 'synopsis'>(activeTab || 'preview');

  const [manualPhone, setManualPhone] = useState('');
  const [manualActivationToken, setManualActivationToken] = useState('');
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);
  const [manualAlreadyActivated, setManualAlreadyActivated] = useState(false);
  const [manualRequiresAuth, setManualRequiresAuth] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [isLocallyUnlocked, setIsLocallyUnlocked] = useState(false);
  const [readingProgress, setReadingProgress] = useState<ReaderArticleProgress | null>(null);
  const [activeBlockId, setActiveBlockId] = useState('reader-para-0');
  const [socialProof, setSocialProof] = useState<PieceSocialProof | null>(null);
  const [socialLoading, setSocialLoading] = useState(false);
  const [reactionSaving, setReactionSaving] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reviewSaving, setReviewSaving] = useState(false);
  const [reviewNotice, setReviewNotice] = useState('');
  const [followSaving, setFollowSaving] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const progressSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestProgressRef = useRef<{ percent: number; blockId: string; activeChapterId?: string; activeChapterTitle?: string; chapterPercent?: number } | null>(null);
  const lastSavedPercentRef = useRef(-1);
  const lastSavedBlockIdRef = useRef('');

  const effectiveUnlocked = isUnlocked || isLocallyUnlocked;

  useEffect(() => {
    setIsLocallyUnlocked(false);
    setManualAlreadyActivated(false);
    setManualRequiresAuth(false);
    setManualError(null);
    setManualSuccess(null);
    setManualActivationToken('');
    setActiveBlockId('reader-para-0');
  }, [article?.id]);

  const handleVerifyManualAccess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!article) return;

    if (!currentUser) {
      setManualRequiresAuth(true);
      setManualAlreadyActivated(false);
      setManualError(null);
      setManualSuccess('Sign in or register before claiming writer-granted access. Your first successful claim permanently binds the grant to that reader account.');
      return;
    }

    const cleanPhone = manualPhone.trim();
    if (!cleanPhone) {
      setManualError('Enter the phone number the writer authorized for this grant.');
      return;
    }
    if (!manualActivationToken.trim()) {
      setManualError('Enter the one-time activation code the writer gave you for this piece.');
      return;
    }

    setManualVerifying(true);
    setManualError(null);
    setManualSuccess(null);
    setManualAlreadyActivated(false);
    setManualRequiresAuth(false);

    try {
      const res = await api.verifyManualAccess(article.id, cleanPhone, manualActivationToken.trim());
      if (res.requiresAuth) {
        setManualRequiresAuth(true);
        setManualError(null);
        setManualSuccess(res.message || 'Sign in or register before claiming writer-granted access.');
        return;
      }
      if (res.verified) {
        setManualActivationToken('');
        setIsLocallyUnlocked(true);
        setManualRequiresAuth(false);
        setManualAlreadyActivated(false);
        setManualSuccess(res.message || 'Access confirmed & bound. You have full access to read this piece.');
        if (onAccessUnlocked) {
          onAccessUnlocked(article.id);
        }
      } else {
        setManualError(res.message || 'This activation code is invalid or has already been used. Contact the writer if you need help.');
      }
    } catch (err: any) {
      if (err.alreadyActivated || err.code === 'MANUAL_ACCESS_ALREADY_CLAIMED') {
        setManualAlreadyActivated(true);
        setManualRequiresAuth(false);
        setManualError(err.message || 'This phone number is already bound to another reader account. Sign in to the original account or contact Support.');
      } else if (err.requiresAuth) {
        setManualRequiresAuth(true);
        setManualError(null);
        setManualSuccess(err.message || 'Sign in or register before claiming writer-granted access.');
      } else {
        setManualAlreadyActivated(false);
        setManualRequiresAuth(false);
        setManualError(err.message || 'This activation code is invalid or has already been used. Contact the writer if you need help.');
      }
    } finally {
      setManualVerifying(false);
    }
  };

  useEffect(() => {
    if (activeTab) {
      setLockedTab(activeTab);
    }
  }, [activeTab]);

  const handleTabClick = (tab: 'preview' | 'synopsis') => {
    setLockedTab(tab);
    if (onTabChange) {
      onTabChange(tab);
    }
  };

  // Text-To-Speech Audio Narration State
  const [isAudioActive, setIsAudioActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(0.9);
  const [autoScroll, setAutoScroll] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');
  const narrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const narrationGenerationRef = useRef(0);

  const currentChunkIndexRef = useRef(currentChunkIndex);
  currentChunkIndexRef.current = currentChunkIndex;

  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;

  const selectedVoiceURIRef = useRef(selectedVoiceURI);
  selectedVoiceURIRef.current = selectedVoiceURI;

  const autoScrollRef = useRef(autoScroll);
  autoScrollRef.current = autoScroll;

  // Extract candidate quotes from article
  const quotes = useMemo(() => {
    if (!article) return [];
    const list: string[] = [];

    // 1. Excerpt
    if (article.excerpt && article.excerpt.trim()) {
      list.push(article.excerpt.trim());
    }

    // 2. Blockquotes from markdown content
    if (article.content) {
      const lines = article.content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('>')) {
          const clean = trimmed.replace(/^>\s*/, '').trim();
          if (clean.length > 15 && !list.includes(clean)) {
            list.push(clean);
          }
        }
      }
    }

    // 3. Subtitle
    if (article.subtitle && article.subtitle.trim() && !list.includes(article.subtitle.trim())) {
      list.push(article.subtitle.trim());
    }

    return list.length > 0 ? list : [article.title];
  }, [article]);

  // Audio Chunks Generation for Text-To-Speech
  const audioChunks = useMemo<SpeechChunk[]>(() => {
    if (!article) return [];
    const chunks: SpeechChunk[] = [];
    const authorName = author?.name || 'Jake';
    const addProseChunks = (
      type: SpeechChunk['type'],
      text: string,
      label: string,
      rawIndex: number,
      pauseAfterMs: number
    ) => {
      const segments = splitNarrationText(cleanTextForNarration(text), 300);
      segments.forEach((segment, segmentIndex) => {
        chunks.push({
          id: `para-${rawIndex}-${segmentIndex}`,
          type,
          label,
          text: segment,
          rawIndex,
          pauseAfterMs: segmentIndex === segments.length - 1 ? pauseAfterMs : 120
        });
      });
    };

    // 1. Introduction Chunk
    const introText = [cleanTextForNarration(article.title), article.subtitle && cleanTextForNarration(article.subtitle), `By ${authorName}`]
      .filter(Boolean)
      .map(part => /[.!?…]$/.test(part!.trim()) ? part!.trim() : `${part!.trim()}.`)
      .join(' ');
    chunks.push({
      id: 'intro',
      type: 'intro',
      label: 'Title & Monograph Introduction',
      text: introText,
      pauseAfterMs: 600
    });

    if (effectiveUnlocked && article.content) {
      const rawParagraphs = article.content.split('\n\n');
      rawParagraphs.forEach((para, idx) => {
        const trimmed = para.trim();
        if (!trimmed || trimmed.startsWith('---')) return;

        if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
          const cleanHeading = cleanTextForNarration(trimmed);
          addProseChunks('header', trimmed, `Section: ${cleanHeading.slice(0, 30)}...`, idx, 650);
        } else if (trimmed.startsWith('>')) {
          const cleanQuote = cleanTextForNarration(trimmed);
          addProseChunks('quote', trimmed, `Key Quote: ${cleanQuote.slice(0, 30)}...`, idx, 450);
        } else {
          const cleanText = cleanTextForNarration(trimmed);
          if (cleanText.length > 5) {
            addProseChunks('paragraph', trimmed, `Paragraph ${idx + 1}`, idx, 350);
          }
        }
      });

      // Monograph Concluding Chunk
      chunks.push({
        id: 'outro',
        type: 'outro',
        label: 'Conclusion & Monograph Archives',
        text: `You have completed listening to ${article.title} on Ink and Witness. Authored by ${authorName}. Thank you for listening.`
      });
    } else {
      // Outro prompt for locked excerpt
      chunks.push({
        id: 'outro-locked',
        type: 'outro',
        label: 'End of Free Preview Excerpt',
        text: `This concludes the free preview excerpt of ${article.title}. To listen to or read the full unabridged monograph, please unlock the piece via Safaricom M-Pesa.`
      });
    }

    return chunks;
  }, [article, effectiveUnlocked, author]);

  const audioChunksRef = useRef(audioChunks);
  audioChunksRef.current = audioChunks;

  const readerRecommendations = useMemo(
    () => effectiveUnlocked
      ? selectReaderRecommendations(article, articles)
      : [],
    [article, articles, effectiveUnlocked]
  );

  const chapterMarkers = useMemo(() => {
    if (!article?.content) return [];
    return article.content.split('\n\n').map((paragraph, index) => {
      const match = paragraph.trim().match(/^#{1,3}\s+(.+)/);
      return match ? { index, blockId: `reader-para-${index}`, title: match[1].trim() } : null;
    }).filter((marker): marker is { index: number; blockId: string; title: string } => Boolean(marker));
  }, [article?.content]);

  const refreshSocialProof = async (articleId: string) => {
    setSocialLoading(true);
    try {
      setSocialProof(await api.getPieceSocialProof(articleId));
    } catch {
      setSocialProof(null);
    } finally {
      setSocialLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !article?.id) return;
    void refreshSocialProof(article.id);
  }, [isOpen, article?.id, currentUser?.id]);

  useEffect(() => {
    if (!isOpen || !article?.id || !effectiveUnlocked || !currentUser || currentUser.role !== 'client') {
      setReadingProgress(null);
      latestProgressRef.current = null;
      lastSavedPercentRef.current = -1;
      lastSavedBlockIdRef.current = '';
      return;
    }
    latestProgressRef.current = null;
    let active = true;
    api.saveReaderProgress(article.id, {})
      .then(({ progress }) => {
        if (!active) return;
        setReadingProgress(progress);
        setActiveBlockId(progress?.blockId || 'reader-para-0');
        lastSavedPercentRef.current = progress?.percent ?? -1;
        lastSavedBlockIdRef.current = progress?.blockId || '';
        const container = scrollContainerRef.current;
        window.setTimeout(() => {
          if (!active || !container || !progress) return;
          const target = progress.blockId ? document.getElementById(progress.blockId) : null;
          if (target) target.scrollIntoView({ block: 'center' });
          else if (container.scrollHeight > container.clientHeight) {
            container.scrollTop = (progress.percent / 100) * (container.scrollHeight - container.clientHeight);
          }
        }, 180);
      })
      .catch(() => setReadingProgress(null));
    return () => { active = false; };
  }, [isOpen, article?.id, effectiveUnlocked, currentUser?.id, currentUser?.role]);

  const persistLatestProgress = useCallback(() => {
    if (!article || !currentUser || currentUser.role !== 'client' || !latestProgressRef.current) return;
    const payload = latestProgressRef.current;
    if (Math.abs(payload.percent - lastSavedPercentRef.current) < 2 && payload.blockId === lastSavedBlockIdRef.current) return;
    lastSavedPercentRef.current = payload.percent;
    lastSavedBlockIdRef.current = payload.blockId;
    void api.saveReaderProgress(article.id, payload)
      .then(result => setReadingProgress(result.progress))
      .catch(() => {
        // Reading remains uninterrupted; a later scroll/close retries the checkpoint.
        lastSavedPercentRef.current = -1;
        lastSavedBlockIdRef.current = '';
      });
  }, [article?.id, currentUser?.id, currentUser?.role]);

  const handleReaderScroll = () => {
    const container = scrollContainerRef.current;
    if (!container || !article || !effectiveUnlocked || !currentUser || currentUser.role !== 'client') return;
    const scrollable = Math.max(1, container.scrollHeight - container.clientHeight);
    const percent = Math.max(0, Math.min(100, (container.scrollTop / scrollable) * 100));
    const blocks = Array.from(
      container.querySelectorAll<HTMLElement>('[id^="reader-para-"]')
    ) as HTMLElement[];
    const containerTop = container.getBoundingClientRect().top;
    let active = blocks[0];
    for (const block of blocks) {
      if (block.getBoundingClientRect().top <= containerTop + container.clientHeight * 0.35) active = block;
      else break;
    }
    const blockId = active?.id || activeBlockId;
    setActiveBlockId(blockId);
    const blockIndex = Number(blockId.replace('reader-para-', '')) || 0;
    const chapterIndex = chapterMarkers.reduce((found, marker, index) => marker.index <= blockIndex ? index : found, -1);
    const chapter = chapterIndex >= 0 ? chapterMarkers[chapterIndex] : undefined;
    const nextChapter = chapterIndex >= 0 ? chapterMarkers[chapterIndex + 1] : undefined;
    const chapterSpan = Math.max(1, (nextChapter?.index ?? blocks.length) - (chapter?.index ?? 0));
    latestProgressRef.current = {
      percent: Math.round(percent * 10) / 10,
      blockId,
      ...(chapter ? {
        activeChapterId: chapter.blockId,
        activeChapterTitle: chapter.title,
        chapterPercent: Math.max(0, Math.min(100, ((blockIndex - chapter.index) / chapterSpan) * 100))
      } : {})
    };
    const now = new Date().toISOString();
    setReadingProgress(previous => {
      const latest = latestProgressRef.current!;
      return {
        articleId: article.id,
        percent: 0,
        bookmarks: [],
        startedAt: now,
        ...(previous || {}),
        ...latest,
        furthestPercent: Math.max(previous?.furthestPercent ?? previous?.percent ?? 0, latest.percent),
        lastReadAt: now
      };
    });
    if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current);
    progressSaveTimerRef.current = setTimeout(persistLatestProgress, 10_000);
  };

  useEffect(() => {
    if (!isOpen) return undefined;
    return () => {
      if (progressSaveTimerRef.current) clearTimeout(progressSaveTimerRef.current);
      persistLatestProgress();
    };
  }, [isOpen, persistLatestProgress]);

  const handleBookmark = async () => {
    if (!article || !currentUser) {
      onOpenAuth?.('signin');
      return;
    }
    try {
      const block = document.getElementById(activeBlockId);
      const label = block?.textContent?.trim().slice(0, 140) || article.title;
      const result = await api.toggleReaderBookmark(article.id, activeBlockId, label);
      setReadingProgress(result.progress);
      showToast(result.bookmarked ? 'Passage bookmarked' : 'Bookmark removed');
    } catch (error: any) {
      showToast(error?.message || 'Bookmark could not be updated.');
    }
  };

  const handleReaction = async (reaction: ReaderReactionType) => {
    if (!article || !currentUser) {
      onOpenAuth?.('signin');
      return;
    }
    setReactionSaving(true);
    try {
      const result = await api.setPieceReaction(article.id, reaction);
      setSocialProof(previous => previous ? {
        ...previous,
        reactionCounts: result.reactionCounts,
        currentReaction: result.currentReaction
      } : previous);
    } catch (error: any) {
      showToast(error?.message || 'Reaction could not be saved.');
    } finally {
      setReactionSaving(false);
    }
  };

  const handleReviewSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!article || !currentUser) return onOpenAuth?.('signin');
    setReviewSaving(true);
    setReviewNotice('');
    try {
      const result = await api.savePieceReview(article.id, reviewRating, reviewText);
      setReviewText('');
      setReviewNotice(result.message);
      await refreshSocialProof(article.id);
    } catch (error: any) {
      setReviewNotice(error?.message || 'Review could not be saved.');
    } finally {
      setReviewSaving(false);
    }
  };

  const handleFollowWork = async () => {
    if (!article) return;
    if (!currentUser) return onOpenAuth?.('signin');
    setFollowSaving(true);
    try {
      const result = await api.followNewsletterWork(article.id);
      showToast(result.message);
    } catch (error: any) {
      showToast(error?.message || 'Notification preference could not be saved.');
    } finally {
      setFollowSaving(false);
    }
  };

  // Initialize Speech Synthesis Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const list = voices.filter(v => /^en(?:[-_]|$)/i.test(v.lang));
      setAvailableVoices(list);

      if (list.length === 0) {
        setSelectedVoiceURI('');
        return;
      }
      if (list.length > 0 && !list.some(v => v.voiceURI === selectedVoiceURIRef.current)) {
        setSelectedVoiceURI(chooseNarrationVoice(list)?.voiceURI || list[0].voiceURI);
      }
    };

    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, []);

  // Cleanup speech synthesis on unmount, close, or article switch
  useEffect(() => {
    setIsPlaying(false);
    setIsAudioActive(false);
    setCurrentChunkIndex(0);
    return () => {
      narrationGenerationRef.current += 1;
      if (narrationTimerRef.current) {
        clearTimeout(narrationTimerRef.current);
        narrationTimerRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [article?.id, article?.content, effectiveUnlocked, isOpen]);

  // Shield keyboard shortcuts for printing, copying, or saving
  useEffect(() => {
    if (!isOpen || !effectiveUnlocked) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ['c', 'p', 's', 'u'].includes(e.key.toLowerCase())) {
        if (['c', 'p', 's'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          setToastMessage('Protected Monograph • Online in-browser reading only');
          setTimeout(() => setToastMessage(null), 3000);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, effectiveUnlocked]);

  const cancelNarration = () => {
    narrationGenerationRef.current += 1;
    if (narrationTimerRef.current) {
      clearTimeout(narrationTimerRef.current);
      narrationTimerRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  // Core Speech Synthesis Speaker Function
  const speakChunk = (chunkIndex: number, rate?: number, voiceURI?: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Speech narration is not supported on this browser.');
      return;
    }

    const chunks = audioChunksRef.current;
    if (!chunks || chunkIndex < 0 || chunkIndex >= chunks.length) {
      setIsPlaying(false);
      return;
    }

    cancelNarration();
    const generation = narrationGenerationRef.current;

    const chunk = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    
    const currentRate = rate !== undefined ? rate : playbackRateRef.current;
    utterance.rate = chunk.type === 'header' ? currentRate * 0.95 : currentRate;
    utterance.pitch = chunk.type === 'header' ? 0.98 : 1.0;

    // Apply chosen voice
    const currentVoiceURI = voiceURI !== undefined ? voiceURI : selectedVoiceURIRef.current;
    const voices = window.speechSynthesis.getVoices().filter(v => /^en(?:[-_]|$)/i.test(v.lang));
    const voice = voices.find(v => v.voiceURI === currentVoiceURI) || chooseNarrationVoice(voices);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = 'en';
    }

    utterance.onstart = () => {
      if (generation !== narrationGenerationRef.current) return;
      setIsPlaying(true);
      setCurrentChunkIndex(chunkIndex);

      // Auto-scroll to current paragraph if enabled
      if (autoScrollRef.current && chunk.rawIndex !== undefined) {
        setTimeout(() => {
          if (generation !== narrationGenerationRef.current) return;
          const elem = document.getElementById(`reader-para-${chunk.rawIndex}`);
          if (elem) {
            elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 80);
      }
    };

    utterance.onend = () => {
      if (generation !== narrationGenerationRef.current) return;

      if (chunkIndex + 1 < audioChunksRef.current.length) {
        const nextIndex = chunkIndex + 1;
        setCurrentChunkIndex(nextIndex);
        narrationTimerRef.current = setTimeout(() => {
          narrationTimerRef.current = null;
          if (generation === narrationGenerationRef.current) speakChunk(nextIndex);
        }, chunk.pauseAfterMs ?? 200);
      } else {
        setIsPlaying(false);
        showToast('Monograph audio narration complete.');
      }
    };

    utterance.onerror = (e) => {
      if (generation !== narrationGenerationRef.current) return;
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('SpeechSynthesis error:', e);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  // User Actions for Audio Playback
  const handlePlayPause = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (isPlaying) {
      if (narrationTimerRef.current) {
        clearTimeout(narrationTimerRef.current);
        narrationTimerRef.current = null;
      } else if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
      }
      setIsPlaying(false);
    } else if (window.speechSynthesis.paused && window.speechSynthesis.speaking) {
      window.speechSynthesis.resume();
      setIsPlaying(true);
    } else {
      speakChunk(currentChunkIndex);
    }
  };

  const handleToggleAudio = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      showToast('Text-to-Speech is not supported in this browser.');
      return;
    }

    if (!isAudioActive) {
      setIsAudioActive(true);
      speakChunk(currentChunkIndex);
      showToast('Hands-free Audio Narration started');
    } else {
      handlePlayPause();
    }
  };

  const handleNextChunk = () => {
    if (currentChunkIndex + 1 < audioChunks.length) {
      const next = currentChunkIndex + 1;
      setCurrentChunkIndex(next);
      if (isPlaying) {
        speakChunk(next);
      } else {
        cancelNarration();
      }
    }
  };

  const handlePrevChunk = () => {
    if (currentChunkIndex > 0) {
      const prev = currentChunkIndex - 1;
      setCurrentChunkIndex(prev);
      if (isPlaying) {
        speakChunk(prev);
      } else {
        cancelNarration();
      }
    }
  };

  const handleStopAudio = () => {
    cancelNarration();
    setIsPlaying(false);
    setCurrentChunkIndex(0);
  };

  const handleCloseAudio = () => {
    handleStopAudio();
    setIsAudioActive(false);
  };

  const handleSpeedChange = (newRate: number) => {
    setPlaybackRate(newRate);
    if (isPlaying) {
      speakChunk(currentChunkIndex, newRate);
    } else if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
      cancelNarration();
    }
  };

  const handleVoiceChange = (voiceURI: string) => {
    setSelectedVoiceURI(voiceURI);
    if (isPlaying) {
      speakChunk(currentChunkIndex, playbackRate, voiceURI);
    } else if (typeof window !== 'undefined' && window.speechSynthesis?.paused) {
      cancelNarration();
    }
  };

  if (!isOpen || !article) return null;

  const currentQuote = quotes[activeQuoteIndex] || quotes[0] || article.excerpt || article.title;
  const receipt = getArticleReceipt(article.id);

  // Generate specific deep-link URL for this monograph
  const getMonographUrl = () => {
    if (typeof window !== 'undefined') {
      const origin = window.location.origin;
      const pathname = window.location.pathname;
      return `${origin}${pathname}?monograph=${encodeURIComponent(article.slug || article.id)}`;
    }
    return `https://inkandwitness.com/?monograph=${article.slug || article.id}`;
  };

  function showToast(msg: string) {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  }

  // 1. Share on X (formerly Twitter)
  const handleShareToX = (customQuote?: string) => {
    const quoteText = customQuote || currentQuote;
    const url = getMonographUrl();

    // Ensure the tweet text with quote and author stays clean
    const maxQuoteLen = 170;
    const cleanQuote = quoteText.length > maxQuoteLen 
      ? `${quoteText.substring(0, maxQuoteLen).trim()}...` 
      : quoteText;

    const tweetText = `“${cleanQuote}”\n\n— From “${article.title}” by Jake (@its_bigboy_jake)`;
    const tagsParam = article.tags && article.tags.length > 0 ? article.tags.slice(0, 2).join(',') : 'InkAndWitness';
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}&url=${encodeURIComponent(url)}&hashtags=${encodeURIComponent(tagsParam)}`;
    
    window.open(xUrl, '_blank', 'noopener,noreferrer,width=600,height=500');
    setShowShareMenu(false);
  };

  // 2. Share on WhatsApp
  const handleShareToWhatsApp = (customQuote?: string) => {
    const quoteText = customQuote || currentQuote;
    const url = getMonographUrl();

    const whatsappMessage = `*“${quoteText}”*\n\n— From *${article.title}* by Jake (Ink & Witness)\n\n📖 Read the monograph:\n${url}`;
    const waUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(whatsappMessage)}`;
    
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    setShowShareMenu(false);
  };

  // 3. Copy Quote & Direct Link
  const handleCopyQuoteAndLink = (customQuote?: string) => {
    const quoteText = customQuote || currentQuote;
    const url = getMonographUrl();
    const fullSnippet = `“${quoteText}”\n\n— From “${article.title}” by Jake (Ink & Witness)\n${url}`;

    navigator.clipboard.writeText(fullSnippet);
    setCopiedQuote(true);
    showToast('Quote & Monograph link copied to clipboard!');
    setTimeout(() => setCopiedQuote(false), 2500);
    setShowShareMenu(false);
  };

  // 4. Copy Direct Monograph Link Only
  const handleCopyDirectLink = () => {
    const url = getMonographUrl();
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    showToast('Monograph link copied to clipboard!');
    setTimeout(() => setCopiedLink(false), 2500);
    setShowShareMenu(false);
  };

  // 5. Native Share API (fallback / mobile)
  const handleNativeShare = () => {
    const url = getMonographUrl();
    if (navigator.share) {
      navigator.share({
        title: `${article.title} | Ink & Witness`,
        text: `“${currentQuote}” — From “${article.title}” by Jake (@its_bigboy_jake)`,
        url,
      }).catch(() => {});
    } else {
      handleCopyQuoteAndLink();
    }
  };

  const activeChunk = audioChunks[currentChunkIndex];

  return (
    <div 
      id="article-reader-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/90 backdrop-blur-md overflow-y-auto"
    >
      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-50 py-3 px-4 rounded-xl bg-slate-900 border border-emerald-500/60 shadow-2xl text-emerald-300 text-xs font-mono flex items-center gap-2 animate-in fade-in slide-in-from-top-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      <div className="relative w-full max-w-4xl rounded-2xl sm:rounded-3xl bg-[#0b101b] border border-slate-700/80 shadow-2xl overflow-hidden my-4 sm:my-8 max-h-[92vh] flex flex-col">
        
        {/* Reader Top Sticky Action Bar - Horizontally Swipeable with essential controls */}
        <div className="w-full px-3 sm:px-6 py-2.5 sm:py-3 bg-slate-900/95 border-b border-slate-800 shrink-0 z-20 backdrop-blur-md overflow-hidden">
          <div className="flex items-center justify-between gap-2 sm:gap-4 overflow-x-auto no-scrollbar scroll-smooth touch-pan-x w-full">
            
            {/* Left side: Category & Reading Status */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs font-mono font-semibold px-2.5 py-1 rounded bg-sky-950/80 border border-sky-800 text-sky-400 whitespace-nowrap">
                {article.category}
              </span>
              {effectiveUnlocked && (
                <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-emerald-400 bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-800/40 whitespace-nowrap">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Personal Library Monograph</span>
                  <span className="sm:hidden">Unlocked</span>
                </span>
              )}
            </div>

            {/* Right side: Audio, Resizer, Web badge, Sharing, Support, Close */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              
              {/* TEXT-TO-SPEECH AUDIO NARRATION BUTTON */}
              <button
                id="reader-audio-narrate-btn"
                onClick={handleToggleAudio}
                className={`flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-medium transition-all cursor-pointer shadow-sm shrink-0 whitespace-nowrap ${
                  isAudioActive
                    ? isPlaying
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold ring-2 ring-amber-400/50 shadow-amber-500/20'
                      : 'bg-amber-600/90 hover:bg-amber-500 text-white font-semibold'
                    : 'bg-slate-800 hover:bg-slate-700 text-sky-300 hover:text-white border border-slate-700'
                }`}
                title="Listen to Monograph via Text-To-Speech Audio Narration"
              >
                {isAudioActive && isPlaying ? (
                  <div className="flex items-center gap-0.5">
                    <span className="w-1 h-3.5 bg-slate-950 rounded-full animate-pulse" />
                    <span className="w-1 h-2 bg-slate-950 rounded-full animate-pulse" />
                    <span className="w-1 h-4 bg-slate-950 rounded-full animate-pulse" />
                  </div>
                ) : (
                  <Headphones className="w-3.5 h-3.5 text-sky-400" />
                )}
                <span>{isAudioActive ? (isPlaying ? 'Playing Audio' : 'Audio Paused') : 'Audio'}</span>
              </button>

              {effectiveUnlocked && (
                <button
                  id="reader-bookmark-btn"
                  type="button"
                  onClick={() => void handleBookmark()}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    readingProgress?.bookmarks.some(bookmark => bookmark.blockId === activeBlockId)
                      ? 'border-amber-600 bg-amber-950/70 text-amber-300'
                      : 'border-slate-700 bg-slate-800 text-slate-300 hover:border-amber-700 hover:text-amber-300'
                  }`}
                  title="Save or remove a bookmark at the current passage"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                  <span>Bookmark</span>
                </button>
              )}

              {/* Font size toggles */}
              <div className="flex items-center gap-1 bg-slate-950 px-2 py-1 rounded-lg border border-slate-800 text-xs font-mono text-slate-400 shrink-0">
                <button
                  onClick={() => setFontSizeClass('text-base')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSizeClass === 'text-base' ? 'bg-slate-800 text-white font-bold' : 'hover:text-slate-200'}`}
                  title="Normal font size"
                >
                  A
                </button>
                <button
                  onClick={() => setFontSizeClass('text-lg')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSizeClass === 'text-lg' ? 'bg-slate-800 text-white font-bold' : 'hover:text-slate-200'}`}
                  title="Medium font size"
                >
                  A+
                </button>
                <button
                  onClick={() => setFontSizeClass('text-xl')}
                  className={`px-1.5 py-0.5 rounded cursor-pointer ${fontSizeClass === 'text-xl' ? 'bg-slate-800 text-white font-bold' : 'hover:text-slate-200'}`}
                  title="Large font size"
                >
                  A++
                </button>
              </div>

              {effectiveUnlocked && (
                <div
                  id="reader-web-only-badge"
                  className="hidden md:flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-sky-950/80 border border-sky-500/40 text-sky-300 text-xs font-mono select-none shrink-0 whitespace-nowrap"
                  title="Protected Reader Access • Online Monograph Edition"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                  <span>Web-Only Reader</span>
                </div>
              )}

              {/* Quick Share to X (Twitter) Icon Button */}
              <button
                id="top-share-x-btn"
                onClick={() => handleShareToX()}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                title="Share Quote to X (Twitter)"
              >
                <Twitter className="w-4 h-4" />
              </button>

              {/* Quick Share to WhatsApp Icon Button */}
              <button
                id="top-share-whatsapp-btn"
                onClick={() => handleShareToWhatsApp()}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                title="Share Quote to WhatsApp"
              >
                <MessageCircle className="w-4 h-4" />
              </button>

              {/* Share Dropdown / Popover Menu */}
              <div className="relative shrink-0">
                <button
                  id="top-share-menu-btn"
                  onClick={() => setShowShareMenu(!showShareMenu)}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer flex items-center gap-1"
                  title="More Share Options"
                >
                  <Share2 className="w-4 h-4" />
                </button>

                {showShareMenu && (
                  <div 
                    className="absolute right-0 mt-2 w-64 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-2 z-50 space-y-1 text-xs font-sans animate-in fade-in slide-in-from-top-2"
                  >
                    <div className="px-3 py-2 border-b border-slate-800">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400 block">
                        Share Monograph
                      </span>
                      <p className="text-slate-300 text-xs font-medium truncate">
                        {article.title}
                      </p>
                    </div>

                    <button
                      onClick={() => handleShareToX()}
                      className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-800/80 text-sky-400 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                    >
                      <Twitter className="w-4 h-4 shrink-0" />
                      <span>Share Quote to X (Twitter)</span>
                    </button>

                    <button
                      onClick={() => handleShareToWhatsApp()}
                      className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-800/80 text-emerald-400 flex items-center gap-2.5 transition-colors cursor-pointer font-medium"
                    >
                      <MessageCircle className="w-4 h-4 shrink-0" />
                      <span>Share Quote to WhatsApp</span>
                    </button>

                    <button
                      onClick={() => handleCopyQuoteAndLink()}
                      className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-800/80 text-slate-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      {copiedQuote ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
                      <span>{copiedQuote ? 'Quote Copied!' : 'Copy Quote & Link'}</span>
                    </button>

                    <button
                      onClick={handleCopyDirectLink}
                      className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-800/80 text-slate-300 flex items-center gap-2.5 transition-colors cursor-pointer"
                    >
                      {copiedLink ? <Check className="w-4 h-4 text-emerald-400 shrink-0" /> : <Link className="w-4 h-4 shrink-0" />}
                      <span>{copiedLink ? 'Link Copied!' : 'Copy Direct Link'}</span>
                    </button>

                    {typeof navigator !== 'undefined' && 'share' in navigator && (
                      <button
                        onClick={handleNativeShare}
                        className="w-full px-3 py-2 rounded-xl text-left hover:bg-slate-800/80 text-slate-300 flex items-center gap-2.5 transition-colors cursor-pointer border-t border-slate-800 mt-1"
                      >
                        <Share2 className="w-4 h-4 shrink-0 text-purple-400" />
                        <span>More Share Options...</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Need Help / Support Icon Button */}
              {onOpenSupport && (
                <button
                  id="reader-top-support-btn"
                  onClick={onOpenSupport}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer flex items-center justify-center shrink-0"
                  title="Reader Support & Verification Help"
                >
                  <LifeBuoy className="w-4 h-4" />
                </button>
              )}

              <button
                id="reader-close-btn"
                onClick={onClose}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer ml-1 shrink-0"
                aria-label="Close reader"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* DOCKED HANDS-FREE AUDIO NARRATION PLAYER BAR */}
        {isAudioActive && (
          <div 
            id="reader-audio-player-dock"
            className="bg-slate-950/95 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 z-20 backdrop-blur-md shadow-xl flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono animate-in fade-in slide-in-from-top-1"
          >
            {/* Left: Playback Controls & Chunk Step */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
              <div className="flex items-center gap-1.5">
                <button
                  id="audio-prev-chunk-btn"
                  onClick={handlePrevChunk}
                  disabled={currentChunkIndex === 0}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 text-slate-300 transition-colors cursor-pointer"
                  title="Previous Paragraph / Section"
                  aria-label="Previous narration segment"
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>

                <button
                  id="audio-play-pause-btn"
                  onClick={handlePlayPause}
                  className="p-2 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-md shadow-amber-500/30 cursor-pointer flex items-center justify-center"
                  title={isPlaying ? 'Pause Audio' : 'Resume Audio'}
                  aria-label={isPlaying ? 'Pause narration' : 'Resume narration'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  id="audio-next-chunk-btn"
                  onClick={handleNextChunk}
                  disabled={currentChunkIndex >= audioChunks.length - 1}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 text-slate-300 transition-colors cursor-pointer"
                  title="Next Paragraph / Section"
                  aria-label="Next narration segment"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>

                <button
                  id="audio-stop-btn"
                  onClick={handleStopAudio}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Reset Narration to Beginning"
                  aria-label="Reset narration to beginning"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Playing Status Badge */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <span className="inline-flex items-center gap-1.5 text-amber-300 font-semibold">
                  <Radio className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>Section {currentChunkIndex + 1}/{audioChunks.length}</span>
                </span>
                <span className="text-[11px] text-slate-400 hidden md:inline truncate max-w-[200px]">
                  {activeChunk?.label || 'Narrating...'}
                </span>
              </div>
            </div>

            {/* Center: Live spoken snippet preview */}
            <div className="hidden lg:flex items-center gap-2 flex-1 max-w-md mx-2 px-3 py-1 rounded-lg bg-slate-900/80 border border-slate-800/80 text-slate-300 text-[11px] truncate">
              <Volume2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate italic text-slate-300">
                &ldquo;{activeChunk?.text.slice(0, 70)}...&rdquo;
              </span>
            </div>

            {/* Right: Audio Settings (Speed, Voice, Auto-Scroll, Close) */}
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {/* Speed Rate Pills */}
              <div className="flex items-center gap-1 bg-slate-900 px-1.5 py-0.5 rounded-lg border border-slate-800 text-[11px]">
                {[0.9, 1.0, 1.2, 1.5].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleSpeedChange(rate)}
                    aria-label={`Narration speed ${rate} times`}
                    aria-pressed={playbackRate === rate}
                    className={`px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                      playbackRate === rate 
                        ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Voice Selection Dropdown if multiple available */}
              {availableVoices.length > 1 && (
                <select
                  value={selectedVoiceURI}
                  onChange={(e) => handleVoiceChange(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg px-2 py-1 text-[11px] text-slate-300 hover:text-white focus:outline-none focus:border-amber-500 cursor-pointer max-w-[120px] truncate"
                  title="Select a narration voice available on this device"
                  aria-label="Narration voice"
                >
                  {availableVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              )}

              {/* Auto Scroll Toggle */}
              <button
                onClick={() => setAutoScroll(!autoScroll)}
                className={`px-2 py-1 rounded-lg border text-[11px] flex items-center gap-1 cursor-pointer transition-colors ${
                  autoScroll 
                    ? 'bg-sky-950/80 border-sky-800 text-sky-300 font-semibold' 
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
                title="Toggle Auto-Scroll to Active Text"
              >
                <span>Scroll</span>
                <span className={`w-1.5 h-1.5 rounded-full ${autoScroll ? 'bg-sky-400' : 'bg-slate-600'}`} />
              </button>

              {/* Close Audio Player */}
              <button
                onClick={handleCloseAudio}
                className="p-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Close Audio Narration Player"
                aria-label="Close narration player"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Reader Body */}
        <div
          id="article-reader-scroll"
          ref={scrollContainerRef}
          onScroll={handleReaderScroll}
          className="overflow-y-auto px-6 sm:px-12 py-8 flex-1 space-y-8"
        >
          {effectiveUnlocked && currentUser?.role === 'client' && readingProgress && (
            <div className="sticky top-0 z-10 -mx-2 rounded-xl border border-sky-800/60 bg-slate-950/95 px-3 py-2 shadow-lg backdrop-blur">
              <div className="mb-1 flex items-center justify-between gap-3 text-[10px] font-mono text-slate-400">
                <span className="truncate">
                  {readingProgress.activeChapterTitle || 'Continue where you left off'}
                  {readingProgress.chapterPercent !== undefined ? ` • ${Math.round(readingProgress.chapterPercent)}% of chapter` : ''}
                </span>
                <span className="shrink-0 text-sky-300">{Math.round(readingProgress.percent)}% read</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-sky-500 transition-[width]" style={{ width: `${readingProgress.percent}%` }} />
              </div>
              {readingProgress.bookmarks.length > 0 && (
                <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="Saved bookmarks">
                  {readingProgress.bookmarks.map(bookmark => (
                    <button
                      key={bookmark.id}
                      type="button"
                      onClick={() => document.getElementById(bookmark.blockId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                      className="max-w-[14rem] shrink-0 truncate rounded-full border border-amber-800/70 bg-amber-950/50 px-2 py-1 text-[9px] text-amber-200 hover:border-amber-600"
                      title={bookmark.label}
                    >
                      <Bookmark className="mr-1 inline h-2.5 w-2.5" />{bookmark.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Header Title Section */}
          <header className="border-b border-slate-800/80 pb-8 space-y-4">
            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Published {article.publishedAt}
              </span>
              {article.showReadTime !== false && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {article.readTimeMinutes} min read
                  </span>
                </>
              )}
              {receipt && (
                <>
                  <span>•</span>
                  <span className="text-sky-400">M-Pesa: {receipt}</span>
                </>
              )}
            </div>

            <h1 className="font-display font-bold text-2xl sm:text-4xl text-white tracking-tight leading-tight">
              {article.title}
            </h1>

            {article.subtitle && (
              <p className="font-serif italic text-base sm:text-xl text-slate-300 leading-relaxed font-light">
                {article.subtitle}
              </p>
            )}

            <div className="pt-2 flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-sky-600 to-slate-800 overflow-hidden flex items-center justify-center font-display font-bold text-sky-200">
                  {author?.avatarUrl ? (
                    <img src={author.avatarUrl} alt={author.name || 'Jake'} className="w-full h-full object-cover" />
                  ) : (
                    <span>{(author?.name || 'J').charAt(0)}</span>
                  )}
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">{author?.name || 'Jake'}</div>
                  <a
                    href={author?.instagramUrl || "https://www.instagram.com/its_bigboy_jake/"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-mono text-sky-400 hover:underline flex items-center gap-1"
                  >
                    <Instagram className="w-3 h-3" />
                    <span>@{author?.handle || "its_bigboy_jake"}</span>
                  </a>
                </div>
              </div>

              {/* Header Quick Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleToggleAudio}
                  className="px-3 py-1 rounded-full bg-amber-950/70 hover:bg-amber-900/80 border border-amber-700/60 text-xs font-mono text-amber-300 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Listen to Monograph via Audio Narration"
                >
                  <Headphones className="w-3.5 h-3.5 text-amber-400" />
                  <span>{isAudioActive && isPlaying ? 'Narrating' : 'Listen'}</span>
                </button>
                
                <button
                  onClick={() => handleShareToX()}
                  className="px-3 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-sky-500/50 text-xs font-mono text-sky-400 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Share Quote on X"
                >
                  <Twitter className="w-3.5 h-3.5" />
                  <span>Post Quote</span>
                </button>
                <button
                  onClick={() => handleShareToWhatsApp()}
                  className="px-3 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/50 text-xs font-mono text-emerald-400 transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Share Quote on WhatsApp"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>WhatsApp</span>
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5 w-full sm:w-auto">
                {article.tags.map((tag, idx) => (
                  <button 
                    key={idx}
                    type="button"
                    onClick={() => onSelectTag && onSelectTag(tag)}
                    className="text-xs font-mono px-2 py-0.5 rounded bg-slate-900 hover:bg-sky-950 text-slate-400 hover:text-sky-300 border border-slate-800 hover:border-sky-800 transition-colors cursor-pointer"
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>
          </header>

          {effectiveUnlocked && article.coverImage && (
            <figure
              id="reader-unlocked-cover"
              className="mx-auto max-w-xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-xl"
            >
              <img
                src={article.coverImage}
                alt={`${article.title} cover`}
                className="block w-full max-h-[32rem] object-contain"
              />
            </figure>
          )}

          {/* Article Body Content */}
          <div className={`prose-editorial ${fontSizeClass} text-slate-200 space-y-6 max-w-none`}>
            <div className="space-y-6">
              {effectiveUnlocked && article.content ? (
                <div 
                  className="protected-reader-content select-none space-y-6 relative watermark-pattern p-2 sm:p-4 rounded-2xl transition-all"
                  onCopy={(e) => {
                    e.preventDefault();
                    showToast("Protected Monograph • Online reader edition");
                  }}
                  onCut={(e) => e.preventDefault()}
                  onContextMenu={(e) => e.preventDefault()}
                  onDragStart={(e) => e.preventDefault()}
                >
                  {article.content.split('\n\n').map((paragraph, index) => {
                    const markdown = paragraph.trim();
                    if (!markdown) return null;
                    return (
                      <SafeMarkdown
                        key={index}
                        markdown={markdown}
                        variant="reader"
                        blockId={`reader-para-${index}`}
                        active={isAudioActive && activeChunk?.rawIndex === index}
                        quoteAttribution={`Jake • ${article.title}`}
                        onShareQuoteToX={handleShareToX}
                        onShareQuoteToWhatsApp={handleShareToWhatsApp}
                        onCopyQuote={handleCopyQuoteAndLink}
                      />
                    );
                  })}

                  {/* Bottom License Footer */}
                  <div className="mt-12 pt-6 border-t border-slate-800/80 text-center select-none space-y-2">
                    <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs font-mono text-slate-400">
                      <ShieldCheck className="w-4 h-4 text-sky-400" />
                      <span>Protected Monograph • Online Reader Edition</span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500">
                      Ink & Witness • Copyright © {new Date().getFullYear()} Jake. Reader access permanently registered in your Library.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Three Clear Actions Toolbar for Locked Piece */}
                  <div className="p-1.5 sm:p-2 rounded-2xl bg-gradient-to-r from-slate-900 via-[#0e1628] to-slate-900 border border-slate-800 shadow-xl flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    
                    {/* Left: Tab Selectors for Preview & Synopsis */}
                    <div className="flex items-center gap-1.5 p-1 rounded-xl bg-slate-950/80 border border-slate-800/80">
                      <button
                        type="button"
                        id="btn-locked-tab-preview"
                        onClick={() => handleTabClick('preview')}
                        className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                          lockedTab === 'preview'
                            ? 'bg-sky-600 text-white shadow-md shadow-sky-950/60'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>

                      <button
                        type="button"
                        id="btn-locked-tab-synopsis"
                        onClick={() => handleTabClick('synopsis')}
                        className={`flex-1 sm:flex-initial px-4 py-2 rounded-lg text-xs font-mono font-semibold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                          lockedTab === 'synopsis'
                            ? 'bg-indigo-600 text-white shadow-md shadow-indigo-950/60'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span>Synopsis</span>
                      </button>
                    </div>

                    {/* Right: Primary Unlock Action Button */}
                    <button
                      type="button"
                      id="btn-locked-action-unlock"
                      onClick={() => onUnlockRequest(article)}
                      className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold tracking-wide transition-all shadow-lg shadow-emerald-950/70 flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                      <Smartphone className="w-3.5 h-3.5 text-emerald-200" />
                      <span>PAY TO READ — KSh {article.priceKes}</span>
                    </button>
                  </div>

                  {/* VIEW A: PREVIEW TAB */}
                  {lockedTab === 'preview' && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                      {/* Short limited excerpt display - strictly author's tailored excerpt only */}
                      {article.excerpt && article.excerpt.trim() ? (
                        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
                          <div className="flex items-center gap-2 text-sky-400 text-xs font-mono font-semibold uppercase tracking-wider">
                            <Eye className="w-4 h-4" />
                            <span>Limited Excerpt</span>
                          </div>

                          <div className="leading-relaxed text-slate-200 font-sans text-base sm:text-lg whitespace-pre-line italic">
                            {article.excerpt.trim()}
                          </div>
                        </div>
                      ) : null}

                      {/* End of Preview / Lock Notice */}
                      <div className="relative p-8 sm:p-10 rounded-3xl bg-gradient-to-b from-slate-900 via-[#0d1527] to-[#090d18] border border-emerald-500/30 shadow-2xl text-center overflow-hidden">
                        <div className="relative z-10 max-w-lg mx-auto space-y-5">
                          <div className="inline-flex p-3 rounded-2xl bg-emerald-950/80 border border-emerald-500/40 text-emerald-400 shadow-inner">
                            <Smartphone className="w-6 h-6 text-emerald-400" />
                          </div>

                          <div className="space-y-2">
                            <h3 className="font-display font-bold text-2xl sm:text-3xl text-white">
                              Pay to Read Complete Monograph
                            </h3>
                            <p className="text-sm text-slate-300 leading-relaxed font-sans">
                              The remainder of this monograph is locked. Pay <strong>KSh {article.priceKes}</strong> via M-PESA to receive the official STK Push on your phone and unlock permanent reading access across all devices.
                            </p>
                          </div>

                          {/* Primary Action Button */}
                          <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                            <button
                              id="paywall-unlock-modal-btn"
                              onClick={() => onUnlockRequest(article)}
                              className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm sm:text-base tracking-wide transition-all shadow-xl shadow-emerald-950/80 cursor-pointer flex items-center justify-center gap-2.5"
                            >
                              <Smartphone className="w-5 h-5 text-emerald-200" />
                              <span>PAY TO READ — KSh {article.priceKes} (M-PESA)</span>
                            </button>

                            <button
                              onClick={() => handleTabClick('synopsis')}
                              className="w-full sm:w-auto px-5 py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <BookOpen className="w-3.5 h-3.5 text-indigo-400" />
                              <span>Read Synopsis</span>
                            </button>
                          </div>

                          <div className="flex items-center justify-center gap-2 text-xs font-mono text-emerald-400/90 pt-1">
                            <ShieldCheck className="w-4 h-4" />
                            <span>Official Safaricom Daraja STK Push • Instant Handset Prompt</span>
                          </div>

                          {onOpenSupport && (
                            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-center gap-4 text-[11px] font-mono text-slate-400">
                              <button
                                type="button"
                                onClick={() => {
                                  setShowManualForm((isVisible) => !isVisible);
                                  setManualError(null);
                                  setManualSuccess(null);
                                }}
                                className="text-sky-400 hover:text-sky-300 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              >
                                <KeyRound className="w-3 h-3" />
                                <span>{showManualForm ? 'Hide Grant Claim Form' : 'Writer granted access? Claim it'}</span>
                              </button>

                              <button
                                type="button"
                                onClick={onOpenSupport}
                                className="text-cyan-400 hover:text-cyan-300 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              >
                                <LifeBuoy className="w-3 h-3" />
                                <span>Support Desk</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* WRITER-GRANTED, ACCOUNT-BOUND ACCESS CLAIM */}
                      {showManualForm && (
                      <div className="p-6 rounded-2xl bg-slate-900/90 border border-sky-500/30 text-left space-y-4 animate-in fade-in">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-sky-400 font-mono text-xs font-semibold uppercase tracking-wider">
                            <KeyRound className="w-4 h-4" />
                            <span>Writer-Granted Access</span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 font-sans leading-relaxed">
                          Use this form only if Jake gave you a one-time activation code for this piece and phone number. Sign in first; after activation, access belongs to your account. M-PESA purchases unlock from confirmed payment records.
                        </p>

                        <form onSubmit={handleVerifyManualAccess} className="space-y-3 pt-2">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <div className="relative flex-1">
                                <Smartphone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                <input
                                  type="tel"
                                  id="manual-access-phone-input"
                                  value={manualPhone}
                                  onChange={(e) => setManualPhone(e.target.value)}
                                  placeholder="Writer-authorized phone number"
                                  autoComplete="tel"
                                  aria-label="Writer-authorized phone number"
                                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                />
                              </div>

                              <input
                                type="text"
                                id="manual-access-code-input"
                                value={manualActivationToken}
                                onChange={(e) => setManualActivationToken(e.target.value)}
                                placeholder="One-time activation code"
                                autoComplete="off"
                                spellCheck={false}
                                aria-label="One-time activation code"
                                className="flex-1 px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono placeholder:text-slate-500 focus:outline-none focus:border-sky-500"
                              />

                              <button
                                type="submit"
                                id="btn-verify-manual-access"
                                disabled={manualVerifying || !manualPhone.trim() || !manualActivationToken.trim()}
                                className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-mono font-bold tracking-wide transition-all shadow-md shadow-sky-950/70 flex items-center justify-center gap-2 cursor-pointer shrink-0"
                              >
                                {manualVerifying ? (
                                  <>
                                    <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Verifying...</span>
                                  </>
                                ) : (
                                  <>
                                    <Unlock className="w-3.5 h-3.5" />
                                    <span>Verify &amp; Unlock</span>
                                  </>
                                )}
                              </button>
                            </div>

                            {/* 1. ACCOUNT BINDING REQUIRES AUTHENTICATION */}
                            {manualRequiresAuth && (
                              <div className="p-4 rounded-xl bg-amber-950/80 border border-amber-500/50 space-y-3 text-xs text-amber-200 font-sans animate-in fade-in">
                                <div className="flex items-start gap-2.5">
                                  <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-amber-300">
                                      Reader Sign In Required
                                    </p>
                                    <p className="mt-1 leading-relaxed text-amber-200/90">
                                      {manualSuccess || 'Sign in before claiming writer-granted access. A successful first claim permanently binds the grant to that reader account.'}
                                    </p>
                                  </div>
                                </div>

                                {onOpenAuth && (
                                  <div className="pt-2 border-t border-amber-800/40 flex items-center gap-2 font-mono">
                                    <button
                                      type="button"
                                      onClick={() => onOpenAuth('signin')}
                                      className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
                                    >
                                      <Lock className="w-3 h-3" />
                                      <span>Sign In to Claim</span>
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* 2. SUCCESS BANNER */}
                            {manualSuccess && !manualRequiresAuth && (
                              <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/50 flex items-start gap-2.5 text-xs text-emerald-200 font-sans animate-in fade-in">
                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                <div className="space-y-1">
                                  <p className="font-semibold text-emerald-300">
                                    Access Bound to Your Account
                                  </p>
                                  <p>{manualSuccess}</p>
                                </div>
                              </div>
                            )}

                            {/* 3. ALREADY ACTIVATED / ANTI-SHARING ERROR BANNER */}
                            {manualError && manualAlreadyActivated && (
                              <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/50 space-y-3 text-xs text-rose-200 font-sans animate-in fade-in">
                                <div className="flex items-start gap-2.5">
                                  <Shield className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-rose-300">
                                      Phone Already Bound
                                    </p>
                                    <p className="mt-1 leading-relaxed text-rose-200/90">{manualError}</p>
                                  </div>
                                </div>

                                <div className="pt-2 border-t border-rose-800/40 flex flex-wrap items-center gap-2 font-mono">
                                  {onOpenAuth && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenAuth('signin')}
                                      className="px-3.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-sm"
                                    >
                                      <Lock className="w-3 h-3" />
                                      <span>Sign In to Original Account</span>
                                    </button>
                                  )}

                                  {onOpenSupport && (
                                    <button
                                      type="button"
                                      onClick={onOpenSupport}
                                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] flex items-center gap-1.5 cursor-pointer border border-slate-700"
                                    >
                                      <LifeBuoy className="w-3 h-3 text-cyan-400" />
                                      <span>Contact Support Desk</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* 4. GENERAL ERROR BANNER WITH CTAs */}
                            {manualError && !manualAlreadyActivated && (
                              <div className="p-4 rounded-xl bg-rose-950/80 border border-rose-500/50 space-y-3 text-xs text-rose-200 font-sans animate-in fade-in">
                                <div className="flex items-start gap-2.5">
                                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-rose-300">
                                      Access Not Found
                                    </p>
                                    <p className="mt-0.5">{manualError}</p>
                                  </div>
                                </div>

                                <div className="pt-2 border-t border-rose-800/40 flex flex-wrap items-center gap-2 font-mono">
                                  <button
                                    type="button"
                                    onClick={() => onUnlockRequest(article)}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] flex items-center gap-1.5 cursor-pointer shadow-sm"
                                  >
                                    <Smartphone className="w-3 h-3" />
                                    <span>Pay to Unlock (KES {article.priceKes})</span>
                                  </button>

                                  {onOpenSupport && (
                                    <button
                                      type="button"
                                      onClick={onOpenSupport}
                                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-cyan-300 text-[11px] flex items-center gap-1.5 cursor-pointer border border-slate-700"
                                    >
                                      <LifeBuoy className="w-3 h-3 text-cyan-400" />
                                      <span>Contact Support Desk</span>
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </form>
                        </div>
                      )}
                    </div>
                  )}

                  {/* VIEW B: SYNOPSIS TAB */}
                  {lockedTab === 'synopsis' && (
                    <div className="space-y-6 animate-in fade-in duration-200">
                      <div className="p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-indigo-950/40 via-slate-900 to-slate-950 border border-indigo-500/30 space-y-6">
                        
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-indigo-400 text-xs font-mono font-semibold uppercase tracking-wider">
                            <BookOpen className="w-4 h-4" />
                            <span>Story Synopsis &amp; Thematic Overview</span>
                          </div>
                          <span className="text-[11px] font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-950 border border-slate-800">
                            {article.showReadTime !== false ? `~${article.readTimeMinutes} min read • ` : ''}{article.category}
                          </span>
                        </div>

                        {/* Synopsis Narrative Content */}
                        <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800/80 space-y-3">
                          <h4 className="font-display font-bold text-base sm:text-lg text-white">
                            What this piece explores
                          </h4>
                          <p className="text-slate-200 font-sans text-sm sm:text-base leading-relaxed">
                            {article.synopsis || `In "${article.title}", Jake deconstructs the philosophical tension between institutional systems and personal conviction. Drawing from contemporary geopolitical realities and strategic history, this monograph examines the silent trade-offs behind modern decision-making without giving away its pivotal narrative revelations.`}
                          </p>
                        </div>

                        {/* Thematic Highlights */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
                          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                            <span className="text-slate-500 block text-[10px] uppercase">Category</span>
                            <span className="text-sky-300 font-semibold">{article.category}</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                            <span className="text-slate-500 block text-[10px] uppercase">Format</span>
                            <span className="text-indigo-300 font-semibold">Protected Online Reader</span>
                          </div>
                          <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
                            <span className="text-slate-500 block text-[10px] uppercase">Investment</span>
                            <span className="text-emerald-400 font-semibold font-mono">KSh {article.priceKes}</span>
                          </div>
                        </div>

                        {/* Immediate Unlock Callout */}
                        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-slate-800/80">
                          <div className="text-left">
                            <p className="text-xs font-mono text-slate-300">Ready to delve into the full work?</p>
                            <p className="text-[11px] text-slate-500">Instant confirmation via M-Pesa or Bank.</p>
                          </div>

                          <div className="flex items-center gap-2.5 w-full sm:w-auto">
                            <button
                              onClick={() => handleTabClick('preview')}
                              className="flex-1 sm:flex-initial px-4 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono border border-slate-700 transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5 text-sky-400" />
                              <span>View Preview</span>
                            </button>

                            <button
                              onClick={() => onUnlockRequest(article)}
                              className="flex-1 sm:flex-initial px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono font-bold text-xs transition-all shadow-lg shadow-emerald-950/80 flex items-center justify-center gap-2 cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5 text-emerald-200" />
                              <span>Unlock Piece — KSh {article.priceKes}</span>
                            </button>
                          </div>
                        </div>

                      </div>
                    </div>
                  )}

                </div>
              )}
            </div>
          </div>

          {/* Clean Dedicated "Tip the Author" Section (User Requirement 2) */}
          {onTipAuthor && (
            <div className="my-8 p-5 sm:p-6 rounded-2xl bg-gradient-to-r from-slate-900/90 via-[#131a2b] to-slate-900/90 border border-rose-500/30 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center gap-3 text-left">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <Heart className="w-5 h-5 fill-rose-500/20 text-rose-400" />
                </div>
                <div>
                  <p className="text-xs font-mono text-rose-300 font-semibold uppercase tracking-wider">Enjoyed this piece?</p>
                  <p className="text-xs sm:text-sm text-slate-300 font-sans mt-0.5">Support Jake's independent writing with a tip (Till 1618656 / Multi-currency).</p>
                </div>
              </div>

              <button
                id="reader-main-tip-btn"
                onClick={() => onTipAuthor(article)}
                className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs font-mono tracking-wider shadow-lg shadow-rose-950/60 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
              >
                <Heart className="w-4 h-4 fill-white" />
                <span>Tip the Author</span>
              </button>
            </div>
          )}

          {/* DEDICATED PRE-POPULATED QUOTE & SHARE CARD */}
          <div className="my-10 p-6 sm:p-8 rounded-3xl bg-gradient-to-br from-slate-900 via-[#101728] to-slate-950 border border-sky-500/30 shadow-2xl space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-sky-950/80 border border-sky-800/80 text-sky-400 font-mono text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3 text-sky-400" />
                  <span>Share Monograph &amp; Quote</span>
                </span>
                <span className="text-xs text-slate-400 font-mono hidden sm:inline">
                  Pre-populated citation for X &amp; WhatsApp
                </span>
              </div>

              {/* Quote Switcher (if multiple quotes available) */}
              {quotes.length > 1 && (
                <div className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs font-mono text-slate-300">
                  <span className="text-slate-500 text-[11px]">Quote {activeQuoteIndex + 1} of {quotes.length}</span>
                  <button
                    onClick={() => setActiveQuoteIndex((prev) => (prev > 0 ? prev - 1 : quotes.length - 1))}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Previous Quote"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setActiveQuoteIndex((prev) => (prev < quotes.length - 1 ? prev + 1 : 0))}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    title="Next Quote"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {effectiveUnlocked && article.behindThePiece?.enabled && (
              <section className="rounded-3xl border border-amber-500/25 bg-gradient-to-br from-amber-950/25 via-slate-950 to-slate-900 p-5 sm:p-7" aria-labelledby="behind-piece-title">
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-400">Writer&apos;s Notes</p>
                <h3 id="behind-piece-title" className="mt-1 font-display text-xl font-bold text-white">Behind the Piece</h3>
                {article.behindThePiece.inspiration && (
                  <p className="mt-4 border-l-2 border-amber-500/50 pl-4 font-serif italic leading-relaxed text-slate-300">
                    {article.behindThePiece.inspiration}
                  </p>
                )}
                {article.behindThePiece.note && (
                  <div className="mt-5 text-sm leading-relaxed text-slate-200">
                    <SafeMarkdown markdown={article.behindThePiece.note} variant="reader" />
                  </div>
                )}
                {(article.behindThePiece.songTitle || article.behindThePiece.songUrl) && (
                  <a
                    href={article.behindThePiece.songUrl || undefined}
                    target={article.behindThePiece.songUrl ? '_blank' : undefined}
                    rel={article.behindThePiece.songUrl ? 'noopener noreferrer' : undefined}
                    className="mt-5 inline-flex items-center gap-3 rounded-2xl border border-amber-700/50 bg-slate-950/70 px-4 py-3 text-sm text-amber-200"
                  >
                    <Music2 className="h-4 w-4 text-amber-400" />
                    <span>
                      <span className="block font-semibold">{article.behindThePiece.songTitle || 'Associated song'}</span>
                      {article.behindThePiece.songArtist && <span className="block text-xs text-slate-400">{article.behindThePiece.songArtist}</span>}
                    </span>
                    {article.behindThePiece.songUrl && <ExternalLink className="h-3.5 w-3.5" />}
                  </a>
                )}
              </section>
            )}

            {/* Featured Quote Box */}
            <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800/90 relative">
              <Quote className="w-8 h-8 text-sky-500/20 absolute top-4 left-4 pointer-events-none" />
              <blockquote className="font-serif italic text-slate-200 text-lg sm:text-xl leading-relaxed relative z-10 pl-2">
                “{currentQuote}”
              </blockquote>
              <div className="mt-3 pt-3 border-t border-slate-900 flex items-center justify-between text-xs font-mono text-slate-400">
                <span className="text-sky-400 font-medium">Jake (@its_bigboy_jake) • {article.title}</span>
                <span className="text-slate-500 truncate max-w-[200px] hidden sm:inline">{article.category}</span>
              </div>
            </div>

            {/* Primary High-Impact Share Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              
              {/* 1. Share to X (Twitter) */}
              <button
                id="btn-share-monograph-x"
                onClick={() => handleShareToX()}
                className="py-3.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-900 text-white font-mono text-xs font-bold border border-sky-500/40 hover:border-sky-400 transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-sky-950/40 cursor-pointer group"
              >
                <Twitter className="w-4 h-4 text-sky-400 group-hover:scale-110 transition-transform" />
                <span>Share Quote on X</span>
              </button>

              {/* 2. Share to WhatsApp */}
              <button
                id="btn-share-monograph-whatsapp"
                onClick={() => handleShareToWhatsApp()}
                className="py-3.5 px-4 rounded-xl bg-emerald-950/80 hover:bg-emerald-900/90 text-emerald-300 font-mono text-xs font-bold border border-emerald-500/40 hover:border-emerald-400 transition-all flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-950/40 cursor-pointer group"
              >
                <MessageCircle className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
                <span>Share on WhatsApp</span>
              </button>

              {/* 3. Copy Quote & Monograph Link */}
              <button
                id="btn-copy-quote-and-link"
                onClick={() => handleCopyQuoteAndLink()}
                className="py-3.5 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 font-mono text-xs font-medium border border-slate-700 hover:border-slate-600 transition-all flex items-center justify-center gap-2.5 cursor-pointer"
              >
                {copiedQuote ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4 text-slate-400" />}
                <span>{copiedQuote ? 'Copied to Clipboard!' : 'Copy Quote & Link'}</span>
              </button>

            </div>
          </div>

          <section className="my-10 space-y-5 rounded-3xl border border-slate-700/80 bg-slate-900/70 p-5 sm:p-7" aria-labelledby="reader-response-title">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-400">Reader response</p>
                <h4 id="reader-response-title" className="mt-1 font-display text-xl font-bold text-white">What this piece left behind</h4>
              </div>
              <button
                type="button"
                onClick={() => void handleFollowWork()}
                disabled={followSaving}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-sky-700 bg-sky-950/70 px-4 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/70 disabled:opacity-60"
              >
                <Bell className="h-4 w-4" />
                <span>{followSaving ? 'Saving…' : 'Notify Me About Updates'}</span>
              </button>
            </div>

            {socialProof && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['Purchased', socialProof.purchaseCount],
                  ['Views', socialProof.viewCount],
                  ['Completed reads', socialProof.completedReadCount],
                  ['Verified reviews', socialProof.verifiedReviewCount]
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
                    <p className="font-display text-xl font-bold text-white">{Number(value).toLocaleString()}</p>
                    <p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{String(label)}</p>
                  </div>
                ))}
              </div>
            )}

            {effectiveUnlocked && (
              <div>
                <p className="mb-2 text-xs text-slate-400">React privately. Only totals are public.</p>
                <div className="flex flex-wrap gap-2">
                  {REACTION_LABELS.map(item => (
                    <button
                      key={item.type}
                      type="button"
                      disabled={reactionSaving}
                      onClick={() => void handleReaction(item.type)}
                      aria-pressed={socialProof?.currentReaction === item.type}
                      className={`rounded-full border px-3 py-1.5 text-xs transition-colors disabled:opacity-60 ${
                        socialProof?.currentReaction === item.type
                          ? 'border-sky-500 bg-sky-950 text-sky-200'
                          : 'border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-700'
                      }`}
                    >
                      {item.label} <span className="ml-1 font-mono text-slate-500">{socialProof?.reactionCounts[item.type] || 0}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {socialProof && socialProof.verifiedReviewCount > 0 && (
              <div className="space-y-3 border-t border-slate-800 pt-5">
                <div className="flex items-center gap-2 text-sm text-amber-300">
                  <Star className="h-4 w-4 fill-amber-400" />
                  <span className="font-bold">{socialProof.averageRating.toFixed(1)} / 5</span>
                  <span className="text-xs text-slate-500">from verified readers</span>
                </div>
                {socialProof.testimonials.length > 0 && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {socialProof.testimonials.map(testimonial => (
                      <blockquote key={testimonial.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="mb-2 text-xs text-amber-400">{'★'.repeat(testimonial.rating)}{'☆'.repeat(5 - testimonial.rating)}</div>
                        <p className="font-serif text-sm italic leading-relaxed text-slate-200">“{testimonial.review}”</p>
                        <footer className="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-400">Verified reader</footer>
                      </blockquote>
                    ))}
                  </div>
                )}
              </div>
            )}

            {effectiveUnlocked && currentUser?.role === 'client' && (
              <form onSubmit={handleReviewSubmit} className="space-y-3 border-t border-slate-800 pt-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-white">Leave a verified review</p>
                    <p className="text-[11px] text-slate-500">Available after 80% reading progress. The writer decides which written testimonials appear publicly.</p>
                  </div>
                  <label className="flex items-center gap-2 text-xs text-slate-400">
                    Rating
                    <select value={reviewRating} onChange={event => setReviewRating(Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-amber-300">
                      {[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} / 5</option>)}
                    </select>
                  </label>
                </div>
                <textarea
                  value={reviewText}
                  onChange={event => setReviewText(event.target.value)}
                  minLength={10}
                  maxLength={2000}
                  rows={3}
                  placeholder={readingProgress && (readingProgress.furthestPercent ?? readingProgress.percent) >= 80 ? 'Share what stayed with you…' : 'Continue reading to 80% to leave a review.'}
                  disabled={!readingProgress || (readingProgress.furthestPercent ?? readingProgress.percent) < 80 || reviewSaving}
                  className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-slate-400" role="status">{reviewNotice}</p>
                  <button type="submit" disabled={reviewSaving || reviewText.trim().length < 10 || !readingProgress || (readingProgress.furthestPercent ?? readingProgress.percent) < 80} className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
                    {reviewSaving ? 'Saving…' : 'Submit Review'}
                  </button>
                </div>
              </form>
            )}

            {socialLoading && <p className="text-xs text-slate-500">Loading reader responses…</p>}
          </section>

          {effectiveUnlocked && onReadArticle && readerRecommendations.length > 0 && (
            <section
              id="reader-more-pieces"
              aria-labelledby="reader-more-pieces-title"
              className="my-10 rounded-3xl border border-sky-500/25 bg-gradient-to-b from-slate-900/90 to-[#0a1220] p-5 sm:p-7 shadow-2xl"
            >
              <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">
                    Continue through Ink &amp; Witness
                  </p>
                  <h4 id="reader-more-pieces-title" className="mt-1 font-display text-xl font-bold text-white sm:text-2xl">
                    Choose your next piece
                  </h4>
                </div>
                <p className="max-w-md text-xs leading-relaxed text-slate-400 sm:text-right">
                  Explore another published piece. Free pieces open immediately; paid pieces remain available to preview and unlock securely.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {readerRecommendations.map(recommendation => (
                  <ArticleCard
                    key={recommendation.id}
                    article={recommendation}
                    isUnlocked={isArticleUnlocked
                      ? isArticleUnlocked(recommendation)
                      : recommendation.isPaid === false || recommendation.isUnlocked === true}
                    onRead={onReadArticle}
                    onUnlock={onUnlockRequest}
                    onSelectTag={onSelectTag}
                    onTipAuthor={onTipAuthor}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Author Footer Card */}
          <footer className="border-t border-slate-800 pt-8 mt-12 bg-slate-900/50 p-6 rounded-2xl space-y-4">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h5 className="font-display font-bold text-base text-white">
                  Ink &amp; Witness • Written by Jake
                </h5>
                <p className="text-xs text-slate-400 mt-1">
                  Follow <span className="text-sky-400 font-mono">@its_bigboy_jake</span> on Instagram for daily insights &amp; upcoming releases.
                </p>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {onTipAuthor && (
                  <button
                    id="reader-footer-tip-btn"
                    onClick={() => onTipAuthor(article)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs font-mono transition-all shadow-md shadow-rose-950/60 cursor-pointer"
                  >
                    <Heart className="w-4 h-4 fill-white" />
                    <span>Tip Author via M-Pesa (Till 1618656)</span>
                  </button>
                )}

                <a
                  href="https://www.instagram.com/its_bigboy_jake/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-sky-950 hover:bg-sky-900 border border-sky-800 text-xs font-semibold text-sky-300 transition-colors"
                >
                  <Instagram className="w-4 h-4 text-sky-400" />
                  <span>@its_bigboy_jake</span>
                </a>
              </div>
            </div>
          </footer>

        </div>

      </div>
    </div>
  );
};


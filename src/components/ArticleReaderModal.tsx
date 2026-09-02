import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  Shield
} from 'lucide-react';
import { Article, AuthorProfile, User } from '../types.js';
import { api, getArticleReceipt } from '../utils/api.js';

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
}

interface SpeechChunk {
  id: string;
  type: 'intro' | 'header' | 'quote' | 'paragraph' | 'outro';
  label: string;
  text: string;
  rawIndex?: number;
}

// Clean markdown symbols for natural speech synthesis
function cleanMarkdownForSpeech(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '') // headings
    .replace(/\*\*(.*?)\*\*/g, '$1') // bold
    .replace(/\*(.*?)\*/g, '$1') // italic
    .replace(/`(.*?)`/g, '$1') // inline code
    .replace(/```[\s\S]*?```/g, '') // code blocks
    .replace(/^>\s*/gm, '') // blockquotes
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // links
    .replace(/^[-*+]\s+/gm, '') // bullets
    .replace(/^\d+\.\s+/gm, '') // numbered lists
    .replace(/---+/g, '') // horizontal rules
    .trim();
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
  onTabChange
}) => {
  const [copiedQuote, setCopiedQuote] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [activeQuoteIndex, setActiveQuoteIndex] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [fontSizeClass, setFontSizeClass] = useState<'text-base' | 'text-lg' | 'text-xl'>('text-lg');
  const [lockedTab, setLockedTab] = useState<'preview' | 'synopsis'>(activeTab || 'preview');

  const [manualPhone, setManualPhone] = useState('');
  const [manualVerifying, setManualVerifying] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);
  const [manualAlreadyActivated, setManualAlreadyActivated] = useState(false);
  const [manualRequiresAuth, setManualRequiresAuth] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);
  const [isLocallyUnlocked, setIsLocallyUnlocked] = useState(false);

  const effectiveUnlocked = isUnlocked || isLocallyUnlocked;

  useEffect(() => {
    setIsLocallyUnlocked(false);
    setManualAlreadyActivated(false);
    setManualRequiresAuth(false);
    setManualError(null);
    setManualSuccess(null);
  }, [article?.id]);

  const handleVerifyManualAccess = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!article) return;
    const cleanPhone = manualPhone.trim();
    if (!cleanPhone) {
      setManualError('Please enter your phone number to verify access.');
      return;
    }

    setManualVerifying(true);
    setManualError(null);
    setManualSuccess(null);
    setManualAlreadyActivated(false);
    setManualRequiresAuth(false);

    try {
      const res = await api.verifyManualAccess(article.id, cleanPhone);
      if (res.requiresAuth) {
        setManualRequiresAuth(true);
        setManualError(null);
        setManualSuccess(res.message || 'Authorization confirmed! Please sign in or register to permanently bind this piece to your reader account.');
        return;
      }
      if (res.verified) {
        setIsLocallyUnlocked(true);
        setManualRequiresAuth(false);
        setManualAlreadyActivated(false);
        setManualSuccess(res.message || 'Access confirmed & bound. You have full access to read this piece.');
        if (onAccessUnlocked) {
          onAccessUnlocked(article.id);
        }
      } else {
        setManualError(res.message || 'No manual access was found for this phone number. If you believe this is an error, please contact the Support Desk.');
      }
    } catch (err: any) {
      if (err.alreadyActivated || err.message?.toLowerCase().includes('already activated') || err.message?.toLowerCase().includes('access already activated')) {
        setManualAlreadyActivated(true);
        setManualRequiresAuth(false);
        setManualError(err.message || 'This phone number has already been activated on another reader session. To prevent unauthorized sharing, granted access can only be activated once. Please sign in to the original account or contact Support.');
      } else if (err.requiresAuth) {
        setManualRequiresAuth(true);
        setManualError(null);
        setManualSuccess(err.message || 'Authorization confirmed! Please sign in or register to bind this piece to your account.');
      } else {
        setManualAlreadyActivated(false);
        setManualRequiresAuth(false);
        setManualError(err.message || 'No manual access was found for this phone number. If you believe this is an error, please contact the Support Desk.');
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
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [autoScroll, setAutoScroll] = useState(true);
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState<string>('');

  const currentChunkIndexRef = useRef(currentChunkIndex);
  currentChunkIndexRef.current = currentChunkIndex;

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

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

    // 1. Introduction Chunk
    const introText = `${article.title}. ${article.subtitle ? article.subtitle + '.' : ''} Curated and authored by ${authorName}. Category: ${article.category}. Estimated reading time: ${article.readTimeMinutes} minutes.`;
    chunks.push({
      id: 'intro',
      type: 'intro',
      label: 'Title & Monograph Introduction',
      text: introText
    });

    if (effectiveUnlocked && article.content) {
      const rawParagraphs = article.content.split('\n\n');
      rawParagraphs.forEach((para, idx) => {
        const trimmed = para.trim();
        if (!trimmed || trimmed.startsWith('---')) return;

        if (trimmed.startsWith('# ') || trimmed.startsWith('## ') || trimmed.startsWith('### ')) {
          const cleanHeading = cleanMarkdownForSpeech(trimmed);
          chunks.push({
            id: `para-${idx}`,
            type: 'header',
            label: `Section: ${cleanHeading.slice(0, 30)}...`,
            text: `Section: ${cleanHeading}`,
            rawIndex: idx
          });
        } else if (trimmed.startsWith('>')) {
          const cleanQuote = cleanMarkdownForSpeech(trimmed);
          chunks.push({
            id: `para-${idx}`,
            type: 'quote',
            label: `Key Quote: ${cleanQuote.slice(0, 30)}...`,
            text: `Quote: ${cleanQuote}`,
            rawIndex: idx
          });
        } else {
          const cleanText = cleanMarkdownForSpeech(trimmed);
          if (cleanText.length > 5) {
            chunks.push({
              id: `para-${idx}`,
              type: 'paragraph',
              label: `Paragraph ${idx + 1}`,
              text: cleanText,
              rawIndex: idx
            });
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

  // Initialize Speech Synthesis Voices
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const voices = window.speechSynthesis.getVoices();
      const englishVoices = voices.filter(v => v.lang.startsWith('en'));
      const list = englishVoices.length > 0 ? englishVoices : voices;
      setAvailableVoices(list);

      if (list.length > 0 && !selectedVoiceURIRef.current) {
        const preferred = list.find(v => 
          /google|natural|samantha|daniel|arthur|guy|george|serena/i.test(v.name)
        ) || list[0];
        setSelectedVoiceURI(preferred.voiceURI);
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
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [article?.id, isOpen]);

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

    window.speechSynthesis.cancel();

    const chunk = chunks[chunkIndex];
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    
    const currentRate = rate !== undefined ? rate : playbackRateRef.current;
    utterance.rate = currentRate;
    utterance.pitch = 1.0;

    // Apply chosen voice
    const currentVoiceURI = voiceURI !== undefined ? voiceURI : selectedVoiceURIRef.current;
    if (currentVoiceURI) {
      const voice = window.speechSynthesis.getVoices().find(v => v.voiceURI === currentVoiceURI);
      if (voice) utterance.voice = voice;
    }

    utterance.onstart = () => {
      setIsPlaying(true);
      setCurrentChunkIndex(chunkIndex);

      // Auto-scroll to current paragraph if enabled
      if (autoScrollRef.current && chunk.rawIndex !== undefined) {
        setTimeout(() => {
          const elem = document.getElementById(`reader-para-${chunk.rawIndex}`);
          if (elem) {
            elem.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 80);
      }
    };

    utterance.onend = () => {
      if (!isPlayingRef.current) return;

      if (chunkIndex + 1 < audioChunksRef.current.length) {
        const nextIndex = chunkIndex + 1;
        setCurrentChunkIndex(nextIndex);
        speakChunk(nextIndex);
      } else {
        setIsPlaying(false);
        showToast('Monograph audio narration complete.');
      }
    };

    utterance.onerror = (e) => {
      if (e.error === 'canceled' || e.error === 'interrupted') return;
      console.warn('SpeechSynthesis error:', e);
      setIsPlaying(false);
    };

    window.speechSynthesis.speak(utterance);
  };

  // User Actions for Audio Playback
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
      if (isPlaying) {
        window.speechSynthesis.cancel();
        setIsPlaying(false);
      } else {
        speakChunk(currentChunkIndex);
      }
    }
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
    } else {
      speakChunk(currentChunkIndex);
    }
  };

  const handleNextChunk = () => {
    if (currentChunkIndex + 1 < audioChunks.length) {
      const next = currentChunkIndex + 1;
      setCurrentChunkIndex(next);
      if (isPlaying || isAudioActive) {
        speakChunk(next);
      }
    }
  };

  const handlePrevChunk = () => {
    if (currentChunkIndex > 0) {
      const prev = currentChunkIndex - 1;
      setCurrentChunkIndex(prev);
      if (isPlaying || isAudioActive) {
        speakChunk(prev);
      }
    }
  };

  const handleStopAudio = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
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
    }
  };

  const handleVoiceChange = (voiceURI: string) => {
    setSelectedVoiceURI(voiceURI);
    if (isPlaying) {
      speakChunk(currentChunkIndex, playbackRate, voiceURI);
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

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

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
                >
                  <SkipBack className="w-3.5 h-3.5" />
                </button>

                <button
                  id="audio-play-pause-btn"
                  onClick={handlePlayPause}
                  className="p-2 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-all shadow-md shadow-amber-500/30 cursor-pointer flex items-center justify-center"
                  title={isPlaying ? 'Pause Audio' : 'Resume Audio'}
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>

                <button
                  id="audio-next-chunk-btn"
                  onClick={handleNextChunk}
                  disabled={currentChunkIndex >= audioChunks.length - 1}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-40 disabled:hover:bg-slate-900 text-slate-300 transition-colors cursor-pointer"
                  title="Next Paragraph / Section"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>

                <button
                  id="audio-stop-btn"
                  onClick={handleStopAudio}
                  className="p-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Reset Narration to Beginning"
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
                {[1.0, 1.25, 1.5, 2.0].map((rate) => (
                  <button
                    key={rate}
                    onClick={() => handleSpeedChange(rate)}
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
                  title="Select Voice"
                >
                  {availableVoices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI}>
                      {v.name.replace(/(Microsoft|Google|Apple|Desktop)\s*/i, '').slice(0, 16)} ({v.lang})
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
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Reader Body */}
        <div id="article-reader-scroll" className="overflow-y-auto px-6 sm:px-12 py-8 flex-1 space-y-8">
          
          {/* Header Title Section */}
          <header className="border-b border-slate-800/80 pb-8 space-y-4">
            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" />
                Published {article.publishedAt}
              </span>
              <span>•</span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {article.readTimeMinutes} min read
              </span>
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
                    const trimmed = paragraph.trim();
                    if (!trimmed) return null;
                    const isParagraphActive = isAudioActive && activeChunk?.rawIndex === index;

                    // Heading 1 (#)
                    if (trimmed.startsWith('# ')) {
                      return (
                        <h2 
                          id={`reader-para-${index}`}
                          key={index} 
                          className={`font-display text-2xl sm:text-3xl font-bold text-white mt-8 mb-4 border-b border-slate-800 pb-2 transition-all duration-300 ${
                            isParagraphActive ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''
                          }`}
                        >
                          {trimmed.replace(/^#\s+/, '')}
                        </h2>
                      );
                    }
                    // Heading 2 (##)
                    if (trimmed.startsWith('## ')) {
                      return (
                        <h3 
                          id={`reader-para-${index}`}
                          key={index} 
                          className={`font-display text-xl sm:text-2xl font-bold text-sky-300 mt-7 mb-3 transition-all duration-300 ${
                            isParagraphActive ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''
                          }`}
                        >
                          {trimmed.replace(/^##\s+/, '')}
                        </h3>
                      );
                    }
                    // Heading 3 (###)
                    if (trimmed.startsWith('### ')) {
                      return (
                        <h4 
                          id={`reader-para-${index}`}
                          key={index} 
                          className={`font-display text-lg font-bold text-slate-200 mt-5 mb-2 transition-all duration-300 ${
                            isParagraphActive ? 'text-amber-300 pl-2 border-l-4 border-amber-500' : ''
                          }`}
                        >
                          {trimmed.replace(/^###\s+/, '')}
                        </h4>
                      );
                    }
                    // Blockquote (>) with interactive Quote & Share buttons
                    if (trimmed.startsWith('>')) {
                      const quoteContent = trimmed.replace(/^>\s*/, '');
                      return (
                        <div 
                          id={`reader-para-${index}`}
                          key={index} 
                          className={`group relative my-6 rounded-2xl bg-gradient-to-r from-slate-900/90 via-slate-900/60 to-slate-950/80 border-l-4 p-5 sm:p-6 shadow-md transition-all duration-300 ${
                            isParagraphActive ? 'border-amber-500 ring-1 ring-amber-500/40' : 'border-sky-500'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <Quote className={`w-6 h-6 shrink-0 mt-1 opacity-70 ${isParagraphActive ? 'text-amber-400' : 'text-sky-500'}`} />
                            <blockquote className="font-serif italic text-slate-200 text-lg sm:text-xl leading-relaxed flex-1">
                              {quoteContent}
                            </blockquote>
                          </div>
                          <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2 text-xs font-mono">
                            <span className="text-slate-400">Jake • {article.title}</span>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleShareToX(quoteContent)}
                                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-sky-400 border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                                title="Share this specific quote to X (Twitter)"
                              >
                                <Twitter className="w-3 h-3" />
                                <span>Quote on X</span>
                              </button>
                              <button
                                onClick={() => handleShareToWhatsApp(quoteContent)}
                                className="px-2.5 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-emerald-400 border border-slate-800 flex items-center gap-1.5 transition-colors cursor-pointer"
                                title="Share this specific quote to WhatsApp"
                              >
                                <MessageCircle className="w-3 h-3" />
                                <span>WhatsApp</span>
                              </button>
                              <button
                                onClick={() => handleCopyQuoteAndLink(quoteContent)}
                                className="p-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 transition-colors cursor-pointer"
                                title="Copy quote and monograph link"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    }
                    // Divider
                    if (trimmed.startsWith('---')) {
                      return <hr key={index} className="my-8 border-slate-800" />;
                    }

                    // Bullet points
                    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
                      const items = trimmed.split('\n');
                      return (
                        <ul 
                          id={`reader-para-${index}`}
                          key={index} 
                          className={`space-y-2 my-4 pl-5 list-disc marker:text-sky-400 transition-all duration-300 ${
                            isParagraphActive ? 'bg-amber-950/20 p-3 rounded-xl border-l-2 border-amber-500' : ''
                          }`}
                        >
                          {items.map((item, itemIdx) => (
                            <li key={itemIdx} className="leading-relaxed">
                              {item.replace(/^[-*\d.]+\s+/, '')}
                            </li>
                          ))}
                        </ul>
                      );
                    }

                    return (
                      <p 
                        id={`reader-para-${index}`}
                        key={index} 
                        className={`leading-relaxed transition-all duration-300 ${
                          isParagraphActive 
                            ? 'bg-amber-950/25 p-3.5 rounded-2xl border-l-4 border-amber-400 text-white shadow-md' 
                            : 'text-slate-200'
                        }`}
                      >
                        {trimmed}
                      </p>
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
                                  setShowManualForm(!showManualForm);
                                  setManualError(null);
                                  setManualSuccess(null);
                                }}
                                className="text-sky-400 hover:text-sky-300 transition-colors inline-flex items-center gap-1 cursor-pointer"
                              >
                                <KeyRound className="w-3 h-3" />
                                <span>{showManualForm ? 'Hide Claim Access Form' : 'Already paid or granted manual access? Restore or Claim'}</span>
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

                      {/* MANUAL SELF-UNLOCK & AUTHOR-GRANTED ACCESS CARD (SECONDARY RECOVERY) */}
                      {showManualForm && (
                      <div className="p-6 rounded-2xl bg-slate-900/90 border border-sky-500/30 text-left space-y-4 animate-in fade-in">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 text-sky-400 font-mono text-xs font-semibold uppercase tracking-wider">
                            <KeyRound className="w-4 h-4" />
                            <span>Granted Access / Restore Access</span>
                          </div>
                        </div>

                        <p className="text-xs text-slate-300 font-sans leading-relaxed">
                          If Jake has personally authorized access for your phone number or you previously purchased this monograph, enter your phone number below to verify and claim reading access.
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
                                  placeholder="Phone number (e.g. 0712345678 or 2547...)"
                                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-slate-100 text-xs font-mono placeholder:text-slate-500 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500"
                                />
                              </div>

                              <button
                                type="submit"
                                id="btn-verify-manual-access"
                                disabled={manualVerifying || !manualPhone.trim()}
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

                            {/* 1. SINGLE-SESSION BINDING REQUIRED BANNER */}
                            {manualRequiresAuth && (
                              <div className="p-4 rounded-xl bg-amber-950/80 border border-amber-500/50 space-y-3 text-xs text-amber-200 font-sans animate-in fade-in">
                                <div className="flex items-start gap-2.5">
                                  <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                                  <div>
                                    <p className="font-semibold text-amber-300">
                                      Authorization Found — Reader Sign In Required
                                    </p>
                                    <p className="mt-1 leading-relaxed text-amber-200/90">
                                      {manualSuccess || 'This phone number has been granted access. To complete one-time activation and bind this piece to your library, please sign in.'}
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
                                      <span>Sign In to Activate</span>
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
                                    Access Confirmed &amp; Activated
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
                                      Access Already Activated
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
                                      <span>Sign In to Bound Account</span>
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
                            ~{article.readTimeMinutes} min read • {article.category}
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


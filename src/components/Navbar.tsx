import React, { useState, useEffect } from 'react';
import { 
  BookOpen, 
  Menu, 
  X, 
  Heart,
  BookmarkCheck,
  Smartphone,
  Feather,
  Info,
  LifeBuoy,
  HelpCircle,
  Share2,
  Lock,
  User as UserIcon,
  LogOut,
  ShieldCheck
} from 'lucide-react';
import { AuthorProfile, User } from '../types.js';
import { getStoredTokens } from '../utils/api.js';

export type PublicViewType = 'home' | 'all-pieces' | 'about' | 'how-to-pay';

interface NavbarProps {
  author: AuthorProfile | null;
  currentUser?: User | null;
  currentView: PublicViewType | string;
  onNavigate: (view: PublicViewType) => void;
  onOpenLibrary?: () => void;
  onOpenSupport?: () => void;
  onOpenAffiliates?: () => void;
  onOpenSignIn?: () => void;
  onOpenWriterStudio?: () => void;
  onLogout?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  author,
  currentUser,
  currentView,
  onNavigate,
  onOpenLibrary,
  onOpenSupport,
  onOpenAffiliates,
  onOpenSignIn,
  onOpenWriterStudio,
  onLogout
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unlockedCount, setUnlockedCount] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const checkTokens = () => {
      const tokens = getStoredTokens();
      setUnlockedCount(Object.keys(tokens).length);
    };
    checkTokens();
    window.addEventListener('storage', checkTokens);
    
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener('scroll', handleScroll);

    return () => {
      window.removeEventListener('storage', checkTokens);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const navItems: { id: PublicViewType; label: string }[] = [
    { id: 'home', label: 'Home' },
    { id: 'all-pieces', label: 'Explore Pieces' },
    { id: 'about', label: 'About the Author' },
    { id: 'how-to-pay', label: 'How to Read & Pay' },
  ];

  const handleItemClick = (id: PublicViewType) => {
    onNavigate(id);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header 
      id="main-navbar"
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-300 ${
        scrolled 
          ? 'bg-[#070b14]/95 backdrop-blur-md border-b border-slate-800/80 shadow-xl shadow-black/40 py-3.5' 
          : 'bg-[#070b14]/80 backdrop-blur-sm border-b border-slate-800/40 py-4 sm:py-5'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
        
        {/* Brand Logo */}
        <button 
          id="nav-logo-btn"
          onClick={() => handleItemClick('home')}
          className="flex items-center gap-3 group text-left cursor-pointer"
        >
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 overflow-hidden flex items-center justify-center shadow-md group-hover:border-sky-500/50 transition-colors p-0.5">
            {author?.logoUrl ? (
              <img
                src={author.logoUrl}
                alt="Site Logo"
                className="max-w-full max-h-full object-contain"
              />
            ) : author?.avatarUrl ? (
              <img
                src={author.avatarUrl}
                alt={author.name || "Jake"}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="font-display text-sky-400 font-bold text-base sm:text-lg tracking-wider">I&amp;W</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-serif font-bold text-base sm:text-lg tracking-wider text-slate-100 group-hover:text-sky-300 transition-colors">
                INK &amp; WITNESS
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-slate-400 font-sans tracking-wide">
              by <span className="text-slate-300 font-medium">{author?.name || "Jacob Collins Tinga"}</span>
            </p>
          </div>
        </button>

        {/* Desktop Navigation Links */}
        <nav className="hidden lg:flex items-center gap-1 sm:gap-2">
          {navItems.map((item) => {
            const isActive = currentView === item.id;
            return (
              <button 
                key={item.id}
                id={`nav-link-${item.id}`}
                onClick={() => handleItemClick(item.id)}
                className={`text-xs font-mono px-3.5 py-2 rounded-xl transition-all cursor-pointer ${
                  isActive
                    ? 'bg-slate-800/90 text-white font-semibold shadow-sm border border-slate-700/80'
                    : 'text-slate-300 hover:text-white hover:bg-slate-900/60'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Right Action: Support, Library, and Sign In */}
        <div className="hidden lg:flex items-center gap-2.5">
          {onOpenSupport && (
            <button
              id="nav-support-btn"
              onClick={onOpenSupport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-xs font-mono text-cyan-300 hover:text-white transition-all cursor-pointer shadow-sm"
              title="Reader Help & Payment Support"
            >
              <LifeBuoy className="w-3.5 h-3.5 text-cyan-400" />
              <span>Support</span>
            </button>
          )}

          {unlockedCount > 0 && onOpenLibrary && (
            <button
              id="nav-unlocked-library-btn"
              onClick={onOpenLibrary}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-950/70 hover:bg-emerald-900/80 border border-emerald-700/80 text-xs font-mono text-emerald-300 hover:text-white transition-all cursor-pointer shadow-sm"
              title="View my unlocked pieces"
            >
              <BookmarkCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Library ({unlockedCount})</span>
            </button>
          )}

          {currentUser ? (
            <div className="flex items-center gap-1.5 pl-1.5 border-l border-slate-800">
              {currentUser.role === 'admin' && onOpenWriterStudio && (
                <button
                  id="nav-writer-studio-btn"
                  onClick={onOpenWriterStudio}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-950/90 to-indigo-950/90 hover:from-sky-900 hover:to-indigo-900 border border-sky-500/50 text-xs font-mono text-sky-200 hover:text-white transition-all cursor-pointer shadow-md shadow-sky-950/60 font-semibold"
                  title="Open Author Portal & Writer Studio"
                >
                  <Feather className="w-3.5 h-3.5 text-sky-400" />
                  <span>Writer Studio</span>
                </button>
              )}

              <button
                id="nav-user-account-btn"
                onClick={currentUser.role === 'admin' ? (onOpenWriterStudio || onOpenLibrary) : onOpenLibrary}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700 text-xs font-mono text-slate-200 transition-colors cursor-pointer"
                title={`Signed in as ${currentUser.email} • Click to open ${currentUser.role === 'admin' ? 'Writer Studio' : 'Library'}`}
              >
                <div className="w-4 h-4 rounded-full bg-sky-600 text-white flex items-center justify-center text-[10px] font-bold">
                  {currentUser.name ? currentUser.name[0].toUpperCase() : currentUser.email[0].toUpperCase()}
                </div>
                <span className="max-w-[100px] truncate">{currentUser.name || currentUser.email}</span>
                {currentUser.role === 'admin' && (
                  <span className="px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-amber-500/20 text-amber-300 rounded border border-amber-500/40">
                    Admin
                  </span>
                )}
              </button>
              {onLogout && (
                <button
                  id="nav-logout-btn"
                  onClick={onLogout}
                  className="p-1.5 rounded-xl bg-slate-900 hover:bg-rose-950/60 border border-slate-800 hover:border-rose-800 text-slate-400 hover:text-rose-300 transition-colors cursor-pointer"
                  title="Sign Out"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          ) : onOpenSignIn && (
            <button
              id="nav-signin-btn"
              onClick={onOpenSignIn}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-xs font-mono text-white font-medium transition-all cursor-pointer shadow-md shadow-sky-950/50"
            >
              <UserIcon className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>

        {/* Mobile Menu Button & Quick Support Icon */}
        <div className="flex lg:hidden items-center gap-2">
          {onOpenSupport && (
            <button
              id="mobile-nav-support-btn"
              onClick={onOpenSupport}
              className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-cyan-300 hover:text-white text-xs font-mono flex items-center gap-1"
              title="Help & Support"
            >
              <LifeBuoy className="w-4 h-4 text-cyan-400" />
              <span className="hidden sm:inline">Help</span>
            </button>
          )}

          {unlockedCount > 0 && onOpenLibrary && (
            <button
              onClick={onOpenLibrary}
              className="p-2 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs font-mono flex items-center gap-1"
            >
              <BookmarkCheck className="w-4 h-4 text-emerald-400" />
              <span>{unlockedCount}</span>
            </button>
          )}

          <button
            id="mobile-menu-toggle-btn"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 hover:text-white cursor-pointer"
            aria-label="Toggle Menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-[#070b14]/98 border-b border-slate-800 px-4 py-6 space-y-2 shadow-2xl animate-in slide-in-from-top-2">
          <div className="flex flex-col space-y-1 font-mono text-xs">
            {navItems.map((item) => {
              const isActive = currentView === item.id;
              return (
                <button
                  key={item.id}
                  id={`mobile-nav-link-${item.id}`}
                  onClick={() => handleItemClick(item.id)}
                  className={`text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between cursor-pointer ${
                    isActive
                      ? 'bg-sky-600/20 text-sky-300 border border-sky-500/40 font-semibold'
                      : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                  }`}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}

            {onOpenSupport && (
              <button
                id="mobile-drawer-support-btn"
                onClick={() => {
                  onOpenSupport();
                  setMobileMenuOpen(false);
                }}
                className="text-left px-4 py-3 rounded-xl text-cyan-300 bg-cyan-950/40 border border-cyan-800/60 flex items-center gap-2 mt-2 cursor-pointer font-semibold"
              >
                <LifeBuoy className="w-4 h-4 text-cyan-400" />
                <span>Reader Support &amp; Help Desk</span>
              </button>
            )}

            {unlockedCount > 0 && onOpenLibrary && (
              <button
                onClick={() => {
                  onOpenLibrary();
                  setMobileMenuOpen(false);
                }}
                className="text-left px-4 py-3 rounded-xl text-emerald-400 bg-emerald-950/40 border border-emerald-800/60 flex items-center gap-2 mt-2 cursor-pointer font-semibold"
              >
                <BookmarkCheck className="w-4 h-4" />
                <span>My Unlocked Library ({unlockedCount})</span>
              </button>
            )}

            {/* Auth / Account in Mobile Drawer */}
            <div className="pt-3 mt-2 border-t border-slate-800/80">
              {currentUser ? (
                <div className="space-y-2">
                  {currentUser.role === 'admin' && onOpenWriterStudio && (
                    <button
                      id="mobile-drawer-writer-studio-btn"
                      onClick={() => {
                        onOpenWriterStudio();
                        setMobileMenuOpen(false);
                      }}
                      className="w-full text-left px-4 py-3 rounded-xl text-sky-200 bg-gradient-to-r from-sky-950/90 to-indigo-950/90 border border-sky-600/60 flex items-center justify-between cursor-pointer font-semibold shadow-md"
                    >
                      <div className="flex items-center gap-2">
                        <Feather className="w-4 h-4 text-sky-400" />
                        <span>Open Writer Studio</span>
                      </div>
                      <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded bg-sky-900/80 text-sky-300 border border-sky-700/50">
                        Author Portal
                      </span>
                    </button>
                  )}

                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 border border-slate-800">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-xs">
                        {currentUser.name ? currentUser.name[0].toUpperCase() : currentUser.email[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-white font-medium">{currentUser.name || currentUser.email}</p>
                        <p className="text-[10px] text-slate-400">{currentUser.role === 'admin' ? 'Administrator' : 'Reader Account'}</p>
                      </div>
                    </div>
                    {onLogout && (
                      <button
                        onClick={() => {
                          onLogout();
                          setMobileMenuOpen(false);
                        }}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-950/80 border border-rose-800 text-rose-300 text-[11px] flex items-center gap-1 cursor-pointer"
                      >
                        <LogOut className="w-3 h-3" />
                        <span>Sign Out</span>
                      </button>
                    )}
                  </div>
                </div>
              ) : onOpenSignIn && (
                <button
                  id="mobile-drawer-signin-btn"
                  onClick={() => {
                    onOpenSignIn();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 text-white text-xs font-mono font-medium flex items-center justify-center gap-2 shadow-md"
                >
                  <UserIcon className="w-4 h-4" />
                  <span>Sign In / Create Account</span>
                </button>
              )}
            </div>

            {onOpenAffiliates && (
              <div className="pt-2">
                <button
                  id="mobile-drawer-affiliates-btn"
                  onClick={() => {
                    onOpenAffiliates();
                    setMobileMenuOpen(false);
                  }}
                  className="w-full px-3 py-2.5 rounded-xl bg-cyan-950/40 hover:bg-cyan-900/50 border border-cyan-800/40 text-cyan-300 text-xs font-mono font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Affiliate Partner Program</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

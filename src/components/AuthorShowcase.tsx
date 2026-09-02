import React from 'react';
import { 
  Instagram, 
  Twitter,
  ExternalLink, 
  Feather, 
  Quote, 
  Award, 
  BookOpen, 
  Users, 
  CheckCircle,
  MapPin,
  TrendingUp
} from 'lucide-react';
import { AuthorProfile } from '../types.js';

interface AuthorShowcaseProps {
  author: AuthorProfile | null;
  onExploreArticles: () => void;
}

export const AuthorShowcase: React.FC<AuthorShowcaseProps> = ({
  author,
  onExploreArticles
}) => {
  return (
    <section 
      id="author-profile"
      className="py-20 bg-[#080d17] border-y border-slate-800/80 relative overflow-hidden"
    >
      {/* Subtle Background Glow */}
      <div className="absolute top-0 right-1/4 w-96 h-96 bg-blue-900/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/4 w-80 h-80 bg-slate-800/20 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-sky-400 mb-3">
            <Feather className="w-3.5 h-3.5" />
            <span>THE ARCHIVIST &amp; ESSAYIST</span>
          </div>
          <h2 className="font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
            Meet the Author: {author?.name || "Jake"}
          </h2>
          <p className="text-slate-400 text-sm sm:text-base mt-2">
            {author?.title || "Poet, Author, Archivist of Human Experience"}
          </p>
        </div>

        {/* Main Author Showcase Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center max-w-6xl mx-auto">
          
          {/* Left Column: Author Identity Card (5 cols) */}
          <div className="lg:col-span-5">
            <div className="rounded-2xl bg-gradient-to-b from-slate-900 to-[#0c1220] border border-slate-800 shadow-2xl relative overflow-hidden">
              
              {/* Optional Author Cover Photo Banner */}
              {author?.coverPhotoUrl && (
                <div className="w-full h-32 relative overflow-hidden border-b border-slate-800">
                  <img
                    src={author.coverPhotoUrl}
                    alt="Author Cover"
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0c1220] via-transparent to-transparent opacity-80" />
                </div>
              )}

              <div className="p-7">
                {/* Instagram Verified Header */}
                <div className={`flex items-center justify-between pb-5 border-b border-slate-800/80 ${author?.coverPhotoUrl ? '-mt-14 relative z-10' : ''}`}>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-16 h-16 rounded-full bg-gradient-to-tr from-sky-500 via-blue-600 to-amber-500 p-[2px] shadow-lg ring-4 ring-[#0c1220]">
                        <div className="w-full h-full rounded-full bg-slate-950 overflow-hidden flex items-center justify-center text-sky-300 font-display font-bold text-xl">
                          {author?.avatarUrl ? (
                            <img
                              src={author.avatarUrl}
                              alt={author.name || "Jake"}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>{(author?.name || 'J').charAt(0)}</span>
                          )}
                        </div>
                      </div>
                      <div className="absolute -bottom-1 -right-1 bg-sky-500 text-slate-950 rounded-full p-0.5" title="Verified Creator">
                        <CheckCircle className="w-4 h-4 fill-sky-400 text-slate-950" />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <h3 className="font-display font-bold text-lg text-white">{author?.name || "Jake"}</h3>
                      </div>
                      <p className="text-xs font-mono text-sky-400">@{author?.handle || "its_bigboy_jake"}</p>
                      <div className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        <span>{author?.location || "Mombasa, Kenya • Global Reach"}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] uppercase font-mono tracking-wider text-slate-400 block">Focus</span>
                    <span className="text-xs font-semibold text-slate-200">Essays &amp; Poetry</span>
                  </div>
                </div>

              {/* Bio Details */}
              <div className="py-5 space-y-3">
                <p className="text-sm text-slate-300 leading-relaxed font-sans">
                  {author?.bio || "Ink & Witness is where I put lived experience under examination; love, lust, loss, ambition, intimacy, failure, philosophy, and the contradictions that make us human."}
                </p>
                <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/70 text-xs font-serif italic text-slate-300 leading-relaxed">
                  {author?.featuredQuote || "“I write because the heart keeps a ledger the tongue is too proud to read.”"}
                </div>
              </div>

              {/* Instagram & Twitter CTA & Social Proof */}
              <div className="pt-2 space-y-2">
                <a
                  id="author-instagram-cta-btn"
                  href={author?.instagramUrl || "https://www.instagram.com/its_bigboy_jake/"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-blue-700 hover:from-sky-500 hover:to-blue-600 text-white font-medium text-xs tracking-wider transition-all shadow-md shadow-sky-900/30 group cursor-pointer"
                >
                  <Instagram className="w-4 h-4" />
                  <span>Connect with @{author?.handle || "its_bigboy_jake"} on Instagram</span>
                  <ExternalLink className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </a>

                {author?.twitterUrl && (
                  <a
                    id="author-twitter-cta-btn"
                    href={author.twitterUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 font-medium text-xs tracking-wider transition-all group cursor-pointer font-mono"
                  >
                    <Twitter className="w-3.5 h-3.5 text-sky-400" />
                    <span>Follow on X (Twitter)</span>
                    <ExternalLink className="w-3 h-3 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-transform" />
                  </a>
                )}
              </div>

              {/* Quick Key Metrics */}
              <div className="grid grid-cols-3 gap-2 mt-5 pt-5 border-t border-slate-800/80 text-center">
                <div className="p-2 rounded-lg bg-slate-950/40">
                  <span className="text-lg font-bold font-display text-white block">
                    {author?.stats.articlesCount || 6}+
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Works</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/40">
                  <span className="text-lg font-bold font-display text-sky-400 block">
                    {author?.stats.readersCount.toLocaleString() || '4,850'}+
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Readers</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-950/40">
                  <span className="text-lg font-bold font-display text-emerald-400 block">
                    {author?.stats.satisfactionRate || '99.4%'}
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">Verified Rating</span>
                </div>
              </div>

            </div>
          </div>
        </div>

          {/* Right Column: Editorial Ethos & Reader Covenant (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            <div className="space-y-4">
              <h3 className="font-display text-2xl font-bold text-slate-100">
                The Philosophy of Ink &amp; Witness
              </h3>
              <div className="text-slate-300 text-sm sm:text-base leading-relaxed whitespace-pre-line font-serif">
                {author?.extendedBio || "Ink & Witness is where I put lived experience under examination; love, lust, loss, ambition, intimacy, failure, philosophy, and the contradictions that make us human.\n\nI write close to the bone: part confession, part poetry, part philosophical inquiry, part witness. The personal is never merely personal; beneath every experience is a question worth troubling.\n\nMy work does not always seek to comfort, resolve, or behave. It seeks to look closely, to name what is felt, expose what is hidden, and find language for the things we usually leave unsaid.\n\nThese are writings born from life as it is: beautiful, erotic, bruising, absurd, tender, contradictory.\n\nNot fiction. Not answers. Just experience, witnessed and rendered into words."}
              </div>
            </div>

            {/* Principles Bento */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="flex items-center gap-2 text-sky-400 mb-1.5 text-xs font-mono font-semibold">
                  <TrendingUp className="w-4 h-4" />
                  <span>LIFE WITHOUT THE FICTION</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Writings born close to the bone: part confession, part poetry, part philosophical inquiry, part witness.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="flex items-center gap-2 text-emerald-400 mb-1.5 text-xs font-mono font-semibold">
                  <Award className="w-4 h-4" />
                  <span>DIRECT PATRONAGE</span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  M-Pesa monetization ensures 100% reader-funded independence. The writer serves only the truth and the discerning reader.
                </p>
              </div>
            </div>

            {/* Quick Explore Link */}
            <div className="pt-2 flex flex-wrap items-center gap-4">
              <button
                id="author-explore-catalog-btn"
                onClick={onExploreArticles}
                className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs tracking-wider transition-colors border border-slate-700 cursor-pointer"
              >
                Browse {author?.name || "Jake"}&apos;s Available Pieces
              </button>
              
              <a
                href={author?.instagramUrl || "https://www.instagram.com/its_bigboy_jake/"}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-mono text-sky-400 hover:text-sky-300 flex items-center gap-1.5"
              >
                <Instagram className="w-3.5 h-3.5" />
                <span>DM @{author?.handle || "its_bigboy_jake"} on Instagram</span>
              </a>
            </div>

          </div>

        </div>

      </div>
    </section>
  );
};


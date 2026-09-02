import React from 'react';
import { 
  Instagram, 
  Twitter, 
  MapPin, 
  Feather, 
  BookOpen, 
  Heart,
  ArrowRight,
  Quote,
  CheckCircle2,
  ExternalLink
} from 'lucide-react';
import { AuthorProfile } from '../../types.js';

interface AboutAuthorViewProps {
  author: AuthorProfile | null;
  onExplorePieces: () => void;
  onSupportAuthor: () => void;
}

export const AboutAuthorView: React.FC<AboutAuthorViewProps> = ({
  author,
  onExplorePieces,
  onSupportAuthor
}) => {
  const name = author?.name || 'Jacob Collins Tinga (BigBoy Jake)';
  const handle = author?.handle || 'its_bigboy_jake';
  const location = author?.location || 'Mombasa, Kenya • Global Reach';
  const tagline = author?.featuredQuote || "“I write because the heart keeps a ledger the tongue is too proud to read.”";

  return (
    <div id="about-author-view" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-20 sm:pt-36 sm:pb-28">
      
      {/* Header Eyebrow */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-sky-400 mb-4">
          <Feather className="w-3.5 h-3.5" />
          <span>AUTHOR ARCHIVE</span>
        </div>
        <h1 className="font-display text-3xl sm:text-5xl font-bold text-white tracking-tight">
          About the Author
        </h1>
      </div>

      {/* Author Cover Photo Banner if configured */}
      {author?.coverPhotoUrl && (
        <div className="w-full h-48 sm:h-72 rounded-3xl overflow-hidden mb-8 border border-slate-800 shadow-2xl relative">
          <img
            src={author.coverPhotoUrl}
            alt="Author Banner"
            referrerPolicy="no-referrer"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#090d16] via-transparent to-transparent opacity-80" />
        </div>
      )}

      {/* Author Profile Header Box */}
      <div className="p-6 sm:p-10 rounded-3xl bg-[#0d1424]/90 border border-slate-800 shadow-2xl mb-10 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 sm:gap-8">
          
          {/* Avatar Photo */}
          <div className="relative shrink-0">
            <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-gradient-to-tr from-sky-500 via-blue-600 to-amber-500 p-[3px] shadow-xl">
              <div className="w-full h-full rounded-full bg-slate-950 overflow-hidden flex items-center justify-center text-sky-300 font-display font-bold text-2xl">
                {author?.avatarUrl ? (
                  <img
                    src={author.avatarUrl}
                    alt={name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span>J</span>
                )}
              </div>
            </div>
            <div className="absolute -bottom-1 -right-1 bg-sky-500 text-slate-950 rounded-full p-1 shadow-md" title="Verified Author">
              <CheckCircle2 className="w-4 h-4 fill-sky-400 text-slate-950" />
            </div>
          </div>

          {/* Name & Details */}
          <div className="text-center sm:text-left space-y-2 flex-1">
            <h2 className="font-display font-bold text-2xl sm:text-3xl text-white">
              {name}
            </h2>
            
            <p className="text-xs sm:text-sm font-mono text-sky-400">
              @{handle}
            </p>

            <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs text-slate-400 pt-1">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{location}</span>
            </div>

            {/* Social Buttons */}
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-3">
              <a
                id="about-author-instagram-link"
                href={author?.instagramUrl || "https://www.instagram.com/its_bigboy_jake/"}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold tracking-wide border border-slate-700 transition-colors cursor-pointer"
              >
                <Instagram className="w-3.5 h-3.5 text-pink-400" />
                <span>Instagram @{handle}</span>
                <ExternalLink className="w-3 h-3 text-slate-400" />
              </a>

              {author?.twitterUrl && (
                <a
                  id="about-author-twitter-link"
                  href={author.twitterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold tracking-wide border border-slate-700 transition-colors cursor-pointer"
                >
                  <Twitter className="w-3.5 h-3.5 text-sky-400" />
                  <span>X (Twitter)</span>
                  <ExternalLink className="w-3 h-3 text-slate-400" />
                </a>
              )}
            </div>

          </div>
        </div>

        {/* Featured Tagline Quote */}
        <div className="mt-8 pt-6 border-t border-slate-800/80">
          <blockquote className="font-serif italic text-base sm:text-lg text-slate-200 font-light text-center leading-relaxed">
            {tagline}
          </blockquote>
        </div>
      </div>

      {/* Main Biography & Philosophy (Editorial Style) */}
      <div className="space-y-8 text-slate-300 font-serif text-base sm:text-lg leading-relaxed bg-slate-900/40 p-6 sm:p-10 rounded-3xl border border-slate-800/60">
        
        {author?.bio && (
          <p className="font-sans text-slate-200 text-base sm:text-lg leading-relaxed font-normal">
            {author.bio}
          </p>
        )}

        {author?.extendedBio ? (
          <div className="whitespace-pre-line space-y-4 font-serif text-slate-300 leading-loose">
            {author.extendedBio}
          </div>
        ) : (
          <div className="whitespace-pre-line space-y-4 font-serif text-slate-300 leading-loose">
            {`Ink & Witness is where I put lived experience under examination; love, lust, loss, ambition, intimacy, failure, philosophy, and the contradictions that make us human.

I write close to the bone: part confession, part poetry, part philosophical inquiry, part witness. The personal is never merely personal; beneath every experience is a question worth troubling.

My work does not always seek to comfort, resolve, or behave. It seeks to look closely, to name what is felt, expose what is hidden, and find language for the things we usually leave unsaid.

These are writings born from life as it is: beautiful, erotic, bruising, absurd, tender, contradictory.

Not fiction. Not answers. Just experience, witnessed and rendered into words.`}
          </div>
        )}

      </div>

      {/* Action Footer */}
      <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-4 text-center">
        <button
          id="about-author-explore-btn"
          onClick={onExplorePieces}
          className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-semibold text-xs tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-sky-950 cursor-pointer"
        >
          <BookOpen className="w-4 h-4" />
          <span>Explore All Pieces</span>
        </button>

        <button
          id="about-author-support-btn"
          onClick={onSupportAuthor}
          className="w-full sm:w-auto px-7 py-3.5 rounded-xl bg-rose-950/60 hover:bg-rose-900/80 text-rose-300 hover:text-white border border-rose-800/80 text-xs font-semibold tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Heart className="w-4 h-4 fill-rose-400/40" />
          <span>Support the Author</span>
        </button>
      </div>

    </div>
  );
};

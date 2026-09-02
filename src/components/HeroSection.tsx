import React from 'react';
import { AuthorProfile } from '../types.js';

interface HeroSectionProps {
  author: AuthorProfile | null;
  onExploreMonographs?: () => void;
  onMeetAuthor?: () => void;
}

export const HeroSection: React.FC<HeroSectionProps> = ({
  author
}) => {
  const tagline = author?.featuredQuote || "“I write because the heart keeps a ledger the tongue is too proud to read.”";

  return (
    <section 
      id="hero-section"
      className="relative pt-32 pb-12 sm:pt-40 sm:pb-16 overflow-hidden bg-gradient-to-b from-[#090d16] via-[#0c1220] to-[#0b101b]"
    >
      {/* Background Architectural Grid Lines & Subtle Ambient Glow */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b10_1px,transparent_1px),linear-gradient(to_bottom,#1e293b10_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] pointer-events-none" />
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-sky-600/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
        {/* Main Title */}
        <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1] mb-5">
          INK <span className="text-slate-500 font-normal">&amp;</span> WITNESS
        </h1>

        {/* The Tagline */}
        <p className="font-serif italic text-xl sm:text-2xl lg:text-3xl text-slate-300 font-light max-w-3xl mx-auto leading-relaxed">
          {tagline}
        </p>
      </div>
    </section>
  );
};


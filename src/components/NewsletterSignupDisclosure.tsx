import React from 'react';
import { ChevronDown, Mail, ShieldCheck } from 'lucide-react';

export interface NewsletterSignupDisclosureProps {
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/**
 * A native disclosure keeps the signup form mounted while it is collapsed, so
 * readers do not lose anything they have typed or selected.
 */
export const NewsletterSignupDisclosure: React.FC<NewsletterSignupDisclosureProps> = ({
  children,
  defaultOpen = false,
}) => (
  <details className="group" open={defaultOpen || undefined}>
    <summary
      aria-controls="newsletter-signup-panel"
      className="flex min-h-20 cursor-pointer list-none items-center gap-3 rounded-2xl border border-sky-900/70 bg-gradient-to-r from-[#0f172a] via-[#0b1424] to-[#07101d] px-4 py-3 text-left shadow-lg marker:hidden transition hover:border-sky-700/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0b101b] sm:gap-4 sm:px-5 [&::-webkit-details-marker]:hidden"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-sky-800 bg-sky-950/80 text-sky-300">
        <Mail className="h-4 w-4" aria-hidden="true" />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-sky-400">
          Reader letters
        </span>
        <span className="mt-0.5 block font-serif text-base font-semibold text-white sm:text-lg">
          New writing, delivered gently.
        </span>
        <span className="mt-0.5 hidden text-xs text-slate-400 sm:block">
          Choose what reaches you. Private preferences, double opt-in, and no daily noise.
        </span>
      </span>

      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-200">
        <ShieldCheck className="hidden h-3.5 w-3.5 text-emerald-400 sm:block" aria-hidden="true" />
        <span className="group-open:hidden">Join</span>
        <span className="hidden group-open:inline">Close</span>
        <ChevronDown className="h-3.5 w-3.5 text-sky-400 transition-transform group-open:rotate-180" aria-hidden="true" />
      </span>
    </summary>

    <div id="newsletter-signup-panel" className="mt-3">
      {children}
    </div>
  </details>
);

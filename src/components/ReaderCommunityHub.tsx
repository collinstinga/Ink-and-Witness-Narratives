import React from 'react';
import { ArrowUpRight, Mail, MessageCircle, Radio } from 'lucide-react';

import type { HomepageConfig } from '../types.js';
import { NewsletterSignup } from './NewsletterSignup.js';

export interface ReaderCommunityHubProps {
  config?: HomepageConfig | null;
}

export const ReaderCommunityHub: React.FC<ReaderCommunityHubProps> = ({ config }) => {
  const emailEnabled = config?.communicationEmailEnabled !== false;
  const whatsappEnabled = config?.communicationWhatsappEnabled !== false;
  const channelUrl = config?.communicationWhatsappUrl
    || 'https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z';

  if (!emailEnabled && !whatsappEnabled) return null;

  return (
    <section
      id="reader-community"
      aria-labelledby="reader-community-heading"
      className="border-y border-slate-800/70 bg-slate-950/35"
    >
      <div className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-9">
        <header className="mb-5 max-w-2xl">
          <p className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.26em] text-emerald-400">
            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            Community updates
          </p>
          <h2 id="reader-community-heading" className="mt-2 font-display text-2xl font-bold text-white">
            {config?.communicationHeading?.trim() || 'Stay in the loop'}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">
            {config?.communicationDescription?.trim()
              || 'Choose private email letters, the public WhatsApp channel, or both.'}
          </p>
        </header>

        <div className={emailEnabled && whatsappEnabled ? 'grid gap-4 lg:grid-cols-[1.35fr_0.65fr]' : ''}>
          {emailEnabled ? (
            <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#0a1220]/70">
              <div className="flex items-center gap-2 px-5 pt-4 text-xs font-semibold text-sky-200">
                <Mail className="h-4 w-4" aria-hidden="true" />
                Email Reader Letters
              </div>
              <NewsletterSignup variant="compact" />
            </div>
          ) : null}

          {whatsappEnabled ? (
            <div className="flex min-h-44 flex-col justify-between rounded-2xl border border-emerald-900/70 bg-gradient-to-br from-emerald-950/45 via-slate-950 to-slate-950 p-5">
              <div>
                <span className="flex h-10 w-10 items-center justify-center rounded-full border border-emerald-800 bg-emerald-950 text-emerald-300">
                  <MessageCircle className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 font-display text-xl font-bold text-white">WhatsApp Channel</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {config?.communicationWhatsappDescription?.trim()
                    || 'New releases and important Ink & Witness updates in WhatsApp.'}
                </p>
              </div>
              <a
                href={channelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 text-xs font-bold text-emerald-950 transition hover:bg-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                {config?.communicationWhatsappLabel?.trim() || 'Follow the WhatsApp channel'}
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
};

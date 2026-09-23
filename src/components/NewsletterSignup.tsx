import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, Mail, ShieldCheck, Sparkles } from 'lucide-react';
import type { Category } from '../types.js';
import { api } from '../utils/api.js';

export const NewsletterSignup: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [categories, setCategories] = useState<Category[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [contentMode, setContentMode] = useState<'standard' | 'discreet'>('standard');
  const [consent, setConsent] = useState(false);
  const [website, setWebsite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    Promise.all([
      api.getNewsletterConfig().catch(() => ({ enabled: false, consentVersion: '', doubleOptIn: true })),
      api.getCategories().catch(() => [] as Category[])
    ]).then(([config, categoryList]) => {
      if (!active) return;
      setEnabled(config.enabled);
      setCategories(categoryList.filter(category => category.isEnabled !== false));
      setLoadingConfig(false);
    });
    return () => { active = false; };
  }, []);

  const visibleInterests = useMemo(
    () => categories.slice().sort((a, b) => a.order - b.order).slice(0, 12),
    [categories]
  );

  const toggleInterest = (name: string) => {
    setSelectedInterests(current => current.includes(name)
      ? current.filter(value => value !== name)
      : [...current, name]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!consent) {
      setError('Please confirm that you want to receive Ink & Witness email updates.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await api.subscribeNewsletter({
        email,
        name: name || undefined,
        interests: selectedInterests,
        contentMode,
        consent: true,
        website
      });
      setSubmitted(true);
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : 'Newsletter signup could not be completed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingConfig || !enabled) return null;

  return (
    <section id="newsletter-signup" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-14">
      <div className="relative overflow-hidden rounded-3xl border border-sky-900/70 bg-gradient-to-br from-[#0f172a] via-[#0b1424] to-[#07101d] p-6 sm:p-10 shadow-2xl">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-800 bg-sky-950/70 px-3 py-1 text-[11px] font-mono uppercase tracking-widest text-sky-300">
              <Mail className="h-3.5 w-3.5" />
              Reader letters
            </div>
            <div>
              <h2 className="font-serif text-3xl font-bold text-white sm:text-4xl">Stay close to the ink.</h2>
              <p className="mt-3 max-w-xl font-serif text-lg italic leading-relaxed text-slate-300">
                Get notified when a new piece or chapter is released—only for the writing you choose to follow.
              </p>
            </div>
            <div className="space-y-2 text-xs leading-relaxed text-slate-400">
              <p className="flex items-start gap-2"><Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />Thoughtful release notes, never automatic daily noise.</p>
              <p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />Double opt-in, private preferences, and an unsubscribe link in every email.</p>
            </div>
          </div>

          {submitted ? (
            <div role="status" className="rounded-2xl border border-emerald-800 bg-emerald-950/30 p-6 text-center">
              <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-400" />
              <h3 className="mt-4 font-serif text-xl font-bold text-white">Check your inbox</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                If the address can receive mail, a confirmation link is on its way. You will not receive updates until you confirm.
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-slate-800 bg-slate-950/50 p-5 sm:p-6" noValidate>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs text-slate-300">
                  <span className="font-mono uppercase tracking-wider">Email address *</span>
                  <input type="email" required autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-[#080d17] px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500" placeholder="reader@example.com" />
                </label>
                <label className="space-y-1.5 text-xs text-slate-300">
                  <span className="font-mono uppercase tracking-wider">Name <span className="normal-case text-slate-500">(optional)</span></span>
                  <input type="text" autoComplete="name" maxLength={120} value={name} onChange={event => setName(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-[#080d17] px-3.5 py-2.5 text-sm text-white outline-none focus:border-sky-500" placeholder="How should I address you?" />
                </label>
              </div>

              {visibleInterests.length > 0 && (
                <fieldset className="space-y-3">
                  <legend className="text-xs font-mono uppercase tracking-wider text-slate-300">Show me more of… <span className="normal-case text-slate-500">(optional)</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {visibleInterests.map(category => {
                      const selected = selectedInterests.includes(category.name);
                      return (
                        <button key={category.id} type="button" aria-pressed={selected} onClick={() => toggleInterest(category.name)} className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${selected ? 'border-sky-500 bg-sky-950 text-sky-200' : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'}`}>
                          {category.name}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-slate-500">Leave all unselected for broad literary updates. You can still browse the entire catalogue.</p>
                </fieldset>
              )}

              <label className="flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-3 text-xs text-slate-300">
                <input type="checkbox" checked={contentMode === 'discreet'} onChange={event => setContentMode(event.target.checked ? 'discreet' : 'standard')} className="mt-0.5 h-4 w-4 accent-sky-500" />
                <span><strong className="text-slate-200">Use discreet email subject lines.</strong><span className="mt-1 block text-slate-500">Useful when you follow intimacy or adult writing and prefer neutral inbox wording.</span></span>
              </label>

              <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-300">
                <input type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)} className="mt-0.5 h-4 w-4 accent-sky-500" />
                <span>I voluntarily agree to receive Ink &amp; Witness release updates. I understand I must confirm by email and can unsubscribe at any time.</span>
              </label>

              <label className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                Website<input type="text" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
              </label>

              {error && <p role="alert" className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300">{error}</p>}
              <button type="submit" disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-sky-500 disabled:cursor-wait disabled:opacity-60">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {submitting ? 'Requesting confirmation…' : 'Subscribe to reader letters'}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
};

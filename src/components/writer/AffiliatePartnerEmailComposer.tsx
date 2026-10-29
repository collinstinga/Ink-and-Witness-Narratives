import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, Loader2, Mail, RefreshCw, Send } from 'lucide-react';
import { api } from '../../utils/api.js';
import type { AffiliatePartnerEmailCampaign, AffiliatePartnerEmailInput, AffiliatePartnerEmailOverview,
  AffiliatePartnerEmailPreview, AffiliatePartnerEmailStep } from '../../types/affiliatePartnerEmail.js';

export interface AffiliatePartnerEmailService {
  overview: (options?: { signal?: AbortSignal }) => Promise<AffiliatePartnerEmailOverview>;
  preview: (input: AffiliatePartnerEmailInput) => Promise<AffiliatePartnerEmailPreview>;
  create: (input: AffiliatePartnerEmailInput & { requestId: string }) => Promise<{ campaign: AffiliatePartnerEmailCampaign }>;
  send: (id: string) => Promise<AffiliatePartnerEmailStep>;
}

const defaultService: AffiliatePartnerEmailService = {
  overview: options => api.getAdminAffiliateEmailOverview(options),
  preview: input => api.previewAdminAffiliateEmail(input),
  create: input => api.createAdminAffiliateEmail(input),
  send: id => api.sendAdminAffiliateEmail(id),
};
const emptyInput: AffiliatePartnerEmailInput = { subject: '', body: '', audience: 'all', affiliateIds: [] };

export function validatePartnerEmail(input: AffiliatePartnerEmailInput): string | undefined {
  if (!input.subject.trim() || input.subject.trim().length > 200) return 'Enter a subject of up to 200 characters.';
  if (!input.body.trim() || input.body.trim().length > 12000) return 'Enter a message of up to 12,000 characters.';
  if (input.audience === 'selected' && !input.affiliateIds.length) return 'Select at least one partner.';
}

export function partnerEmailSnapshot(input: AffiliatePartnerEmailInput): string {
  return JSON.stringify({ subject: input.subject.trim(), body: input.body.trim(), audience: input.audience,
    affiliateIds: input.audience === 'selected' ? [...new Set(input.affiliateIds)].sort() : [] });
}

/** One explicit writer action may advance small batches. A failed/ambiguous call
 * exits immediately; only a new writer action may continue it. */
export async function deliverPartnerEmail(
  campaign: AffiliatePartnerEmailCampaign,
  send: AffiliatePartnerEmailService['send'],
  onProgress: (campaign: AffiliatePartnerEmailCampaign) => void,
): Promise<AffiliatePartnerEmailStep> {
  let current = campaign;
  for (let step = 0; step < 10; step += 1) {
    const result = await send(campaign.id);
    if (result.campaign.id !== campaign.id) throw new Error('The email campaign response did not match. Refresh delivery history.');
    current = result.campaign;
    onProgress(current);
    if (result.complete) return result;
  }
  return { campaign: current, complete: false };
}

function DeliveryCounts({ campaign }: { campaign: AffiliatePartnerEmailCampaign }) {
  return <p className="mt-2 text-xs leading-relaxed text-slate-400">
    {campaign.sentCount} accepted by email provider · {campaign.failedCount} failed
    {campaign.excludedCount ? ` · ${campaign.excludedCount} skipped` : ''}
    {campaign.remainingCount ? ` · ${campaign.remainingCount} remaining` : ''}
    {campaign.uncertainCount ? ` · ${campaign.uncertainCount} awaiting confirmation (will not be resent automatically)` : ''}
  </p>;
}

export default function AffiliatePartnerEmailComposer({ service = defaultService }: { service?: AffiliatePartnerEmailService }) {
  const [overview, setOverview] = useState<AffiliatePartnerEmailOverview | null>(null);
  const [draft, setDraft] = useState<AffiliatePartnerEmailInput>(emptyInput);
  const [preview, setPreview] = useState<(AffiliatePartnerEmailPreview & { snapshot: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const running = useRef(false);
  const requestId = useRef<string | null>(null);
  const readSequence = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const previewCurrent = preview?.snapshot === partnerEmailSnapshot(draft);
  const locked = loading || Boolean(busy);

  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const sequence = ++readSequence.current;
    setLoading(true);
    try {
      const result = await service.overview({ signal: controller.signal });
      if (mounted.current && sequence === readSequence.current && !controller.signal.aborted) setOverview(result);
    } catch (failure) {
      if (mounted.current && sequence === readSequence.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : 'Partner email history could not be loaded.');
      }
    } finally {
      if (mounted.current && sequence === readSequence.current && !controller.signal.aborted) setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; readSequence.current++; readController.current?.abort(); };
  }, [refresh]);

  const update = (patch: Partial<AffiliatePartnerEmailInput>) => {
    if (running.current) return;
    setDraft(current => ({ ...current, ...patch })); setPreview(null); requestId.current = null;
    setNotice(''); setError('');
  };

  const checkRecipients = async () => {
    if (running.current || loading) return;
    const validation = validatePartnerEmail(draft);
    if (validation) { setError(validation); return; }
    running.current = true; setBusy('preview'); setError(''); setNotice('');
    const snapshot = partnerEmailSnapshot(draft);
    try {
      const result = await service.preview(JSON.parse(snapshot));
      if (mounted.current) setPreview({ ...result, snapshot });
    } catch (failure) {
      if (mounted.current) { setPreview(null); setError(failure instanceof Error ? failure.message : 'Recipients could not be checked.'); }
    } finally { running.current = false; if (mounted.current) setBusy(null); }
  };

  const recordCampaign = (campaign: AffiliatePartnerEmailCampaign) => {
    if (mounted.current) setOverview(current => current ? {
      ...current, campaigns: [campaign, ...current.campaigns.filter(item => item.id !== campaign.id)],
    } : current);
  };

  const send = async (existing?: AffiliatePartnerEmailCampaign) => {
    if (running.current || loading || !overview?.providerConfigured) return;
    if (!existing && (!previewCurrent || !preview || preview.eligible < 1 || validatePartnerEmail(draft))) return;
    if (existing && !['draft', 'sending', 'paused'].includes(existing.status)) return;
    const count = existing?.remainingCount ?? existing?.eligibleCount ?? preview?.eligible ?? 0;
    if (!window.confirm(`Send “${existing?.subject || draft.subject.trim()}” to ${count} eligible partner(s)? This sends real email and cannot be recalled.`)) return;
    running.current = true; setBusy('send'); setError(''); setNotice('');
    try {
      let campaign = existing;
      if (!campaign) {
        requestId.current ||= crypto.randomUUID();
        campaign = (await service.create({ ...JSON.parse(partnerEmailSnapshot(draft)), requestId: requestId.current })).campaign;
        recordCampaign(campaign);
        // A created campaign has frozen content and audience. Further work uses
        // its history entry instead of creating another copy of the same send.
        if (mounted.current) { setDraft(emptyInput); setPreview(null); requestId.current = null; }
      }
      const result = await deliverPartnerEmail(campaign, service.send, recordCampaign);
      if (mounted.current) setNotice(result.complete
        ? 'Email sending finished. Review the delivery counts below; provider acceptance does not guarantee inbox delivery.'
        : 'Sending paused at a safe checkpoint. Choose Continue sending in delivery history.');
      await refresh();
    } catch (failure) {
      if (mounted.current) setError(`${failure instanceof Error ? failure.message : 'Sending could not be confirmed.'} Delivery history is being refreshed. Check it before continuing; completed emails will not be sent again.`);
      await refresh();
    } finally { running.current = false; if (mounted.current) setBusy(null); }
  };

  return <section aria-labelledby="partner-email-heading" aria-busy={locked} className="space-y-5 rounded-2xl border border-violet-500/20 bg-[#080d1a] p-4 sm:p-6">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="partner-email-heading" className="flex items-center gap-2 font-serif text-2xl font-bold text-white"><Mail aria-hidden="true" className="h-5 w-5 text-violet-300" /> Email your partners</h3>
        <p className="mt-2 text-sm text-slate-300">Choose recipients, write your message, preview, then send.</p></div>
      <button type="button" disabled={locked} onClick={() => { setError(''); void refresh(); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs text-slate-200 disabled:opacity-50"><RefreshCw aria-hidden="true" className="h-4 w-4" />Refresh history</button>
    </header>
    {error ? <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-950/30 p-3 text-sm text-rose-100">{error}</div> : null}
    {notice ? <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-3 text-sm text-emerald-100">{notice}</div> : null}
    {loading && !overview ? <p role="status" className="text-sm text-slate-300">Loading partner email…</p> : null}
    {overview && !overview.providerConfigured ? <p className="rounded-xl border border-amber-400/30 p-3 text-sm text-amber-100">Email sending is unavailable. Your server email provider needs to be configured.</p> : null}
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-4">
        <fieldset disabled={locked || !overview} className="space-y-3 disabled:opacity-60">
          <legend className="text-sm font-semibold text-white">1. Recipients</legend>
          <label className="block text-xs text-slate-300">Send to<select value={draft.audience} onChange={event => update({ audience: event.target.value as AffiliatePartnerEmailInput['audience'] })} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white"><option value="all">All eligible partners</option><option value="selected">Choose individual partners</option></select></label>
          {draft.audience === 'selected' ? <div className="max-h-64 space-y-2 overflow-y-auto rounded-xl border border-slate-800 p-3">
            {overview?.recipients.length ? overview.recipients.map(partner => <label key={partner.id} className={`flex items-start gap-3 text-sm ${partner.eligible ? 'text-slate-200' : 'text-slate-500'}`}>
              <input type="checkbox" disabled={!partner.eligible} checked={draft.affiliateIds.includes(partner.id)} onChange={event => update({ affiliateIds: event.target.checked ? [...draft.affiliateIds, partner.id] : draft.affiliateIds.filter(id => id !== partner.id) })} className="mt-1 h-4 w-4 accent-violet-500" />
              <span className="min-w-0 break-words">{partner.name}<span className="block text-xs">{partner.email}</span>{!partner.eligible ? <span className="block text-xs">{partner.reason || 'Not eligible for announcements'}</span> : null}</span>
            </label>) : <p className="text-xs text-slate-400">No partners available.</p>}
          </div> : null}
          <p className="text-xs leading-relaxed text-slate-400">Only approved, active partners who accepted the terms and opted into partner announcements receive these emails. Reader newsletter subscribers are separate.</p>
        </fieldset>
        <fieldset disabled={locked || !overview} className="space-y-3 disabled:opacity-60">
          <legend className="mb-3 text-sm font-semibold text-white">2. Message</legend>
          <label className="block text-xs text-slate-300">Subject<input required maxLength={200} value={draft.subject} onChange={event => update({ subject: event.target.value })} className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white" /></label>
          <label className="block text-xs text-slate-300">Message<textarea required maxLength={12000} rows={8} value={draft.body} onChange={event => update({ body: event.target.value })} placeholder="Write your update to the Literary Circle…" className="mt-1.5 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm leading-relaxed text-white" /></label>
        </fieldset>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={locked || !overview} onClick={() => void checkRecipients()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-400/40 px-4 text-sm font-semibold text-violet-100 disabled:opacity-40">{busy === 'preview' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Eye aria-hidden="true" className="h-4 w-4" />}Preview recipients</button>
          <button type="button" disabled={locked || !overview?.providerConfigured || !previewCurrent || !preview?.eligible} onClick={() => void send()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-40">{busy === 'send' ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Send aria-hidden="true" className="h-4 w-4" />}{busy === 'send' ? 'Sending…' : 'Send partner email'}</button>
        </div>
        {preview && previewCurrent ? <p role="status" className={`text-sm ${preview.eligible ? 'text-emerald-200' : 'text-amber-100'}`}>{preview.eligible} will receive this email · {preview.excluded} excluded · {preview.total} checked.{!preview.eligible ? ' No eligible recipients. Partners can update announcement consent in their dashboard.' : ''}</p> : <p className="text-xs text-slate-400">Preview recipients before sending. Changing the message or audience requires a new preview.</p>}
      </div>
      <aside aria-label="Partner email preview" className="self-start rounded-2xl bg-white p-5 text-slate-800">
        <p className="text-[10px] font-bold uppercase tracking-widest text-sky-700">Ink &amp; Witness · Literary Circle</p>
        <h4 className="mt-5 break-words font-serif text-2xl font-bold">{draft.subject || 'Your email subject'}</h4>
        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{draft.body || 'Your message will appear here.'}</p>
        <p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500">Each partner receives an individual email with their own notification preferences link.</p>
      </aside>
    </div>
    <section aria-labelledby="partner-email-history" className="border-t border-slate-800 pt-5">
      <h4 id="partner-email-history" className="font-serif text-xl font-semibold text-white">Delivery history</h4>
      <div className="mt-3 space-y-3">{overview?.campaigns.length ? overview.campaigns.map(campaign => <article key={campaign.id} className="rounded-xl border border-slate-800 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><strong className="break-words text-sm text-slate-100">{campaign.subject}</strong><span className="text-xs text-violet-200">{campaign.status.replace(/_/g, ' ')}</span></div>
        <DeliveryCounts campaign={campaign} />
        <details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">View message</summary><p className="mt-2 whitespace-pre-wrap break-words">{campaign.body}</p></details>
        {['draft', 'sending', 'paused'].includes(campaign.status) ? <button type="button" disabled={locked || !overview.providerConfigured} onClick={() => void send(campaign)} className="mt-3 min-h-11 rounded-lg border border-violet-500/40 px-3 text-xs font-semibold text-violet-100 disabled:opacity-40">Continue sending</button> : null}
      </article>) : <p className="text-sm text-slate-400">No partner emails have been created yet.</p>}</div>
    </section>
  </section>;
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Users
} from 'lucide-react';
import type {
  NewsletterAdminSummary,
  NewsletterAudience,
  NewsletterCampaign,
  NewsletterCampaignContent,
  NewsletterSubscriber,
  NewsletterSubscriberStatus
} from '../../types.js';
import { api } from '../../utils/api.js';

const emptyContent: NewsletterCampaignContent = {
  subject: '',
  preheader: '',
  heading: '',
  body: '',
  ctaLabel: 'Read / Purchase',
  ctaUrl: ''
};

export const WriterNewsletter: React.FC = () => {
  const [summary, setSummary] = useState<(NewsletterAdminSummary & { providerConfigured: boolean; enabled: boolean }) | null>(null);
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>([]);
  const [campaigns, setCampaigns] = useState<NewsletterCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<NewsletterSubscriberStatus | 'all'>('all');
  const [selectedSubscriberIds, setSelectedSubscriberIds] = useState<string[]>([]);
  const [content, setContent] = useState<NewsletterCampaignContent>(emptyContent);
  const [audienceType, setAudienceType] = useState<NewsletterAudience['type']>('all');
  const [interestText, setInterestText] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [draftCampaign, setDraftCampaign] = useState<NewsletterCampaign | null>(null);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [summaryResult, subscriberResult, campaignResult] = await Promise.all([
        api.getNewsletterAdminSummary(25),
        api.getNewsletterSubscribers({ status, search, limit: 50 }),
        api.getNewsletterCampaigns()
      ]);
      setSummary(summaryResult);
      setSubscribers(subscriberResult.subscribers);
      setCampaigns(campaignResult.campaigns);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Newsletter data could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadOverview(); }, search ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview, search, status]);

  const interests = useMemo(() => interestText
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, 20), [interestText]);

  const audience = useMemo<NewsletterAudience>(() => {
    if (audienceType === 'selected') return { type: 'selected', subscriberIds: selectedSubscriberIds };
    if (audienceType === 'interests') return { type: 'interests', interests };
    return { type: 'all' };
  }, [audienceType, interests, selectedSubscriberIds]);

  const deliveryInProgress = draftCampaign?.status === 'queued'
    || draftCampaign?.status === 'sending';

  const saveDraft = async (): Promise<NewsletterCampaign> => {
    if (!content.subject.trim() || !content.body.trim()) {
      throw new Error('Subject and email body are required.');
    }
    if (audience.type === 'selected' && selectedSubscriberIds.length === 0) {
      throw new Error('Select at least one subscriber for this audience.');
    }
    if (audience.type === 'interests' && interests.length === 0) {
      throw new Error('Enter at least one interest for this segment.');
    }
    const result = draftCampaign
      ? await api.updateNewsletterCampaign(draftCampaign.id, { content, audience })
      : await api.createNewsletterCampaign({ content, audience });
    setDraftCampaign(result.campaign);
    setCampaigns(current => [result.campaign, ...current.filter(item => item.id !== result.campaign.id)]);
    return result.campaign;
  };

  const handleSaveDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await saveDraft();
      setNotice('Newsletter draft saved. No email has been sent.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Draft could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!testEmail.trim()) {
      setError('Enter the address that should receive the test.');
      return;
    }
    setTesting(true);
    setError('');
    try {
      await api.sendNewsletterTest(testEmail, content);
      setNotice(`Test email accepted for delivery to ${testEmail}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Test email could not be sent.');
    } finally {
      setTesting(false);
    }
  };

  const handleSend = async () => {
    if (!window.confirm('Send this newsletter to the selected audience? This cannot be recalled.')) return;
    setSending(true);
    setError('');
    try {
      // A started campaign is immutable. If a browser/network interruption
      // stopped the previous loop, restart from page one and let deterministic
      // delivery IDs plus provider idempotency keys skip work already completed.
      const campaign = deliveryInProgress && draftCampaign
        ? draftCampaign
        : await saveDraft();
      let cursor: string | undefined;
      let completed = false;
      let guard = 0;
      while (!completed && guard < 200) {
        const step = await api.sendNewsletterCampaignStep(campaign.id, cursor);
        cursor = step.nextCursor;
        completed = step.complete;
        setDraftCampaign(step.campaign);
        guard += 1;
      }
      if (!completed) throw new Error('Delivery paused at a safe checkpoint. Press Send again to resume.');
      setNotice('Newsletter delivery completed. Open delivery history to review the final status.');
      setDraftCampaign(null);
      setContent(emptyContent);
      await loadOverview();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Newsletter delivery could not be completed.');
    } finally {
      setSending(false);
    }
  };

  const toggleSubscriber = (id: string) => {
    setSelectedSubscriberIds(current => current.includes(id)
      ? current.filter(value => value !== id)
      : [...current, id]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-bold text-white">Newsletter &amp; Reader Retention</h1>
          <p className="mt-1 text-xs text-slate-400">Consent-based reader updates with explicit audience control. Publishing never emails automatically.</p>
        </div>
        <button type="button" onClick={() => void loadOverview()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300">{notice}</div>}
      {summary && !summary.providerConfigured && (
        <div className="rounded-xl border border-amber-800 bg-amber-950/30 p-4 text-xs leading-relaxed text-amber-200">
          Email delivery is safely disabled until <code>RESEND_API_KEY</code> and <code>NEWSLETTER_FROM_EMAIL</code> are configured on the server. Subscriber and campaign records remain server-only.
        </div>
      )}
      {deliveryInProgress && (
        <div className="rounded-xl border border-sky-800 bg-sky-950/30 p-4 text-xs leading-relaxed text-sky-200">
          This campaign is paused at a safe delivery checkpoint. Its content and audience are frozen; use Resume delivery to continue without duplicating completed sends.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Total subscribers', summary?.totalSubscribers || 0, Users],
          ['Active', summary?.activeSubscribers || 0, CheckCircle2],
          ['Unsubscribed', summary?.unsubscribedSubscribers || 0, Mail],
          ['Suppressed', summary?.suppressedSubscribers || 0, ShieldCheck]
        ].map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-2xl border border-slate-800 bg-[#0b1120] p-4">
            <div className="flex items-center justify-between text-xs text-slate-400"><span>{String(label)}</span><Icon className="h-4 w-4 text-sky-400" /></div>
            <div className="mt-2 font-serif text-3xl font-bold text-white">{Number(value).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
          <div className="flex items-center gap-2"><Send className="h-4 w-4 text-sky-400" /><h2 className="font-serif text-lg font-bold text-white">Compose a newsletter</h2></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400">Subject *<input disabled={deliveryInProgress} value={content.subject} onChange={event => setContent({ ...content, subject: event.target.value })} maxLength={200} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" /></label>
            <label className="space-y-1 text-xs text-slate-400">Preheader<input disabled={deliveryInProgress} value={content.preheader || ''} onChange={event => setContent({ ...content, preheader: event.target.value })} maxLength={300} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" /></label>
          </div>
          <label className="block space-y-1 text-xs text-slate-400">Email heading<input disabled={deliveryInProgress} value={content.heading || ''} onChange={event => setContent({ ...content, heading: event.target.value })} maxLength={200} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" /></label>
          <label className="block space-y-1 text-xs text-slate-400">Body *<textarea disabled={deliveryInProgress} rows={8} value={content.body} onChange={event => setContent({ ...content, body: event.target.value })} className="w-full resize-y rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-sky-500 disabled:opacity-60" placeholder="Write the reader letter here…" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400">CTA label<input disabled={deliveryInProgress} value={content.ctaLabel || ''} onChange={event => setContent({ ...content, ctaLabel: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" /></label>
            <label className="space-y-1 text-xs text-slate-400">Direct piece/chapter URL<input disabled={deliveryInProgress} type="url" value={content.ctaUrl || ''} onChange={event => setContent({ ...content, ctaUrl: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" placeholder="https://…/#piece-slug" /></label>
          </div>
          <label className="block space-y-1 text-xs text-slate-400">Cover image URL<input disabled={deliveryInProgress} type="url" value={content.coverImageUrl || ''} onChange={event => setContent({ ...content, coverImageUrl: event.target.value })} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-sm text-white outline-none focus:border-sky-500 disabled:opacity-60" /></label>

          <fieldset className="space-y-3 rounded-xl border border-slate-800 p-4">
            <legend className="px-2 text-xs font-mono uppercase tracking-wider text-slate-300">Audience</legend>
            <div className="flex flex-wrap gap-2">
              {(['all', 'interests', 'selected'] as const).map(value => (
                <button key={value} type="button" disabled={deliveryInProgress} onClick={() => setAudienceType(value)} className={`rounded-full border px-3 py-1.5 text-xs disabled:opacity-60 ${audienceType === value ? 'border-sky-500 bg-sky-950 text-sky-200' : 'border-slate-700 text-slate-400'}`}>
                  {value === 'all' ? 'All active subscribers' : value === 'interests' ? 'Interest segment' : 'Selected subscribers'}
                </button>
              ))}
            </div>
            {audienceType === 'interests' && <input disabled={deliveryInProgress} value={interestText} onChange={event => setInterestText(event.target.value)} className="w-full rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-xs text-white outline-none focus:border-sky-500 disabled:opacity-60" placeholder="Faith, Poetry, Grief & Healing" />}
            {audienceType === 'selected' && <p className="text-xs text-slate-400">{selectedSubscriberIds.length} subscriber(s) selected in the directory below.</p>}
          </fieldset>

          <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-4">
            <button type="button" onClick={() => void handleSaveDraft()} disabled={saving || sending || deliveryInProgress} className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 disabled:opacity-50">{saving ? 'Saving…' : 'Save draft'}</button>
            <input type="email" value={testEmail} onChange={event => setTestEmail(event.target.value)} className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-xs text-white outline-none focus:border-sky-500" placeholder="Test recipient email" />
            <button type="button" onClick={() => void handleTest()} disabled={testing || sending || deliveryInProgress || !summary?.providerConfigured} className="inline-flex items-center gap-2 rounded-lg border border-sky-800 bg-sky-950 px-4 py-2 text-xs font-bold text-sky-200 disabled:opacity-50">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}Send test</button>
            <button type="button" onClick={() => void handleSend()} disabled={sending || !summary?.providerConfigured} className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50">{sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}{sending ? 'Sending safely…' : deliveryInProgress ? 'Resume delivery' : 'Send newsletter'}</button>
          </div>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-slate-800 bg-white p-6 text-slate-800 shadow-xl">
            <p className="font-sans text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700">Email preview</p>
            {content.coverImageUrl && <img src={content.coverImageUrl} alt="" className="mt-5 max-h-56 w-full rounded-xl object-cover" />}
            <h3 className="mt-5 font-serif text-2xl font-bold">{content.heading || content.subject || 'Your newsletter heading'}</h3>
            <div className="mt-4 space-y-3 whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-600">{content.body || 'Write the email body to preview it here.'}</div>
            {content.ctaUrl && <span className="mt-6 inline-block rounded-lg bg-sky-700 px-4 py-2 text-xs font-bold text-white">{content.ctaLabel || 'Read / Purchase'}</span>}
            <p className="mt-7 border-t border-slate-200 pt-4 text-[10px] text-slate-500">Every delivered campaign includes a subscriber-specific unsubscribe link.</p>
          </div>

          <div className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
            <h2 className="font-serif text-lg font-bold text-white">Delivery history</h2>
            <div className="mt-3 space-y-2">
              {campaigns.length === 0 ? <p className="text-xs text-slate-500">No newsletters have been created yet.</p> : campaigns.slice(0, 8).map(campaign => (
                <div key={campaign.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-start justify-between gap-3"><span className="text-xs font-semibold text-slate-200">{campaign.content.subject}</span><span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase text-slate-400">{campaign.status.replace('_', ' ')}</span></div>
                  <p className="mt-2 text-[11px] text-slate-500">{campaign.sentCount} sent · {campaign.failedCount} failed · {new Date(campaign.createdAt).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="font-serif text-lg font-bold text-white">Subscriber directory</h2><p className="text-xs text-slate-500">Private writer-only contact and consent records.</p></div>
          <div className="flex flex-wrap gap-2">
            <label className="relative"><Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" /><input value={search} onChange={event => setSearch(event.target.value)} className="rounded-lg border border-slate-700 bg-[#080d17] py-2 pl-9 pr-3 text-xs text-white outline-none focus:border-sky-500" placeholder="Search name or email" /></label>
            <select value={status} onChange={event => setStatus(event.target.value as NewsletterSubscriberStatus | 'all')} className="rounded-lg border border-slate-700 bg-[#080d17] px-3 py-2 text-xs text-slate-200"><option value="all">All statuses</option><option value="active">Active</option><option value="pending">Pending</option><option value="unsubscribed">Unsubscribed</option><option value="suppressed">Suppressed</option></select>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-slate-800 font-mono uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-2">Select</th><th className="px-3 py-2">Reader</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Interests</th><th className="px-3 py-2">Subscribed</th></tr></thead>
            <tbody className="divide-y divide-slate-800/70">
              {subscribers.map(subscriber => <tr key={subscriber.id}><td className="px-3 py-3"><input type="checkbox" disabled={subscriber.status !== 'active' || deliveryInProgress} checked={selectedSubscriberIds.includes(subscriber.id)} onChange={() => toggleSubscriber(subscriber.id)} className="h-4 w-4 accent-sky-500" /></td><td className="px-3 py-3"><div className="font-medium text-slate-200">{subscriber.name || 'Unnamed reader'}</div><div className="text-[11px] text-slate-500">{subscriber.email}</div></td><td className="px-3 py-3"><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px] uppercase text-slate-300">{subscriber.status}</span></td><td className="max-w-xs px-3 py-3 text-slate-400">{subscriber.interests.join(', ') || 'All writing'}</td><td className="px-3 py-3 font-mono text-[11px] text-slate-500">{new Date(subscriber.subscribedAt).toLocaleString()}</td></tr>)}
            </tbody>
          </table>
          {!loading && subscribers.length === 0 && <p className="py-8 text-center text-xs text-slate-500">No subscribers match this filter.</p>}
        </div>
      </section>
    </div>
  );
};

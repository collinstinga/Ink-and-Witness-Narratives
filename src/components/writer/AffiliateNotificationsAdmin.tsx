import React, { useEffect, useMemo, useState } from 'react';
import { BellRing, CheckCircle2, ChevronDown, Eye, LockKeyhole, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import AffiliateNotificationOperations from './AffiliateNotificationOperations.js';
import type {
  AffiliateNotificationEligibilitySummary,
  LiteraryCircleNotificationEventType,
  LiteraryCircleNotificationSettings,
  LiteraryCircleNotificationTemplate,
} from '../../types.js';

interface AffiliateNotificationsAdminProps {
  settings: LiteraryCircleNotificationSettings;
  providerConfigured: boolean;
  saving?: boolean;
  checking?: boolean;
  onSave: (settings: LiteraryCircleNotificationSettings) => Promise<LiteraryCircleNotificationSettings>;
  onCheckEligibility: (
    eventType: LiteraryCircleNotificationEventType,
    settings: LiteraryCircleNotificationSettings,
  ) => Promise<AffiliateNotificationEligibilitySummary>;
}

const EVENT_META: Record<LiteraryCircleNotificationEventType, {
  label: string;
  description: string;
  placeholders: string[];
  marketing: boolean;
}> = {
  activation: {
    label: 'Literary Circle activation',
    description: 'Operational welcome after an explicit writer-approved activation.',
    placeholders: ['affiliateName', 'tierName', 'portalUrl'],
    marketing: false,
  },
  new_release: {
    label: 'New release',
    description: 'Optional catalogue announcement after the first publication of a piece.',
    placeholders: ['affiliateName', 'pieceTitle', 'pieceUrl'],
    marketing: true,
  },
  upcoming_campaign: {
    label: 'Upcoming campaign',
    description: 'Optional advance notice before a dated affiliate campaign begins.',
    placeholders: ['affiliateName', 'campaignName', 'campaignStartDate', 'portalUrl'],
    marketing: true,
  },
  new_commission: {
    label: 'New commission',
    description: 'Operational notice created only from a verified commission record.',
    placeholders: ['affiliateName', 'commissionAmount', 'pieceTitle', 'portalUrl'],
    marketing: false,
  },
  tier_upgrade: {
    label: 'Tier upgrade',
    description: 'Operational recognition after a confirmed upward tier change.',
    placeholders: ['affiliateName', 'tierName', 'portalUrl'],
    marketing: false,
  },
  inactivity_reminder: {
    label: 'Inactivity reminder',
    description: 'Optional invitation back after a configured quiet period and cooldown.',
    placeholders: ['affiliateName', 'portalUrl'],
    marketing: true,
  },
  exclusive_opportunity: {
    label: 'Exclusive opportunity',
    description: 'Optional notice for a newly published private partner opportunity.',
    placeholders: ['affiliateName', 'opportunityTitle', 'portalUrl'],
    marketing: true,
  },
};

const SAMPLE_CONTEXT: Record<string, string> = {
  affiliateName: 'Amina',
  tierName: 'Literary Ambassador',
  portalUrl: 'https://inkandwitness-narratives.co.ke/',
  pieceTitle: 'A New Ink & Witness Narrative',
  pieceUrl: 'https://inkandwitness-narratives.co.ke/read/sample',
  campaignName: 'October Reading Circle',
  campaignStartDate: '24 October 2026',
  commissionAmount: 'KES 150',
  opportunityTitle: 'Private release preview',
};

function cloneSettings(settings: LiteraryCircleNotificationSettings): LiteraryCircleNotificationSettings {
  return JSON.parse(JSON.stringify(settings));
}

function renderSample(value?: string): string {
  return (value || '').replace(/{{\s*([^{}]+?)\s*}}/g, (_match, token: string) => (
    SAMPLE_CONTEXT[token] || `{{${token}}}`
  ));
}

function reasonLabel(reason: string): string {
  return reason.replace(/_/g, ' ').replace(/^./, character => character.toUpperCase());
}

export const AffiliateNotificationsAdmin: React.FC<AffiliateNotificationsAdminProps> = ({
  settings,
  providerConfigured,
  saving = false,
  checking = false,
  onSave,
  onCheckEligibility,
}) => {
  const [draft, setDraft] = useState(() => cloneSettings(settings));
  const [expandedEvent, setExpandedEvent] = useState<LiteraryCircleNotificationEventType>('activation');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [eligibility, setEligibility] = useState<Record<string, AffiliateNotificationEligibilitySummary>>({});

  useEffect(() => {
    setDraft(cloneSettings(settings));
    setEligibility({});
  }, [settings.revision]);

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(settings), [draft, settings]);

  const updateTemplate = (
    eventType: LiteraryCircleNotificationEventType,
    update: (template: LiteraryCircleNotificationTemplate) => LiteraryCircleNotificationTemplate,
  ) => {
    setDraft(current => ({
      ...current,
      templates: current.templates.map(template => template.eventType === eventType ? update(template) : template),
    }));
    setEligibility(current => {
      const next = { ...current };
      delete next[eventType];
      return next;
    });
  };

  const save = async () => {
    setError('');
    setNotice('');
    const newlyEnabled = draft.templates.filter(candidate => (
      candidate.enabled && !settings.templates.find(original => original.eventType === candidate.eventType)?.enabled
    ));
    if (
      newlyEnabled.length
      && !window.confirm('Enable these templates for future event wiring? Delivery remains preview-only and no email will be sent now.')
    ) return;
    try {
      const saved = await onSave(draft);
      setDraft(cloneSettings(saved));
      setNotice('Partner notification templates saved in preview-only mode. No email was sent or queued.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Partner notification settings could not be saved.');
    }
  };

  const checkEligibility = async (eventType: LiteraryCircleNotificationEventType) => {
    setError('');
    setNotice('');
    try {
      const summary = await onCheckEligibility(eventType, draft);
      setEligibility(current => ({ ...current, [eventType]: summary }));
      setNotice('Eligibility was checked from current affiliate records. No email was sent or queued.');
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'Eligibility could not be checked.');
    }
  };

  return (
    <section
      className="space-y-5 rounded-2xl border border-violet-500/20 bg-[#080d1a] p-4 sm:p-6"
      aria-labelledby="partner-notifications-heading"
      aria-busy={saving || checking}
    >
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300">Literary Circle communications</p>
          <h3 id="partner-notifications-heading" className="mt-2 font-serif text-2xl font-bold text-white">Partner notifications</h3>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">
            Prepare event-specific copy, timing and audience filters without mixing affiliates into the reader newsletter list.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-950/30 px-3 py-2 text-xs font-semibold text-amber-100">
          <LockKeyhole className="h-4 w-4" /> Preview-only safety gate
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3 text-xs text-emerald-100">
          <ShieldCheck className="mb-2 h-4 w-4" />
          Writer approval, active status, valid email and accepted terms are mandatory and cannot be removed here.
        </div>
        <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-3 text-xs text-sky-100">
          <Eye className="mb-2 h-4 w-4" />
          Promotional events also require the affiliate’s separate marketing consent and category preference.
        </div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-950/20 p-3 text-xs text-violet-100">
          <BellRing className="mb-2 h-4 w-4" />
          Provider: {providerConfigured ? 'configured, but delivery locked' : 'not configured'}. Saving never sends a message.
        </div>
      </div>

      <label className="flex items-start gap-3 rounded-xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-200">
        <input
          type="checkbox"
          checked={draft.enabled}
          disabled={saving}
          onChange={event => setDraft(current => ({ ...current, enabled: event.target.checked }))}
          className="mt-0.5 h-4 w-4 accent-violet-500"
        />
        <span>
          <strong className="block text-white">Mark this configuration ready for later automation</strong>
          This flag does not activate delivery while mode is <code className="text-violet-200">preview_only</code>.
        </span>
      </label>

      <AffiliateNotificationOperations disabled={saving || checking || dirty} />

      {(notice || error) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-rose-500/40 bg-rose-950/40 text-rose-100' : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100'}`}>
          {error || notice}
        </div>
      )}

      <div className="space-y-3">
        {draft.templates.map(template => {
          const meta = EVENT_META[template.eventType];
          const expanded = template.eventType === expandedEvent;
          const summary = eligibility[template.eventType];
          return (
            <article key={template.eventType} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60">
              <button
                type="button"
                disabled={saving}
                onClick={() => setExpandedEvent(template.eventType)}
                aria-expanded={expanded}
                className="flex w-full items-center justify-between gap-4 p-4 text-left disabled:opacity-60"
              >
                <span>
                  <span className="flex flex-wrap items-center gap-2">
                    <strong className="text-sm text-white">{meta.label}</strong>
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${template.enabled ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-800 text-slate-400'}`}>
                      {template.enabled ? 'prepared' : 'disabled'}
                    </span>
                    {meta.marketing && <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-[9px] text-sky-200">consent required</span>}
                  </span>
                  <span className="mt-1 block text-xs text-slate-400">{meta.description}</span>
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
              </button>

              {expanded && (
                <div className="border-t border-white/10 p-4 sm:p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,.8fr)]">
                    <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
                      <label className="flex items-center gap-3 text-sm font-semibold text-slate-200">
                        <input
                          type="checkbox"
                          checked={template.enabled}
                          onChange={event => updateTemplate(template.eventType, current => ({ ...current, enabled: event.target.checked }))}
                          className="h-4 w-4 accent-violet-500"
                        />
                        Prepare this event template for future wiring
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label="Subject" value={template.subject} onChange={value => updateTemplate(template.eventType, current => ({ ...current, subject: value }))} />
                        <TextField label="Preheader" value={template.preheader} onChange={value => updateTemplate(template.eventType, current => ({ ...current, preheader: value }))} />
                      </div>
                      <TextField label="Heading" value={template.heading} onChange={value => updateTemplate(template.eventType, current => ({ ...current, heading: value }))} />
                      <label className="block text-xs font-semibold text-slate-300">
                        Body (plain text only)
                        <textarea
                          value={template.body}
                          maxLength={4000}
                          rows={6}
                          onChange={event => updateTemplate(template.eventType, current => ({ ...current, body: event.target.value }))}
                          className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-relaxed text-white outline-none focus:border-violet-500"
                        />
                      </label>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField label="CTA label (optional)" value={template.ctaLabel || ''} onChange={value => updateTemplate(template.eventType, current => ({ ...current, ctaLabel: value || undefined }))} />
                        <TextField label="CTA URL or internal path" value={template.ctaUrl || ''} onChange={value => updateTemplate(template.eventType, current => ({ ...current, ctaUrl: value || undefined }))} />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        <NumberField label="Delay after event (minutes)" value={template.timing.delayMinutes} min={0} max={10080} onChange={value => updateTemplate(template.eventType, current => ({ ...current, timing: { ...current.timing, delayMinutes: value } }))} />
                        {template.eventType === 'upcoming_campaign' && (
                          <NumberField label="Lead time (hours)" value={template.timing.leadTimeHours || 72} min={1} max={2160} onChange={value => updateTemplate(template.eventType, current => ({ ...current, timing: { ...current.timing, leadTimeHours: value } }))} />
                        )}
                        {template.eventType === 'inactivity_reminder' && (
                          <>
                            <NumberField label="Inactive for (days)" value={template.timing.inactivityDays || 30} min={7} max={365} onChange={value => updateTemplate(template.eventType, current => ({ ...current, timing: { ...current.timing, inactivityDays: value } }))} />
                            <NumberField label="Reminder cooldown (days)" value={template.timing.cooldownDays || 30} min={7} max={365} onChange={value => updateTemplate(template.eventType, current => ({ ...current, timing: { ...current.timing, cooldownDays: value } }))} />
                          </>
                        )}
                      </div>

                      {template.eventType === 'inactivity_reminder' && (
                        <p className="rounded-xl border border-amber-400/30 bg-amber-950/30 p-3 text-xs leading-relaxed text-amber-100">
                          Inactivity reminders never suspend an account, revoke access, change a tier, or disable a referral link.
                        </p>
                      )}

                      <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3">
                        <p className="text-xs font-semibold text-white">Additional audience filters</p>
                        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={template.eligibility.foundingMembersOnly} onChange={event => updateTemplate(template.eventType, current => ({ ...current, eligibility: { ...current.eligibility, foundingMembersOnly: event.target.checked } }))} className="accent-violet-500" />
                          Founding members only
                        </label>
                        <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
                          <input type="checkbox" checked={template.eligibility.requireComplimentaryAccess} onChange={event => updateTemplate(template.eventType, current => ({ ...current, eligibility: { ...current.eligibility, requireComplimentaryAccess: event.target.checked } }))} className="accent-violet-500" />
                          Require active complimentary catalogue access
                        </label>
                        <label className="mt-3 block text-xs text-slate-300">
                          Tier IDs (comma-separated; blank means all)
                          <input
                            value={template.eligibility.tierIds.join(', ')}
                            onChange={event => updateTemplate(template.eventType, current => ({
                              ...current,
                              eligibility: {
                                ...current.eligibility,
                                tierIds: event.target.value.split(',').map(value => value.trim().toLowerCase()).filter(Boolean),
                              },
                            }))}
                            className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
                            placeholder="literary-ambassador, literary-patron"
                          />
                          <span className="mt-2 block leading-relaxed text-slate-400">
                            General tier-targeted messages currently require a verified manual tier assignment.
                            Automatic performance tiers are not inferred from stored profile labels.
                            Confirmed tier-upgrade notices use their separately verified milestone.
                          </span>
                        </label>
                      </div>

                      <p className="text-[11px] leading-relaxed text-slate-500">
                        Allowed placeholders: {meta.placeholders.map(token => `{{${token}}}`).join(', ')}
                      </p>
                    </fieldset>

                    <aside className="space-y-3">
                      <div className="rounded-2xl border border-violet-500/20 bg-white p-5 text-slate-900 shadow-xl">
                        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-700">Ink &amp; Witness Narratives</p>
                        <p className="mt-4 text-xs text-slate-500">{renderSample(template.preheader)}</p>
                        <h4 className="mt-3 font-serif text-2xl font-bold">{renderSample(template.heading)}</h4>
                        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-700">{renderSample(template.body)}</p>
                        {template.ctaLabel && template.ctaUrl && (
                          <span className="mt-5 inline-flex rounded-lg bg-sky-700 px-4 py-2 text-sm font-bold text-white">{renderSample(template.ctaLabel)}</span>
                        )}
                        <p className="mt-5 border-t border-slate-200 pt-4 text-xs italic text-slate-500">Stay close to the ink.</p>
                      </div>

                      <button
                        type="button"
                        disabled={saving || checking}
                        onClick={() => void checkEligibility(template.eventType)}
                        className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-500/40 bg-violet-950/40 px-4 py-2.5 text-sm font-semibold text-violet-100 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
                        Check current eligibility
                      </button>
                      {summary && (
                        <div className="rounded-xl border border-white/10 bg-slate-900/70 p-3 text-xs text-slate-300">
                          <p><strong className="text-emerald-300">{summary.eligible}</strong> eligible · {summary.excluded} excluded · {summary.total} total</p>
                          {!!Object.keys(summary.reasons).length && (
                            <ul className="mt-2 space-y-1 text-[11px] text-slate-400">
                              {Object.entries(summary.reasons).map(([reason, count]) => <li key={reason}>{reasonLabel(reason)}: {count}</li>)}
                            </ul>
                          )}
                        </div>
                      )}
                    </aside>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <footer className="flex flex-col-reverse gap-3 border-t border-white/10 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-mono text-[10px] text-slate-500">Revision {draft.revision}. {dirty ? 'Unsaved changes are waiting.' : 'All template changes are saved.'}</p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => { setDraft(cloneSettings(settings)); setEligibility({}); setError(''); setNotice('Unsaved notification changes were discarded.'); }}
            className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-300 disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={() => void save()}
            className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
          >
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? 'Saving…' : dirty ? 'Save preview settings' : 'Saved'}
          </button>
        </div>
      </footer>
    </section>
  );
};

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
      />
    </label>
  );
}

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="block text-xs font-semibold text-slate-300">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        onChange={event => onChange(Number(event.target.value))}
        className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-500"
      />
    </label>
  );
}

export default AffiliateNotificationsAdmin;

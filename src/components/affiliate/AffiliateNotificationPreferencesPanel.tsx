import React, { useEffect, useState } from 'react';
import { BellRing, CheckCircle2, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AffiliateNotificationPreferences } from '../../types.js';
import { api } from '../../utils/api.js';

interface PreferenceDraft {
  marketingConsent: boolean;
  releaseUpdates: boolean;
  campaignUpdates: boolean;
  inactivityReminders: boolean;
  exclusiveOpportunities: boolean;
  commissionAlerts: boolean;
  tierAlerts: boolean;
}

export function affiliatePreferencesToDraft(preferences: AffiliateNotificationPreferences): PreferenceDraft {
  return {
    marketingConsent: preferences.marketingConsent === 'granted' && !preferences.allMarketingOptOut,
    releaseUpdates: preferences.releaseUpdates,
    campaignUpdates: preferences.campaignUpdates,
    inactivityReminders: preferences.inactivityReminders,
    exclusiveOpportunities: preferences.exclusiveOpportunities,
    commissionAlerts: preferences.commissionAlerts,
    tierAlerts: preferences.tierAlerts,
  };
}

const EMPTY_DRAFT: PreferenceDraft = {
  marketingConsent: false,
  releaseUpdates: false,
  campaignUpdates: false,
  inactivityReminders: false,
  exclusiveOpportunities: false,
  commissionAlerts: true,
  tierAlerts: true,
};

export const AffiliateNotificationPreferencesPanel: React.FC = () => {
  const [preferences, setPreferences] = useState<AffiliateNotificationPreferences | null>(null);
  const [draft, setDraft] = useState<PreferenceDraft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.getAffiliateNotificationPreferences();
      setPreferences(response.preferences);
      setDraft(affiliatePreferencesToDraft(response.preferences));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Notification preferences could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!preferences) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const response = await api.updateAffiliateNotificationPreferences({
        expectedRevision: preferences.revision,
        ...draft,
      });
      setPreferences(response.preferences);
      setDraft(affiliatePreferencesToDraft(response.preferences));
      setNotice(response.message);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Notification preferences could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div role="status" className="flex min-h-48 items-center justify-center gap-2 rounded-2xl border border-violet-500/20 bg-slate-900/80 text-sm text-violet-200">
        <RefreshCw className="h-4 w-4 animate-spin" /> Loading communication preferences…
      </div>
    );
  }

  if (!preferences) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-950/20 p-5 text-sm text-rose-100">
        <p>{error || 'Communication preferences are unavailable.'}</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-xl border border-rose-300/30 px-4 py-2 text-xs font-bold">Retry</button>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-violet-500/20 bg-slate-900/80 p-5" aria-labelledby="affiliate-notification-preferences-heading" aria-busy={saving}>
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-2 text-violet-200"><BellRing className="h-5 w-5" /></div>
        <div>
          <h3 id="affiliate-notification-preferences-heading" className="font-serif text-base font-bold text-white">Email &amp; communication choices</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Choose the Literary Circle updates you want. These choices are separate from programme terms and can be changed free of charge at any time.</p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-400/25 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">
        <ShieldCheck className="mr-1 inline h-4 w-4" /> Delivery is still disabled during the safety rollout. Saving records your choices but sends no email now.
      </div>

      {(error || notice) && (
        <div
          role={error ? 'alert' : 'status'}
          aria-live={error ? 'assertive' : 'polite'}
          className={`mt-4 rounded-xl border p-3 text-xs ${error ? 'border-rose-500/30 bg-rose-950/30 text-rose-100' : 'border-emerald-500/30 bg-emerald-950/30 text-emerald-100'}`}
        >
          {error || notice}
        </div>
      )}

      <fieldset disabled={saving} className="mt-4 space-y-4 disabled:opacity-60">
        <label className="flex items-start gap-3 rounded-xl border border-sky-500/25 bg-sky-950/20 p-4 text-xs leading-relaxed text-sky-50">
          <input
            type="checkbox"
            checked={draft.marketingConsent}
            onChange={event => setDraft(current => ({
              ...current,
              marketingConsent: event.target.checked,
              ...(!event.target.checked ? {
                releaseUpdates: false,
                campaignUpdates: false,
                inactivityReminders: false,
                exclusiveOpportunities: false,
              } : {}),
            }))}
            className="mt-0.5 h-4 w-4 accent-sky-500"
          />
          <span>
            <strong className="block text-sky-100">I voluntarily agree to receive optional Literary Circle release, campaign, re-engagement and opportunity emails.</strong>
            This is not required to remain an affiliate, keep referral links, receive catalogue access, or earn commissions. Unchecking it opts out of all optional marketing.
          </span>
        </label>

        <div className="grid gap-2 sm:grid-cols-2">
          <PreferenceToggle label="New releases" checked={draft.releaseUpdates} disabled={!draft.marketingConsent} onChange={value => setDraft(current => ({ ...current, releaseUpdates: value }))} />
          <PreferenceToggle label="Upcoming campaigns" checked={draft.campaignUpdates} disabled={!draft.marketingConsent} onChange={value => setDraft(current => ({ ...current, campaignUpdates: value }))} />
          <PreferenceToggle label="Inactivity reminders" checked={draft.inactivityReminders} disabled={!draft.marketingConsent} onChange={value => setDraft(current => ({ ...current, inactivityReminders: value }))} />
          <PreferenceToggle label="Exclusive opportunities" checked={draft.exclusiveOpportunities} disabled={!draft.marketingConsent} onChange={value => setDraft(current => ({ ...current, exclusiveOpportunities: value }))} />
        </div>

        <div className="border-t border-slate-800 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Operational account alerts</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <PreferenceToggle label="New commission alerts" checked={draft.commissionAlerts} onChange={value => setDraft(current => ({ ...current, commissionAlerts: value }))} />
            <PreferenceToggle label="Tier upgrade alerts" checked={draft.tierAlerts} onChange={value => setDraft(current => ({ ...current, tierAlerts: value }))} />
          </div>
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-50"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {saving ? 'Saving choices…' : 'Save communication choices'}
        </button>
      </fieldset>
    </section>
  );
};

function PreferenceToggle({
  label,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-center gap-2 rounded-xl border border-slate-700/80 bg-slate-950/60 p-3 text-xs text-slate-200 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="h-4 w-4 accent-violet-500" />
      {label}
    </label>
  );
}

export default AffiliateNotificationPreferencesPanel;

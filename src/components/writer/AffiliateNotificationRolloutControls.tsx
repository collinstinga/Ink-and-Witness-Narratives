import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  ProductionAffiliateNotificationReviewRequest,
  ProductionAffiliateNotificationRolloutStatus,
  ProductionAffiliateNotificationTestStatus,
} from '../../types.js';
import { api } from '../../utils/api.js';

type Action = 'review' | 'test' | 'pause';
const STATUS_LABELS: Record<ProductionAffiliateNotificationRolloutStatus['status'], string> = {
  disabled: 'Production notifications are off in this environment.',
  blocked: 'A server safety gate or review mismatch blocks sending. A new review is still checked by the server.',
  unreviewed: 'No production review has been approved.',
  paused: 'Production review is paused.',
  expired: 'The review expired. Sending requires a fresh review.',
  settings_changed: 'Saved templates changed. Sending requires a fresh review of those settings.',
  ready: 'The current review is valid. Sending still depends on server safety and recipient eligibility checks.',
};
const TEST_LABELS: Record<ProductionAffiliateNotificationTestStatus, string> = {
  accepted: 'The provider accepted the owner-only test. This is not proof of delivery; refresh after the signed delivery receipt arrives.',
  already_processed: 'This review already has a test attempt. Refresh to inspect its delivery status; no duplicate was sent.',
  blocked: 'The server blocked the owner-only test. No affiliate or customer test audience was selected.',
  ineligible: 'The owner-only test is not currently eligible. Refresh the review before trying again.',
  failed: 'The test could not be confirmed. Refresh its status before trying again; it may already have started.',
};

export function affiliateNotificationRolloutAvailability(
  status: ProductionAffiliateNotificationRolloutStatus | null, locked = false,
) {
  const available = !locked && Boolean(status?.environmentMode) && status?.status !== 'disabled';
  return {
    review: available && status?.reviewAvailable === true,
    test: available && status?.status === 'ready' && status.mode === 'production_test'
      && status.environmentMode === 'production_test' && status.testRecipientConfigured && !status.testDeliveryStatus,
    pause: available && Boolean(status && status.revision > 0) && status?.status !== 'paused',
  };
}

/** A click is never authority: all revisions, recipients and safety gates are rechecked by the server. */
export async function requestAffiliateNotificationRolloutAction(input: {
  action: Action;
  status: ProductionAffiliateNotificationRolloutStatus | null;
  locked: boolean;
  durationDays: number;
  includeFoundingWelcome: boolean;
  confirm: (message: string) => boolean;
  review: (request: ProductionAffiliateNotificationReviewRequest) => Promise<unknown>;
  test: () => Promise<unknown>;
  pause: (revision: number) => Promise<unknown>;
}): Promise<unknown | null> {
  if (!affiliateNotificationRolloutAvailability(input.status, input.locked)[input.action] || !input.status) return null;
  if (input.action === 'review') {
    if (!Number.isSafeInteger(input.durationDays) || input.durationDays < 1
      || input.durationDays > Math.min(30, input.status.maximumReviewDays) || !input.status.environmentMode
      || input.status.environmentMode === 'production_test' && input.includeFoundingWelcome) return null;
    const live = input.status.environmentMode === 'production_live';
    const message = live
      ? `Approve a live notification review for ${input.durationDays} days? Eligible affiliates may receive bounded, separately dispatched messages. A signed delivered owner-only test is required. ${input.includeFoundingWelcome ? 'This also opts the nine original founding partners into one upgrade welcome each.' : 'Founding upgrade welcomes are not included.'}`
      : `Approve an owner-only test review for ${input.durationDays} days? This does not send an email or enable affiliate/customer delivery. The only possible test recipient is the separately approved server-configured owner address.`;
    if (!input.confirm(message)) return null;
    return input.review({ expectedRevision: input.status.revision, mode: input.status.environmentMode,
      durationDays: input.durationDays, includeFoundingWelcome: input.includeFoundingWelcome });
  }
  if (input.action === 'test') {
    if (!input.confirm('Send one controlled test to the separately approved server-configured owner address? No affiliate or customer announcements will be sent. Provider acceptance is not delivered proof.')) return null;
    return input.test();
  }
  if (!input.confirm('Pause this production notification review? Historical emails, accounts and earnings will not be changed.')) return null;
  return input.pause(input.status.revision);
}

interface ViewProps {
  status: ProductionAffiliateNotificationRolloutStatus | null;
  loading?: boolean;
  busy?: Action | null;
  disabled?: boolean;
  error?: string;
  notice?: string;
  duration: string;
  includeFoundingWelcome: boolean;
  onDuration: (value: string) => void;
  onFoundingWelcome: (value: boolean) => void;
  onRefresh: () => void;
  onAction: (action: Action) => void;
}

export function AffiliateNotificationRolloutControlsView({ status, loading = false, busy = null, disabled = false,
  error = '', notice = '', duration, includeFoundingWelcome, onDuration, onFoundingWelcome, onRefresh, onAction }: ViewProps) {
  const locked = loading || Boolean(busy) || disabled || Boolean(error);
  const availability = affiliateNotificationRolloutAvailability(status, locked);
  const live = status?.environmentMode === 'production_live';
  const maximum = Math.min(30, status?.maximumReviewDays || 30);
  const validDuration = /^\d{1,2}$/.test(duration) && Number(duration) >= 1 && Number(duration) <= maximum;
  const delivery = status?.testDeliveryStatus;
  // Whitelist labels: a future/raw server value must never render as a private identifier.
  const deliveryLabel = delivery && ({ accepted: 'Provider accepted', delivered: 'Delivered receipt verified', sent: 'Provider sent',
    dispatching: 'Dispatching', leased: 'Reserved for test', failed: 'Failed', bounced: 'Bounced', complained: 'Complaint received',
    suppressed: 'Suppressed', cancelled: 'Cancelled', needs_investigation: 'Needs investigation — do not blindly retry' } as Record<string, string>)[delivery];
  return <section aria-labelledby="affiliate-notification-rollout-heading" aria-busy={loading || Boolean(busy)}
    className="rounded-2xl border border-amber-300/20 bg-slate-950/60 p-4">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h4 id="affiliate-notification-rollout-heading" className="flex items-center gap-2 font-serif text-lg font-semibold text-white">
        <ShieldCheck aria-hidden="true" className="h-4 w-4 text-amber-200" /> Production notification review
      </h4><p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Saving templates never enables sending. Production is default-off, with a separate time-limited review and server-enforced safety gates. There is no automatic approval or background polling.</p></div>
      <button type="button" onClick={onRefresh} disabled={loading || Boolean(busy)}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-200 disabled:opacity-40">
        <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Checking review…' : 'Refresh review'}
      </button>
    </header>
    <div className="mt-3 text-xs leading-relaxed" aria-live="polite" aria-atomic="true">
      {error ? <p role="alert" className="text-rose-200">{error}</p> : status
        ? <p className="text-amber-100">{STATUS_LABELS[status.status] || 'Refresh to check the current review.'}</p>
        : <p className="text-slate-400">Check the server review before taking an action.</p>}
      {notice ? <p role="status" className="mt-2 text-cyan-100">{notice}</p> : null}
    </div>
    {status ? <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
      <div><dt className="text-slate-400">Server mode</dt><dd className="mt-1 text-slate-100">{status.environmentMode === 'production_test' ? 'Owner-only controlled test' : live ? 'Live mode — separate valid review required' : 'Off or unavailable'}</dd></div>
      <div><dt className="text-slate-400">Review revision</dt><dd className="mt-1 text-slate-100">{Number.isSafeInteger(status.revision) && status.revision >= 0 ? status.revision : 'Unavailable'}</dd></div>
      {delivery ? <div><dt className="text-slate-400">Owner-only test delivery</dt><dd className="mt-1 text-slate-100">{deliveryLabel || 'Status requires review'}</dd></div> : null}
      {status.expiresAt ? <div><dt className="text-slate-400">Review expiry</dt><dd className="mt-1 break-words text-slate-100">{status.expiresAt}</dd></div> : null}
    </dl> : null}
    <p className="mt-3 text-xs leading-relaxed text-slate-400">Live review requires a signed provider delivery receipt for the approved owner-only test. You cannot choose recipients, transport credentials or server time here. Test messages never go to affiliates or customers. Accepted by the provider does not mean delivered.</p>
    <div className="mt-4 flex flex-col gap-3">
      <label className="text-xs font-semibold text-slate-200" htmlFor="affiliate-notification-review-days">Review duration (1–{maximum} days)
        <input id="affiliate-notification-review-days" type="number" min="1" max={maximum} step="1" inputMode="numeric"
          value={duration} onChange={event => onDuration(event.target.value)} disabled={locked}
          className="mt-2 block min-h-11 w-full max-w-40 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white disabled:opacity-40" />
      </label>
      {live ? <label className="flex items-start gap-3 text-xs leading-relaxed text-slate-200">
        <input type="checkbox" checked={includeFoundingWelcome} disabled={locked} onChange={event => onFoundingWelcome(event.target.checked)} className="mt-0.5 h-4 w-4" />
        Explicitly include one upgrade welcome for each of the nine original founding partners. Existing identities and financial records remain unchanged; consent and eligibility checks still apply.
      </label> : null}
    </div>
    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <button type="button" onClick={() => onAction('review')} disabled={!availability.review || !validDuration}
        className="min-h-11 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 text-xs font-semibold text-amber-100 disabled:opacity-40">
        {busy === 'review' ? 'Checking review approval…' : live ? 'Approve time-limited live review' : 'Approve owner-only test review'}
      </button>
      <button type="button" onClick={() => onAction('test')} disabled={!availability.test}
        className="min-h-11 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 text-xs font-semibold text-cyan-100 disabled:opacity-40">
        {busy === 'test' ? 'Checking owner-only test…' : 'Send approved owner-only test'}
      </button>
      <button type="button" onClick={() => onAction('pause')} disabled={!availability.pause}
        className="min-h-11 rounded-xl border border-slate-700 px-4 text-xs font-semibold text-slate-200 disabled:opacity-40">
        {busy === 'pause' ? 'Pausing review…' : 'Pause production review'}
      </button>
    </div>
    {disabled ? <p className="mt-2 text-xs text-slate-400">Save pending template changes and wait for current checks before approving a review or sending a test.</p> : null}
  </section>;
}

export default function AffiliateNotificationRolloutControls({ disabled = false, onChange }: { disabled?: boolean; onChange?: () => void }) {
  const [status, setStatus] = useState<ProductionAffiliateNotificationRolloutStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [duration, setDuration] = useState('7');
  const [includeFoundingWelcome, setIncludeFoundingWelcome] = useState(false);
  const mounted = useRef(false);
  const running = useRef(false);
  const loadingRef = useRef(true);
  const requestId = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const actionController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (running.current) return;
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const id = ++requestId.current;
    loadingRef.current = true; setLoading(true); setError(''); setNotice('');
    try {
      const response = await api.getAdminAffiliateNotificationRollout({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted && id === requestId.current) setStatus(response.rollout);
    } catch {
      if (mounted.current && !controller.signal.aborted && id === requestId.current) {
        setStatus(null); setError('The production review could not be checked. Refresh manually before taking an action.');
      }
    } finally {
      if (mounted.current && !controller.signal.aborted && id === requestId.current) {
        loadingRef.current = false; setLoading(false);
      }
    }
  }, []);
  useEffect(() => {
    mounted.current = true; void refresh();
    return () => { mounted.current = false; requestId.current++; readController.current?.abort(); actionController.current?.abort(); };
  }, [refresh]);
  const act = async (action: Action) => {
    if (running.current || loadingRef.current || disabled || error) return;
    running.current = true;
    readController.current?.abort();
    const controller = new AbortController(); actionController.current = controller;
    const id = ++requestId.current;
    try {
      const options = { signal: controller.signal };
      const response = await requestAffiliateNotificationRolloutAction({ action, status, locked: disabled,
        durationDays: Number(duration), includeFoundingWelcome: status?.environmentMode === 'production_live' && includeFoundingWelcome,
        confirm: message => window.confirm(message),
        review: request => { setBusy('review'); return api.updateAdminAffiliateNotificationRollout(request, options); },
        test: () => { setBusy('test'); return api.testAdminAffiliateNotificationRollout(options); },
        pause: revision => { setBusy('pause'); return api.pauseAdminAffiliateNotificationRollout(revision, options); },
      }) as { rollout: ProductionAffiliateNotificationRolloutStatus; result?: { status: ProductionAffiliateNotificationTestStatus } } | null;
      if (mounted.current && !controller.signal.aborted && id === requestId.current && response) {
        setStatus(response.rollout);
        setNotice(response.result ? TEST_LABELS[response.result.status] || 'Refresh to check the test outcome.'
          : action === 'pause' ? 'Pause recorded. No historical emails or financial records were changed.'
            : 'Review recorded. Review approval itself did not send email.');
        onChange?.();
      }
    } catch {
      if (mounted.current && !controller.signal.aborted && id === requestId.current) {
        setError('This action was not confirmed, or the review revision changed. Refresh manually, inspect the current state, then explicitly retry. A test may already have started.');
      }
    } finally {
      running.current = false;
      if (mounted.current && !controller.signal.aborted && id === requestId.current) setBusy(null);
    }
  };
  return <AffiliateNotificationRolloutControlsView status={status} loading={loading} busy={busy} disabled={disabled}
    error={error} notice={notice} duration={duration} includeFoundingWelcome={includeFoundingWelcome}
    onDuration={setDuration} onFoundingWelcome={setIncludeFoundingWelcome} onRefresh={() => void refresh()} onAction={action => void act(action)} />;
}

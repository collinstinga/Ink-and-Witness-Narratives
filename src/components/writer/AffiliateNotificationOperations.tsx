import React, { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, ShieldCheck } from 'lucide-react';
import type {
  AffiliateNotificationRuntimeMode,
  AffiliateNotificationRuntimeResult,
  AffiliateNotificationRuntimeStatus,
} from '../../types.js';
import { api } from '../../utils/api.js';

const COUNT_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['leased', 'Leased'], ['dispatching', 'Dispatching'], ['retry_pending', 'Waiting for retry'],
  ['accepted', 'Provider accepted'], ['delivered', 'Delivered'], ['bounced', 'Bounced'],
  ['complained', 'Complaints'], ['suppressed', 'Suppressed'], ['failed', 'Failed'],
  ['dead_letter', 'Needs investigation'], ['cancelled', 'Cancelled'],
  ['created', 'Held records created'], ['existing', 'Already prepared'],
  ['ineligible', 'Ineligible'], ['not_due', 'Not due'], ['busy', 'Busy'],
  ['already_processed', 'Already processed'], ['invalid_record', 'Invalid records'],
  ['disabled', 'Disabled'], ['blocked', 'Blocked'],
];

const RESULT_LABELS: Record<AffiliateNotificationRuntimeResult['status'], string> = {
  completed: 'Bounded staging job completed.', disabled: 'The staging job is disabled.',
  blocked: 'Safety gates blocked the staging job.', busy: 'Another staging job is already running.',
  overflow: 'The dataset exceeds the reviewed batch limits. No oversized audience was processed.',
  invalid: 'The staging job request was not accepted.', conflict: 'A safety conflict needs investigation before retrying.',
  failed: 'The staging job could not complete. Check operations before retrying.',
};

const DISPATCH_CONFIRMATION = 'Send this bounded staging test to the separately reviewed allowlist? Every message is rechecked before sending. This does not enable production email.';

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function affiliateNotificationOperationAvailability(
  runtime: AffiliateNotificationRuntimeStatus | null,
  locked = false,
): { prepare: boolean; dispatch: boolean } {
  const ready = !locked && runtime?.status === 'ready' && runtime.cursor?.busy !== true;
  return { prepare: ready, dispatch: ready && runtime?.deliveryGate === 'allowed' };
}

/** The event boundary enforces the same gates as the buttons. Server checks are
 * still authoritative; a stale browser snapshot can never authorize delivery. */
export async function requestAffiliateNotificationOperation(input: {
  mode: AffiliateNotificationRuntimeMode;
  runtime: AffiliateNotificationRuntimeStatus | null;
  locked: boolean;
  confirmDispatch: (message: string) => boolean;
  run: (mode: AffiliateNotificationRuntimeMode) => Promise<{ success: boolean; result: AffiliateNotificationRuntimeResult }>;
}): Promise<AffiliateNotificationRuntimeResult | null> {
  if (!affiliateNotificationOperationAvailability(input.runtime, input.locked)[input.mode]) return null;
  if (input.mode === 'dispatch' && !input.confirmDispatch(DISPATCH_CONFIRMATION)) return null;
  return (await input.run(input.mode)).result;
}

function AggregateCounts({ values }: { values: Record<string, number> }) {
  const entries = COUNT_LABELS.filter(([key]) => count(values[key]) > 0);
  return entries.length ? (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
      {entries.map(([key, label]) => <div key={key}><dt className="inline text-slate-400">{label}: </dt><dd className="inline font-semibold text-slate-100">{count(values[key]).toLocaleString('en-KE')}</dd></div>)}
    </dl>
  ) : <p className="mt-3 text-xs text-slate-400">No outcomes in this bounded snapshot.</p>;
}

interface OperationsViewProps {
  runtime: AffiliateNotificationRuntimeStatus | null;
  loading?: boolean;
  busy?: AffiliateNotificationRuntimeMode | null;
  disabled?: boolean;
  error?: string;
  result?: AffiliateNotificationRuntimeResult | null;
  onRefresh: () => void;
  onRun: (mode: AffiliateNotificationRuntimeMode) => void;
}

export function AffiliateNotificationOperationsView({
  runtime, loading = false, busy = null, disabled = false, error = '', result = null, onRefresh, onRun,
}: OperationsViewProps) {
  const availability = affiliateNotificationOperationAvailability(runtime, loading || Boolean(busy) || disabled || Boolean(error));
  const snapshotReady = runtime?.status === 'ready';
  return (
    <section aria-labelledby="affiliate-notification-operations-heading" aria-busy={loading || Boolean(busy)}
      className="rounded-2xl border border-cyan-400/20 bg-slate-950/60 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 id="affiliate-notification-operations-heading" className="flex items-center gap-2 font-serif text-lg font-semibold text-white">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-cyan-300" /> Notification operations
          </h4>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Production sending remains blocked. Preparing held intents does not send email. Dispatch is limited to an explicitly reviewed staging test allowlist.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading || Boolean(busy)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-3 text-xs font-semibold text-slate-200 disabled:opacity-40">
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {loading ? 'Checking operations…' : 'Refresh operations'}
        </button>
      </header>

      <div className="mt-3 text-xs leading-relaxed" aria-live="polite" aria-atomic="true">
        {error ? <p role="alert" className="text-rose-200">{error}</p>
          : !runtime ? <p className="text-slate-400">Check operations before running a staging job.</p>
            : !snapshotReady ? <p className="text-amber-100">{runtime.status === 'disabled'
              ? 'Notification jobs are off in this environment. No operational records were queried.'
              : runtime.status === 'blocked' ? 'This environment has not passed the staging safety gates. Jobs cannot run here.'
                : 'Operations could not be checked. Refresh before running a staging job.'}</p>
              : <p className="text-cyan-100">Staging preparation is available. {runtime.deliveryGate === 'allowed'
                ? 'A separate reviewed staging delivery gate is open.' : 'Delivery remains locked until its separate staging review is valid.'}
                {runtime.cursor?.busy ? ' A delivery job is currently running.' : ''}</p>}
      </div>

      {snapshotReady && runtime ? (
        <div className="mt-3 rounded-xl border border-slate-800 p-3">
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div><dt className="text-slate-400">Held intent records</dt><dd className="mt-1 font-semibold text-white">{count(runtime.preparedIntents).toLocaleString('en-KE')}{runtime.truncated.intents ? '+' : ''}</dd></div>
            <div><dt className="text-slate-400">Delivery records sampled</dt><dd className="mt-1 font-semibold text-white">{count(runtime.sampledDeliveries).toLocaleString('en-KE')}{runtime.truncated.deliveries ? '+' : ''}</dd></div>
          </dl>
          <AggregateCounts values={runtime.counts} />
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">{runtime.truncated.deliveries || runtime.truncated.intents
            ? 'Partial snapshot: limits were reached; these are not complete totals.'
            : 'Bounded snapshot, not a full financial or email-delivery audit.'} Held intents also include previously processed records; this is not the remaining-send queue.</p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" disabled={!availability.prepare} onClick={() => onRun('prepare')}
          className="min-h-11 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-4 text-xs font-semibold text-cyan-100 disabled:opacity-40">
          {busy === 'prepare' ? 'Preparing held records…' : 'Prepare staging intents'}
        </button>
        <button type="button" disabled={!availability.dispatch} onClick={() => onRun('dispatch')}
          className="min-h-11 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 text-xs font-semibold text-amber-100 disabled:opacity-40">
          {busy === 'dispatch' ? 'Running reviewed staging test…' : 'Dispatch reviewed staging test'}
        </button>
      </div>
      {disabled ? <p className="mt-2 text-xs text-slate-400">Save pending template changes and wait for current checks before running a job.</p> : null}
      {snapshotReady && runtime ? <p className="mt-2 text-[11px] text-slate-500">Each run is bounded to {count(runtime.limits.preparedSourcesPerRun)} sources or {count(runtime.limits.dispatchedIntentsPerRun)} delivery attempts. Refresh is manual; there is no background polling.</p> : null}

      {result ? (
        <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-slate-700 p-3 text-xs">
          <p className="font-semibold text-slate-100">{RESULT_LABELS[result.status] || 'The staging job returned an unrecognized outcome.'}</p>
          <p className="mt-1 text-slate-400">Scanned {count(result.scanned)} · attempted {count(result.attempted)} · held intents {count(result.intentCount)}.</p>
          <AggregateCounts values={result.counts} />
          {result.hasMore ? <p className="mt-2 text-amber-100">More records remain beyond this bounded run. Review the result before another run.</p> : null}
        </div>
      ) : null}
    </section>
  );
}

export default function AffiliateNotificationOperations({ disabled = false }: { disabled?: boolean }) {
  const [runtime, setRuntime] = useState<AffiliateNotificationRuntimeStatus | null>(null);
  const [result, setResult] = useState<AffiliateNotificationRuntimeResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<AffiliateNotificationRuntimeMode | null>(null);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const loadingRef = useRef(true);
  const running = useRef(false);
  const requestId = useRef(0);
  const readController = useRef<AbortController | null>(null);
  const runController = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    const id = ++requestId.current;
    loadingRef.current = true; setLoading(true); setError('');
    try {
      const response = await api.getAdminAffiliateNotificationRuntime({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted && id === requestId.current) setRuntime(response.runtime);
    } catch {
      if (mounted.current && !controller.signal.aborted && id === requestId.current) {
        setRuntime(null); setError('Operations could not be checked. Refresh before running a staging job.');
      }
    } finally {
      if (mounted.current && !controller.signal.aborted && id === requestId.current) {
        loadingRef.current = false; setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true; void refresh();
    return () => {
      mounted.current = false; requestId.current++;
      readController.current?.abort(); runController.current?.abort();
    };
  }, [refresh]);

  const run = async (mode: AffiliateNotificationRuntimeMode) => {
    if (running.current || loadingRef.current || disabled || error) return;
    running.current = true;
    const controller = new AbortController(); runController.current = controller;
    try {
      const next = await requestAffiliateNotificationOperation({
        mode, runtime, locked: disabled, confirmDispatch: message => window.confirm(message),
        run: async requestedMode => {
          setBusy(requestedMode); setError('');
          return api.runAdminAffiliateNotificationRuntime(requestedMode, { signal: controller.signal });
        },
      });
      if (mounted.current && !controller.signal.aborted && next) { setResult(next); await refresh(); }
    } catch {
      if (mounted.current && !controller.signal.aborted) {
        setError('The staging job could not be confirmed. Refresh operations before retrying; it may already have started.');
      }
    } finally {
      running.current = false;
      if (mounted.current && !controller.signal.aborted) setBusy(null);
    }
  };

  return <AffiliateNotificationOperationsView runtime={runtime} loading={loading} busy={busy} disabled={disabled}
    result={result} error={error} onRefresh={() => void refresh()} onRun={mode => void run(mode)} />;
}

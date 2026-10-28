import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api.js';
import type { WriterAccountRecoveryIssue, WriterAccountSecurityStatus } from '../../utils/api.js';

export function canRequestWriterRecovery(status: WriterAccountSecurityStatus | null, approved: boolean, busy: boolean): boolean {
  return !busy && approved && status?.status === 'ready' && status.canIssue === true;
}

export function writerSecurityDescription(status: WriterAccountSecurityStatus | null): string {
  switch (status?.status) {
    case 'review_required': return 'A fresh reviewed backup and account-preservation check are required before recovery can be requested. Your current login is unchanged.';
    case 'ready': return 'The required backup and account-preservation review are ready. You may request a one-use recovery email. Recovery preserves the reviewed purchase-owning account when duplicates exist.';
    case 'pending': return 'A recovery link is already pending. Check the approved owner inbox. No second email will be sent while this request is pending; your current login stays unchanged until you submit a new password.';
    case 'active': return 'Writer account recovery has been activated. Sign in normally with your updated password. Original account and payment records are retained; this does not promise access held by a different account.';
    default: return 'Recovery readiness is unavailable. No password or account changes can be requested here until the required checks succeed.';
  }
}

export interface WriterAccountSecurityViewProps {
  status: WriterAccountSecurityStatus | null;
  loading: boolean;
  sending: boolean;
  approved: boolean;
  notice: string;
  error: string;
  onApprove: (approved: boolean) => void;
  onRefresh: () => void;
  onRequest: () => void;
  onClose: () => void;
}

/** Readiness only: capabilities and password entry are never shown in the portal. */
export function WriterAccountSecurityView(props: WriterAccountSecurityViewProps) {
  const busy = props.loading || props.sending;
  return <section id="writer-account-security" aria-labelledby="writer-account-security-title" aria-busy={busy}
    className="mb-6 min-w-0 rounded-2xl border border-sky-900 bg-slate-950 p-4 text-slate-200 sm:p-6">
    <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1"><h2 id="writer-account-security-title" className="text-lg font-semibold text-white">Account security</h2>
        <p className="mt-1 text-sm text-slate-400">Writer Studio recovery · reviewed backup required</p></div>
      <button type="button" onClick={props.onClose} className="min-h-11 rounded-lg border border-slate-700 px-3 text-sm">Close security</button>
    </div>
    <p role="status" className="mt-4 break-words text-sm leading-relaxed">{props.loading ? 'Checking account security readiness…' : writerSecurityDescription(props.status)}</p>
    <p className="mt-3 text-xs leading-relaxed text-slate-400">Requesting an email does not change your password or current login. Activation happens only after you open the one-use link and submit a new password. Original IDs, purchases and payment history are preserved. Any conflicting account ownership must be resolved before activation.</p>
    {props.notice ? <p role="status" className="mt-3 break-words text-sm text-sky-200">{props.notice}</p> : null}
    {props.error ? <p role="alert" className="mt-3 break-words text-sm text-amber-200">{props.error}</p> : null}
    <label className="mt-4 flex min-w-0 items-start gap-3 text-sm leading-relaxed">
      <input type="checkbox" checked={props.approved} disabled={busy || props.status?.status !== 'ready' || !props.status.canIssue}
        onChange={event => props.onApprove(event.target.checked)} className="mt-1 h-4 w-4 shrink-0" />
      <span className="min-w-0">I want to send a recovery link to the approved owner email, preserving the reviewed account and its purchases. I understand that submitting a new password will end previous writer sessions.</span>
    </label>
    <div className="mt-4 flex flex-wrap gap-3">
      <button type="button" onClick={props.onRefresh} disabled={busy} className="min-h-11 rounded-xl border border-slate-700 px-4 py-2 text-sm disabled:opacity-50">Refresh security status</button>
      <button type="button" onClick={props.onRequest} disabled={!canRequestWriterRecovery(props.status, props.approved, busy)}
        className="min-h-11 rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{props.sending ? 'Requesting recovery email…' : 'Send one-use recovery email'}</button>
    </div>
  </section>;
}

export function WriterAccountSecurityPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<WriterAccountSecurityStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [approved, setApproved] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(false);
  const activeRead = useRef<AbortController | null>(null);
  const requestInFlight = useRef(false);
  const readGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (requestInFlight.current) return;
    activeRead.current?.abort();
    const controller = new AbortController();
    activeRead.current = controller;
    const generation = ++readGeneration.current;
    setLoading(true); setStatus(null); setApproved(false); setError('');
    try {
      const result = await api.getWriterAccountSecurity({ signal: controller.signal });
      if (mounted.current && !controller.signal.aborted && generation === readGeneration.current) setStatus(result.security);
    } catch {
      if (mounted.current && !controller.signal.aborted && generation === readGeneration.current) setError('Account security status could not be checked. No changes were requested.');
    } finally {
      if (mounted.current && !controller.signal.aborted && generation === readGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => { mounted.current = false; ++readGeneration.current; activeRead.current?.abort(); };
  }, [refresh]);

  const requestRecovery = async () => {
    if (requestInFlight.current || !canRequestWriterRecovery(status, approved, loading || sending)) return;
    requestInFlight.current = true;
    activeRead.current?.abort(); ++readGeneration.current;
    setSending(true); setApproved(false); setError(''); setNotice('');
    try {
      const { recovery }: { recovery: WriterAccountRecoveryIssue } = await api.requestWriterAccountRecovery();
      if (!mounted.current) return;
      setStatus({ status: 'pending', memberCount: status?.memberCount || 0, canIssue: false, expiresAt: recovery.expiresAt });
      setNotice(recovery.delivery === 'accepted'
        ? 'The email provider accepted the recovery request. Check the approved owner inbox; acceptance is not a delivery confirmation.'
        : 'Email delivery could not be confirmed. The recovery request remains pending. Check your inbox; do not request another email.');
    } catch {
      if (mounted.current) {
        setStatus(null);
        setError('The request outcome is uncertain. Check the approved owner inbox and refresh security status. No automatic retry will be sent.');
      }
    } finally {
      requestInFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };
  return <WriterAccountSecurityView status={status} loading={loading} sending={sending} approved={approved} notice={notice} error={error}
    onApprove={setApproved} onRefresh={() => { void refresh(); }} onRequest={() => { void requestRecovery(); }} onClose={onClose} />;
}

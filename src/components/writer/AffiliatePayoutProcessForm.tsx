import React, { useRef, useState } from 'react';
import type { AffiliatePayoutRequest } from '../../types.js';

export type WriterPayoutAction = 'approve' | 'pay' | 'reject';

export function validateWriterPayoutConfirmation(action: WriterPayoutAction, reference: string, confirmed: boolean): string | undefined {
  if (action !== 'pay') return;
  const canonical = reference.trim().toUpperCase();
  if (canonical.length < 4 || canonical.length > 128 || /[\u0000-\u001f\u007f]/.test(canonical)) {
    return 'Enter the actual M-Pesa transaction code or transfer reference (4–128 characters).';
  }
  if (!confirmed) return 'Confirm that the off-site payment succeeded for this amount and recipient before recording it.';
}

interface Props {
  /** Reserved React identity; consumed by React, not received by this component. */
  key?: string;
  payout: AffiliatePayoutRequest;
  onProcess: (action: WriterPayoutAction, paymentReference?: string, notes?: string) => Promise<void>;
  onCancel: () => void;
}

/** Records evidence of a transfer made outside the website. This form never sends money. */
export function AffiliatePayoutProcessForm({ payout, onProcess, onCancel }: Props) {
  const [action, setAction] = useState<WriterPayoutAction>(payout.status === 'PENDING' ? 'approve' : 'pay');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const submittingRef = useRef(false);
  const canConfirmPaid = payout.status === 'APPROVED' || payout.status === 'PROCESSING';
  const selectAction = (next: WriterPayoutAction) => {
    setAction(next);
    setConfirmed(false);
    setError('');
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const invalid = validateWriterPayoutConfirmation(action, reference, confirmed);
    if (invalid) { setError(invalid); return; }
    if (action === 'pay' && !canConfirmPaid) { setError('Approve this request before recording a completed payment.'); return; }
    submittingRef.current = true;
    setProcessing(true);
    setError('');
    try {
      await onProcess(action, action === 'pay' ? reference.trim().toUpperCase() : undefined, notes.trim() || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The payment record could not be confirmed. Refresh the saved payout before retrying.');
    } finally {
      submittingRef.current = false;
      setProcessing(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Record an off-site affiliate payout">
      <p className="text-xs leading-relaxed text-slate-400">Pay the partner outside this website. Approval only reserves the request; it does not send money. After a successful transfer, record its actual code below. The partner will see a writer-confirmed payment, receipt and updated balance.</p>
      <fieldset disabled={processing} className="space-y-3">
        <legend className="text-xs font-mono text-slate-300 mb-2">Payout action</legend>
        <div className="grid grid-cols-3 gap-2">
          <button type="button" disabled={payout.status !== 'PENDING'} aria-pressed={action === 'approve'} onClick={() => selectAction('approve')}
            className={`min-h-11 py-2 rounded-xl border text-xs font-mono font-bold disabled:opacity-40 ${action === 'approve' ? 'bg-cyan-950 border-cyan-600 text-cyan-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>Approve request</button>
          <button type="button" disabled={!canConfirmPaid} aria-pressed={action === 'pay'} onClick={() => selectAction('pay')}
            className={`min-h-11 py-2 rounded-xl border text-xs font-mono font-bold disabled:opacity-40 ${action === 'pay' ? 'bg-emerald-950 border-emerald-600 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>Record paid</button>
          <button type="button" aria-pressed={action === 'reject'} onClick={() => selectAction('reject')}
            className={`min-h-11 py-2 rounded-xl border text-xs font-mono font-bold ${action === 'reject' ? 'bg-rose-950 border-rose-600 text-rose-300' : 'bg-slate-900 border-slate-800 text-slate-400'}`}>Reject request</button>
        </div>
        {action === 'pay' ? (
          <div className="space-y-3 rounded-xl border border-emerald-800/60 bg-emerald-950/20 p-3">
            <div>
              <label htmlFor="writer-payout-receipt" className="block text-xs font-mono text-slate-300 mb-1">{payout.payoutMethod === 'mpesa' ? 'M-Pesa transaction code' : 'Completed transfer reference'}</label>
              <input id="writer-payout-receipt" type="text" required minLength={4} maxLength={128} autoComplete="off" autoCapitalize="characters" spellCheck={false}
                value={reference} onChange={event => setReference(event.target.value)} aria-describedby="writer-payout-receipt-help"
                className="w-full min-w-0 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500" />
              <p id="writer-payout-receipt-help" className="mt-1 text-[11px] text-slate-400">Copy the code from the successful payment receipt, not the phone number or STK checkout ID. A code cannot be used for another payout. The website does not independently verify the transfer with Safaricom.</p>
            </div>
            <label className="flex items-start gap-2 text-xs leading-relaxed text-slate-200">
              <input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1 shrink-0 accent-emerald-500" />
              <span>I have paid KES {payout.amountKes.toLocaleString()} off-site to {payout.affiliateName}, checked the recipient details above and verified that this transfer succeeded. Record this payment as writer-confirmed.</span>
            </label>
          </div>
        ) : null}
        <div>
          <label htmlFor="writer-payout-notes" className="block text-xs font-mono text-slate-300 mb-1">Payment / review notes (optional)</label>
          <input id="writer-payout-notes" type="text" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-cyan-500" />
        </div>
        {error ? <p role="alert" className="break-words rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-xs text-rose-200">{error}</p> : null}
        <div className="pt-2 flex items-center gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-mono text-xs disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={processing || (action === 'pay' && (!confirmed || reference.trim().length < 4))}
            className={`min-h-11 flex-1 py-2 rounded-xl font-mono font-bold text-xs disabled:opacity-50 ${action === 'pay' ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950' : 'bg-cyan-600 hover:bg-cyan-500 text-white'}`}>
            {processing ? 'Saving payment record...' : action === 'pay' ? 'Confirm off-site payment' : action === 'approve' ? 'Approve reserved payout' : 'Reject request'}
          </button>
        </div>
      </fieldset>
    </form>
  );
}

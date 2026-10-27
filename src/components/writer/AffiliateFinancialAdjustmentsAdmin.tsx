import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../utils/api.js';
import type { AffiliateFinancialAdjustmentOverview, AffiliateSaleCommission,
  AffiliateRefundAdjustmentRequest, AffiliateDirectCostRequest, AffiliateFinancialAdjustmentCorrectionRequest } from '../../types.js';

type Operation = 'refunds' | 'refund-corrections' | 'costs' | 'cost-corrections';
type Prepared = { operation: Operation; request: AffiliateRefundAdjustmentRequest | AffiliateDirectCostRequest | AffiliateFinancialAdjustmentCorrectionRequest };
const money = (value: number) => `KES ${value.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const field = 'w-full min-w-0 max-w-full rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-sm text-slate-100';

export default function AffiliateFinancialAdjustmentsAdmin({ sales, onChanged }: {
  sales: AffiliateSaleCommission[]; onChanged: () => void;
}) {
  const [overview, setOverview] = useState<AffiliateFinancialAdjustmentOverview | null>(null);
  const [commissionSources, setCommissionSources] = useState(sales);
  const [operation, setOperation] = useState<Operation>('refunds');
  const [targetId, setTargetId] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState<'refund' | 'chargeback'>('refund');
  const [category, setCategory] = useState<'payment_fee' | 'other'>('payment_fee');
  const [confirmed, setConfirmed] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestId = useRef(0);
  const ledgerRequestId = useRef(0);
  const recording = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const generation = ++ledgerRequestId.current;
    Promise.all([api.getAdminAffiliateFinancialAdjustments({ signal: controller.signal }), api.getAdminAffiliateCommissions({ signal: controller.signal })])
      .then(([result, sources]) => { if (mounted.current && !controller.signal.aborted && generation === ledgerRequestId.current) {
        setOverview(result.overview); setCommissionSources(sources.commissions);
      } })
      .catch(error => { if (!controller.signal.aborted && mounted.current) setError(error.message || 'Could not load the ledger.'); });
    return () => { mounted.current = false; controller.abort(); requestId.current += 1; };
  }, []);
  const refresh = async () => {
    const generation = ++ledgerRequestId.current;
    const [result, sources] = await Promise.all([api.getAdminAffiliateFinancialAdjustments(), api.getAdminAffiliateCommissions()]);
    if (mounted.current && generation === ledgerRequestId.current) {
      setOverview(result.overview); setCommissionSources(sources.commissions);
    }
  };
  const correction = operation.endsWith('corrections');
  const refund = operation.startsWith('refund');
  const entries = overview?.entries || [];
  const corrections = new Set(entries.map(entry => entry.supersedesEntryId).filter(Boolean));
  const correctable = entries.filter(entry => entry.kind === (refund ? 'refund' : 'direct_cost') && !corrections.has(entry.entryId));
  const selectedSale = commissionSources.find(sale => sale.id === targetId);
  const selectedEntry = entries.find(entry => entry.entryId === targetId);

  async function review(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || prepared || busy) return;
    const generation = ++requestId.current;
    setBusy(true); setError(''); setMessage('');
    try {
      if (!reference.trim() || reference.trim().length < 4) throw new Error('Enter the actual external confirmation reference.');
      const target = correction ? selectedEntry : selectedSale;
      if (refund && !target) throw new Error('Choose an existing paid commission or refund entry.');
      if (correction && !selectedEntry) throw new Error('Choose an uncorrected entry.');
      const id = refund ? target?.affiliateId : correction ? selectedEntry?.transactionId : targetId.trim();
      if (!id) throw new Error('Choose the ledger record to review.');
      const { summary } = await api.getAdminAffiliateAdjustmentRevision(refund ? 'wallet' : 'costs', id);
      const common = { expectedRevision: summary.revision, idempotencyKey: crypto.randomUUID(),
        confirmationReference: reference.trim(), currency: 'KES' as const, confirmedByWriter: true as const };
      const number = Number(amount);
      if (!correction && (!Number.isFinite(number) || number <= 0 || number > 1_000_000
        || Math.abs(number * 100 - Math.round(number * 100)) > 0.000001)) throw new Error('Enter a positive KES amount with at most two decimal places.');
      const request = correction ? { ...common, entryId: targetId }
        : refund ? { ...common, commissionId: targetId, refundedAmountKes: number, reason }
          : { ...common, transactionId: targetId.trim(), amountKes: number, category };
      if (mounted.current && generation === requestId.current) setPrepared({ operation, request });
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : 'Could not review the current revision.'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function record() {
    if (!prepared || busy || recording.current) return;
    recording.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await api.recordAdminAffiliateFinancialAdjustment(prepared.operation, prepared.request);
      if (!mounted.current) return;
      setMessage(result.result.status === 'already_recorded' ? 'This exact request was already recorded; it was not duplicated.' : 'Accounting entry recorded. No money was moved and no reading access changed.');
      setPrepared(null); setConfirmed(false); setReference(''); setAmount(''); setTargetId('');
      onChanged();
      await refresh();
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : 'Not confirmed. Refresh the ledger before retrying.');
      // Keep the EXACT request/key after an ambiguous response. A retry cannot
      // silently create a second compensation entry.
    } finally { recording.current = false; if (mounted.current) setBusy(false); }
  }
  return <section className="space-y-5 rounded-2xl border border-cyan-500/20 bg-slate-900/50 p-4 sm:p-6">
    <div><h3 className="font-serif text-xl text-slate-100">Financial corrections &amp; known costs</h3>
      <p className="mt-2 text-sm text-slate-300">Record a refund or chargeback only after it is confirmed externally. This is an accounting ledger, not a refund button. Purchases, access and original earnings history are preserved.</p>
      <p className="mt-2 text-xs text-slate-400">Paid or partly paid commissions only. Resolve active payout reservations first. Unpaid commissions use the existing commission reversal control. A negative adjusted wallet offsets future earnings; it does not erase the original balance.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-emerald-500/40 p-3 text-sm text-emerald-200">{message}</p>}
    <button type="button" disabled={busy} onClick={() => { setError(''); void refresh().catch(() => setError('Could not refresh the ledger.')); }} className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200">Refresh saved ledger</button>
    {overview && <div className="grid gap-3 text-sm sm:grid-cols-3">
      <p>Refunded purchases<br /><strong>{money(overview.refundedPurchaseKes)}</strong></p>
      <p>Commission clawback<br /><strong>{money(overview.commissionClawbackKes)}</strong></p>
      <p>Known recorded costs<br /><strong>{money(overview.directCosts.reduce((sum, cost) => sum + cost.knownDirectCostsKes, 0))}</strong></p>
      <p className="text-xs text-slate-400 sm:col-span-3">Authoritative ledger as of {new Date(overview.asOf).toLocaleString('en-KE')}. Costs are only those recorded here; these figures do not claim net profit.</p>
    </div>}
    <form onSubmit={review} className="space-y-4">
      <fieldset disabled={busy || Boolean(prepared)} className="grid min-w-0 gap-4 sm:grid-cols-2 [&>label]:min-w-0">
        <label className="space-y-1 text-sm">Operation<select value={operation} onChange={event => { setOperation(event.target.value as Operation); setTargetId(''); setConfirmed(false); }} className={field}>
          <option value="refunds">Record confirmed refund / chargeback</option><option value="refund-corrections">Correct a refund entry</option>
          <option value="costs">Record known direct cost</option><option value="cost-corrections">Correct a cost entry</option>
        </select></label>
        <label className="space-y-1 text-sm">{correction ? 'Original entry' : refund ? 'Paid commission' : 'Verified purchase transaction ID'}
          {correction ? <select required value={targetId} onChange={event => setTargetId(event.target.value)} className={field}>
            <option value="">Choose an entry</option>{correctable.map(entry => <option key={entry.entryId} value={entry.entryId}>{entry.transactionId} · {money(entry.amountKes)} · {entry.createdAt}</option>)}</select>
            : refund ? <select required value={targetId} onChange={event => setTargetId(event.target.value)} className={field}><option value="">Choose a paid commission</option>
              {commissionSources.filter(sale => sale.status === 'PAID' || (sale.payoutPaidKes || 0) > 0).map(sale => <option key={sale.id} value={sale.id}>{sale.affiliateName} · {sale.articleTitle} · {sale.id}</option>)}</select>
              : <input required value={targetId} onChange={event => setTargetId(event.target.value)} maxLength={256} className={field} />}
        </label>
        {!correction && <label className="space-y-1 text-sm">Amount (KES)<input required type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} className={field} /></label>}
        {!correction && <label className="space-y-1 text-sm">{refund ? 'Reason' : 'Cost category'}
          {refund ? <select value={reason} onChange={event => setReason(event.target.value as typeof reason)} className={field}><option value="refund">Confirmed refund</option><option value="chargeback">Confirmed chargeback</option></select>
            : <select value={category} onChange={event => setCategory(event.target.value as typeof category)} className={field}><option value="payment_fee">Payment fee</option><option value="other">Other known direct cost</option></select>}
        </label>}
        <label className="space-y-1 text-sm">External confirmation reference<input required minLength={4} maxLength={128} value={reference} onChange={event => setReference(event.target.value)} className={field} autoComplete="off" /></label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I checked the external confirmation. This records accounting only and does not issue or reverse an M-PESA transfer.</label>
      </fieldset>
      {!prepared && <button disabled={busy || !overview || !confirmed} className="rounded-xl bg-cyan-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Checking current ledger…' : 'Review current revision'}</button>}
    </form>
    {prepared && <div className="min-w-0 break-words space-y-3 rounded-xl border border-amber-500/40 p-4 text-sm text-amber-100">
      <p>Reviewed revision {prepared.request.expectedRevision}. Reference: {prepared.request.confirmationReference}. {correction ? 'A separate correction will compensate the original entry once.' : `Amount: ${money(Number(amount))}.`}</p>
      <p>Source: {targetId}{selectedSale ? ` · purchase ${selectedSale.transactionId} · paid sale ${money(selectedSale.saleAmountKes)} · original commission ${money(selectedSale.commissionAmountKes)}` : ''}.</p>
      {refund && <p>The server derives the proportional commission clawback from verified payment and payout records, including previous refunds. It rechecks the wallet revision and payout reservations atomically; an inconsistent or stale request is rejected. Any resulting debt offsets future available earnings.</p>}
      <p>If a response is uncertain, refresh the ledger and retry this exact request. Its idempotency key is retained.</p>
      <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} onClick={() => void record()} className="rounded-lg bg-amber-800 px-3 py-2">{busy ? 'Recording…' : 'Confirm / retry exact accounting entry'}</button>
        <button type="button" disabled={busy} onClick={() => { setPrepared(null); setConfirmed(false); }} className="rounded-lg border border-slate-600 px-3 py-2">Return to review</button></div>
    </div>}
    <div><h4 className="mb-2 font-semibold">Immutable adjustment history</h4>
      {!overview ? <p role="status" className="text-sm text-slate-400">Loading ledger…</p> : entries.length === 0 ? <p className="text-sm text-slate-400">No financial adjustments recorded.</p>
        : <ol className="space-y-2">{entries.slice().reverse().slice(0, 50).map(entry => <li key={entry.entryId} className="break-words rounded-xl border border-slate-700 p-3 text-sm">
          <p>{entry.kind.replaceAll('_', ' ')} · {money(entry.amountKes)} · wallet {money(entry.walletDeltaKes)}</p>
          <p className="text-xs text-slate-400">{entry.transactionId} · {new Date(entry.createdAt).toLocaleString('en-KE')}{entry.supersedesEntryId ? ' · compensating correction' : ''}</p>
        </li>)}</ol>}
    </div>
  </section>;
}

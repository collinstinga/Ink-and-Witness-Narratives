import React from 'react';
import type { AffiliatePayoutRequest } from '../../types.js';

export function AffiliatePayoutReceipt({ payout }: { payout: AffiliatePayoutRequest }) {
  const paidAt = payout.paidAt && Number.isFinite(Date.parse(payout.paidAt)) ? payout.paidAt : undefined;
  return (
    <div className="max-w-xs space-y-1 text-xs">
      {payout.paymentReference ? <span className="select-text break-all font-mono text-cyan-300">{payout.paymentReference}</span> : <span className="text-slate-500">No receipt recorded</span>}
      {payout.status === 'PAID' ? (
        <>
          <p className="text-emerald-300">KES {payout.amountKes.toLocaleString()} paid</p>
          <p className="text-[11px] text-slate-400">{payout.confirmationMethod === 'writer_confirmed' ? 'Payment confirmed by writer (off-site)' : 'Historical paid record'}</p>
          {paidAt ? <time dateTime={paidAt} className="block text-[11px] text-slate-400">{new Date(paidAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi', dateStyle: 'medium', timeStyle: 'short' })} EAT</time> : null}
        </>
      ) : payout.status === 'APPROVED' ? <p className="text-[11px] text-slate-400">Approved — not yet paid</p> : null}
    </div>
  );
}

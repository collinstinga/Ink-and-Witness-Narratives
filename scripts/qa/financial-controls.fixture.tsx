import React from 'react';
import { createRoot } from 'react-dom/client';
import FinancialControls from '../../src/components/writer/AffiliateFinancialAdjustmentsAdmin.js';
import type { AffiliateSaleCommission } from '../../src/types.js';

// Synthetic-only component lab: no real account, provider or application server.
const sale = { id: 'synthetic-paid-commission', affiliateId: 'synthetic-partner', status: 'PAID',
  affiliateName: 'Synthetic partner', articleTitle: 'Synthetic piece', transactionId: 'synthetic-transaction',
  saleAmountKes: 500, commissionAmountKes: 100 } as AffiliateSaleCommission;
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-5xl p-4 text-slate-100">
  <h1 className="text-2xl">Synthetic financial controls lab</h1>
  <label>Unsaved writer note<input id="unsaved-note" className="m-2 max-w-full border p-2" defaultValue="Keep this draft" /></label>
  <FinancialControls sales={[sale]} onChanged={() => {}} />
</main>);

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import AffiliateFinancialAdjustmentsAdmin from './AffiliateFinancialAdjustmentsAdmin.js';

describe('writer financial corrections controls', () => {
  it('explains additive accounting, external confirmation, preserved history and debt', () => {
    const markup = renderToStaticMarkup(<AffiliateFinancialAdjustmentsAdmin sales={[]} onChanged={vi.fn()} />);
    for (const text of ['not a refund button', 'access and original earnings history are preserved',
      'Resolve active payout reservations first', 'offsets future earnings', 'External confirmation reference',
      'does not issue or reverse an M-PESA transfer', 'Review current revision', 'Immutable adjustment history']) expect(markup).toContain(text);
    expect(markup).toContain('disabled=""');
    expect(markup).not.toContain('Send refund');
  });
  it('lists only already paid commission candidates and does not expose private payment evidence', () => {
    const markup = renderToStaticMarkup(<AffiliateFinancialAdjustmentsAdmin sales={[
      { id: 'paid-source', status: 'PAID', affiliateName: 'Paid partner', articleTitle: 'Paid work' },
      { id: 'partial-source', status: 'APPROVED', payoutPaidKes: 10, affiliateName: 'Partial partner', articleTitle: 'Partial work' },
      { id: 'pending-source', status: 'PENDING', affiliateName: 'Pending partner', articleTitle: 'Pending work' },
    ] as any} onChanged={vi.fn()} />);
    expect(markup).toContain('paid-source'); expect(markup).toContain('partial-source');
    expect(markup).not.toContain('pending-source');
    expect(markup).not.toContain('receiptNumber'); expect(markup).not.toContain('passwordHash');
  });
  it('retains the exact reviewed body/key after an uncertain response, with no automatic re-send', () => {
    const source = fs.readFileSync(new URL('./AffiliateFinancialAdjustmentsAdmin.tsx', import.meta.url), 'utf8');
    expect(source).toContain('prepared.operation, prepared.request');
    expect(source).toContain('idempotencyKey: crypto.randomUUID()');
    expect(source).toContain('Keep the EXACT request/key after an ambiguous response');
    expect(source).toContain('generation === ledgerRequestId.current');
    expect(source).not.toContain('localStorage'); expect(source).not.toContain('setInterval');
  });
});

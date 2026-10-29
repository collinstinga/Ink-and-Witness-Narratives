import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AffiliatePayoutRequest } from '../../types.js';
import { AffiliatePayoutReceipt } from './AffiliatePayoutReceipt.js';

const paid: AffiliatePayoutRequest = {
  id: 'synthetic-payout', affiliateId: 'synthetic-partner', affiliateCode: 'PARTNER', affiliateName: 'Test partner',
  amountKes: 750, salesCount: 1, commissionIds: ['synthetic-commission'], payoutMethod: 'mpesa',
  payoutDetails: { mpesaPhone: '254700000001' }, status: 'PAID', requestedAt: '2026-10-28T12:00:00.000Z',
  paidAt: '2026-10-28T13:15:00.000Z', paymentReference: 'QK82910482', confirmationMethod: 'writer_confirmed',
};

describe('private affiliate payout receipts', () => {
  it('displays amount, code, writer-confirmed provenance and Nairobi payment time', () => {
    const html = renderToStaticMarkup(<AffiliatePayoutReceipt payout={paid} />);
    expect(html).toContain('QK82910482');
    expect(html).toContain('KES 750 paid');
    expect(html).toContain('Payment confirmed by writer (off-site)');
    expect(html).toContain('dateTime="2026-10-28T13:15:00.000Z"');
    expect(html).toContain('16:15');
    expect(html).toContain('EAT');
    expect(html).not.toContain('provider-verified');
  });

  it('does not mislabel historical paid rows as newly writer-confirmed', () => {
    const html = renderToStaticMarkup(<AffiliatePayoutReceipt payout={{ ...paid, confirmationMethod: undefined, paidAt: undefined }} />);
    expect(html).toContain('Historical paid record');
    expect(html).not.toContain('confirmed by writer');
    expect(html).not.toContain('<time');
  });

  it('distinguishes approval from payment and does not invent missing receipt evidence', () => {
    const html = renderToStaticMarkup(<AffiliatePayoutReceipt payout={{ ...paid, status: 'APPROVED', paymentReference: undefined, paidAt: undefined, confirmationMethod: undefined }} />);
    expect(html).toContain('Approved — not yet paid');
    expect(html).toContain('No receipt recorded');
    expect(html).not.toContain('KES 750 paid');
  });
});

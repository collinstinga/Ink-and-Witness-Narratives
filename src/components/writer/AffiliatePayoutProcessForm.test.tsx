import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AffiliatePayoutRequest } from '../../types.js';
import { AffiliatePayoutProcessForm, validateWriterPayoutConfirmation } from './AffiliatePayoutProcessForm.js';

const payout: AffiliatePayoutRequest = {
  id: 'synthetic-payout', affiliateId: 'synthetic-partner', affiliateCode: 'PARTNER', affiliateName: 'Test partner',
  amountKes: 750, salesCount: 1, commissionIds: ['synthetic-commission'], payoutMethod: 'mpesa',
  payoutDetails: { mpesaPhone: '254700000001' }, status: 'APPROVED', requestedAt: '2026-10-28T12:00:00.000Z',
};

describe('writer off-site affiliate payment evidence', () => {
  it('labels the real M-Pesa receipt and requires explicit completed-transfer confirmation', () => {
    const html = renderToStaticMarkup(<AffiliatePayoutProcessForm payout={payout} onProcess={async () => {}} onCancel={() => {}} />);
    expect(html).toContain('M-Pesa transaction code');
    expect(html).toContain('I have paid KES 750 off-site to Test partner');
    expect(html).toContain('does not independently verify the transfer with Safaricom');
    expect(html).toContain('for="writer-payout-receipt"');
    expect(html).toContain('aria-describedby="writer-payout-receipt-help"');
    expect(html).toMatch(/<input[^>]+type="checkbox"[^>]+required/);
    expect(html).toMatch(/<button[^>]+type="submit"[^>]+disabled/);
    expect(html).not.toContain('B2C');
  });

  it('requires approval before displaying paid confirmation fields', () => {
    const html = renderToStaticMarkup(<AffiliatePayoutProcessForm payout={{ ...payout, status: 'PENDING' }} onProcess={async () => {}} onCancel={() => {}} />);
    expect(html).toContain('Approve reserved payout');
    expect(html).not.toContain('id="writer-payout-receipt"');
    expect(html).toMatch(/<button[^>]+disabled[^>]+aria-pressed="false"[^>]*>Record paid/);
  });

  it.each(['', 'A', 'ABC', 'X'.repeat(129), 'ABC\u0000REF'])('rejects missing or unsafe payment evidence %j', reference => {
    expect(validateWriterPayoutConfirmation('pay', reference, true)).toMatch(/actual M-Pesa/);
  });

  it('requires actual-transfer acknowledgment and accepts a real-shaped canonicalizable receipt', () => {
    expect(validateWriterPayoutConfirmation('pay', ' qk82910482 ', false)).toMatch(/payment succeeded/);
    expect(validateWriterPayoutConfirmation('pay', ' qk82910482 ', true)).toBeUndefined();
    expect(validateWriterPayoutConfirmation('approve', '', false)).toBeUndefined();
    expect(validateWriterPayoutConfirmation('reject', '', false)).toBeUndefined();
  });
});

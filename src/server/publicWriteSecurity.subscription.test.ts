import { describe, expect, it, vi } from 'vitest';

import { publicWriteValidators } from './publicWriteSecurity.js';

function runSubscriptionCheckoutValidator(body: unknown) {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const next = vi.fn();
  const request = { body } as any;
  const response = { status, json } as any;

  publicWriteValidators.subscriptionCheckout(request, response, next);

  return { request, status, json, next };
}

describe('Reader Pass checkout request validation', () => {
  const validRequest = {
    planId: 'first-chapter-3-months',
    phoneNumber: '0712 345 678',
    expectedPlanName: 'The First Chapter',
    expectedPriceKes: 500,
    expectedDurationMonths: 3,
    expectedRenewable: true,
  };

  it('accepts the stable plan identifier, displayed terms, and phone number and normalizes whitespace', () => {
    const result = runSubscriptionCheckoutValidator({
      planId: ' first-chapter-3-months ',
      phoneNumber: ' 0712 345 678 ',
      expectedPlanName: ' The First Chapter ',
      expectedPriceKes: 500,
      expectedDurationMonths: 3,
      expectedRenewable: true,
    });

    expect(result.next).toHaveBeenCalledOnce();
    expect(result.status).not.toHaveBeenCalled();
    expect(result.request.body).toEqual({
      planId: 'first-chapter-3-months',
      phoneNumber: '0712 345 678',
      expectedPlanName: 'The First Chapter',
      expectedPriceKes: 500,
      expectedDurationMonths: 3,
      expectedRenewable: true,
    });
  });

  it.each([
    [{ ...validRequest, priceKes: 1 }, 'Unexpected request field: priceKes.'],
    [{ ...validRequest, durationMonths: 120 }, 'Unexpected request field: durationMonths.'],
    [{ ...validRequest, planId: 'Reader Pass' }, 'planId has an invalid format.'],
    [{ ...validRequest, phoneNumber: 712345678 }, 'phoneNumber must be text.'],
    [{ ...validRequest, phoneNumber: undefined }, 'phoneNumber is required.'],
    [{ ...validRequest, planId: undefined }, 'planId is required.'],
    [{ ...validRequest, expectedPriceKes: 500.5 }, 'expectedPriceKes must be a whole number.'],
    [{ ...validRequest, expectedDurationMonths: undefined }, 'expectedDurationMonths is required.'],
  ])('rejects tampered or incomplete checkout input %#', (body, error) => {
    const result = runSubscriptionCheckoutValidator(body);

    expect(result.next).not.toHaveBeenCalled();
    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.json).toHaveBeenCalledWith({ success: false, error });
  });

  it('rejects non-object and oversized request bodies before checkout logic runs', () => {
    const unsafe = runSubscriptionCheckoutValidator(['reader-pass']);
    expect(unsafe.status).toHaveBeenCalledWith(400);
    expect(unsafe.next).not.toHaveBeenCalled();

    const oversized = runSubscriptionCheckoutValidator({
      ...validRequest,
      planId: 'reader-pass',
      phoneNumber: `07${'1'.repeat(2_100)}`,
    });
    expect(oversized.status).toHaveBeenCalledWith(413);
    expect(oversized.next).not.toHaveBeenCalled();
  });
});

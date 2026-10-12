import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionPlan } from '../types.js';
import { SubscriptionCheckoutModal } from './SubscriptionCheckoutModal.js';

const plan: SubscriptionPlan = {
  id: 'first-chapter-3-months',
  name: 'The First Chapter',
  description: 'Three months of full-catalogue reading.',
  durationMonths: 3,
  priceKes: 500,
  renewable: true,
  order: 0,
  isPublished: true,
};

describe('SubscriptionCheckoutModal', () => {
  it('presents the authoritative plan terms and confirmed-payment promise', () => {
    const markup = renderToStaticMarkup(
      <SubscriptionCheckoutModal
        plan={plan}
        isOpen
        onClose={vi.fn()}
        onPaymentSuccess={vi.fn()}
      />,
    );

    expect(markup).toContain('The First Chapter');
    expect(markup).toContain('3 months');
    expect(markup).toContain('KSh 500');
    expect(markup).toContain('activated only after Safaricom confirms');
    expect(markup).toContain('Pay KSh 500');
  });

  it('stays out of the DOM when no plan is selected', () => {
    const markup = renderToStaticMarkup(
      <SubscriptionCheckoutModal
        plan={null}
        isOpen={false}
        onClose={vi.fn()}
        onPaymentSuccess={vi.fn()}
      />,
    );
    expect(markup).toBe('');
  });
});

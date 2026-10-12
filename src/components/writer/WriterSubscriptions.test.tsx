import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  WriterSubscriptions,
  createEmptySubscriptionPlanDraft,
  validateSubscriptionPlanDraft,
} from './WriterSubscriptions.js';

describe('WriterSubscriptions', () => {
  it('renders a safe loading boundary and hidden new-plan editor before data resolves', () => {
    const markup = renderToStaticMarkup(<WriterSubscriptions />);

    expect(markup).toContain('id="writer-subscriptions"');
    expect(markup).toContain('id="writer-subscriptions-loading"');
    expect(markup).toContain('Create a Reader Pass');
    expect(markup).toContain('Choose Reader Pass cover JPEG');
  });

  it('accepts a valid customizable plan draft', () => {
    const draft = {
      ...createEmptySubscriptionPlanDraft(4),
      name: 'A Quiet Season',
      description: 'Six months of access to the full published catalogue.',
      priceKes: 1_250,
      durationMonths: 6,
      isPublished: true,
      badge: 'Reader favourite',
    };

    expect(validateSubscriptionPlanDraft(draft)).toBeNull();
  });

  it('rejects fractional commercial terms and stale existing drafts', () => {
    const fractionalPrice = {
      ...createEmptySubscriptionPlanDraft(),
      name: 'A Quiet Season',
      description: 'Full catalogue access.',
      priceKes: 500.5,
    };
    expect(validateSubscriptionPlanDraft(fractionalPrice)).toContain('whole number');

    const missingVersion = {
      ...fractionalPrice,
      priceKes: 500,
      id: 'quiet-season',
    };
    expect(validateSubscriptionPlanDraft(missingVersion)).toContain('Reload');
  });
});

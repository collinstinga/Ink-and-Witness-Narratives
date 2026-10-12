import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionPlan } from '../types.js';
import { HomepageReaderPasses } from './HomepageReaderPasses.js';

const plan = (overrides: Partial<SubscriptionPlan> = {}): SubscriptionPlan => ({
  id: 'long-read-6-months',
  name: 'The Long Read',
  description: 'Six months with every published piece.',
  durationMonths: 6,
  priceKes: 1_000,
  renewable: true,
  order: 1,
  isPublished: true,
  coverImage: '/assets/subscriptions/the-long-read.png',
  coverImageAlt: 'A manuscript beside a reading chair',
  coverPosition: { x: 35, y: 70 },
  ...overrides,
});

describe('HomepageReaderPasses', () => {
  it('renders writer-priced published plans with renewal and focal-position details', () => {
    const markup = renderToStaticMarkup(
      <HomepageReaderPasses
        plans={[plan(), plan({ id: 'hidden', name: 'Hidden', isPublished: false, order: 0 })]}
        onChoosePlan={vi.fn()}
      />,
    );

    expect(markup).toContain('id="home-reader-passes"');
    expect(markup).toContain('The Long Read');
    expect(markup).toContain('KSh 1,000');
    expect(markup).toContain('6 months');
    expect(markup).toContain('Renewable from your current expiry');
    expect(markup).toContain('object-position:35% 70%');
    expect(markup).not.toContain('Hidden');
  });

  it('renders nothing when every plan is hidden', () => {
    const markup = renderToStaticMarkup(
      <HomepageReaderPasses plans={[plan({ isPublished: false })]} onChoosePlan={vi.fn()} />,
    );
    expect(markup).toBe('');
  });
});

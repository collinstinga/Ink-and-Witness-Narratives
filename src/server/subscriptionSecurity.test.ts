import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  READER_SUBSCRIPTION_ID_PATTERN,
  addUtcCalendarMonths,
  calculateSubscriptionRenewalWindow,
  createSubscriptionPurchaseSnapshot,
  getReaderSubscriptionId,
  isSafeWhatsAppChannelUrl,
  isSubscriptionPurchaseSnapshot,
  normalizeSubscriptionPlan,
  normalizeSubscriptionPlans,
  normalizeWhatsAppChannelUrl,
  projectPublicSubscriptionPlans,
  toPublicSubscriptionPlan,
  validateSubscriptionPurchaseSnapshot
} from './subscriptionSecurity.js';

function validPlan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reader-season',
    name: 'Reader Season',
    description: 'A carefully paced reading season.',
    priceKes: 750,
    durationMonths: 4,
    renewable: true,
    isPublished: true,
    order: 2,
    ...overrides
  };
}

describe('subscription plan security', () => {
  it('provides four stable, immutable default plans with the requested terms', () => {
    expect(DEFAULT_SUBSCRIPTION_PLANS.map(plan => ({
      id: plan.id,
      name: plan.name,
      priceKes: plan.priceKes,
      durationMonths: plan.durationMonths
    }))).toEqual([
      { id: 'first-chapter-3-months', name: 'The First Chapter', priceKes: 500, durationMonths: 3 },
      { id: 'long-read-6-months', name: 'The Long Read', priceKes: 1_000, durationMonths: 6 },
      { id: 'deep-archive-9-months', name: 'The Deep Archive', priceKes: 1_500, durationMonths: 9 },
      { id: 'full-witness-12-months', name: 'The Full Witness', priceKes: 2_000, durationMonths: 12 }
    ]);
    expect(DEFAULT_SUBSCRIPTION_PLANS.every(plan => plan.renewable)).toBe(true);
    expect(Object.isFrozen(DEFAULT_SUBSCRIPTION_PLANS)).toBe(true);
    expect(DEFAULT_SUBSCRIPTION_PLANS.every(plan => Object.isFrozen(plan))).toBe(true);
  });

  it('normalizes bounded display text and validates cover controls', () => {
    expect(normalizeSubscriptionPlan(validPlan({
      name: '  Reader   Season  ',
      description: '  A carefully   paced reading season. ',
      badge: '  New   release ',
      coverImage: ' /uploads/reader-season.jpg ',
      coverImageAlt: '  Blue   library shelves ',
      coverPosition: { x: 12.56, y: 87.44 },
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-02T08:00:00.000Z'
    }))).toMatchObject({
      name: 'Reader Season',
      description: 'A carefully paced reading season.',
      badge: 'New release',
      coverImage: '/uploads/reader-season.jpg',
      coverImageAlt: 'Blue library shelves',
      coverPosition: { x: 12.6, y: 87.4 }
    });
  });

  it.each([
    [{ id: 'Bad ID' }, 'SUBSCRIPTION_INVALID_PLAN_ID'],
    [{ priceKes: '500' }, 'SUBSCRIPTION_INVALID_PRICE'],
    [{ priceKes: 0 }, 'SUBSCRIPTION_INVALID_PRICE'],
    [{ priceKes: 500.5 }, 'SUBSCRIPTION_INVALID_PRICE'],
    [{ durationMonths: 0 }, 'SUBSCRIPTION_INVALID_DURATION'],
    [{ durationMonths: 121 }, 'SUBSCRIPTION_INVALID_DURATION'],
    [{ renewable: 'yes' }, 'SUBSCRIPTION_INVALID_BOOLEAN'],
    [{ isPublished: 1 }, 'SUBSCRIPTION_INVALID_BOOLEAN'],
    [{ order: -1 }, 'SUBSCRIPTION_INVALID_ORDER'],
    [{ coverImage: 'javascript:alert(1)' }, 'SUBSCRIPTION_INVALID_IMAGE'],
    [{ coverPosition: { x: -1, y: 50 } }, 'SUBSCRIPTION_INVALID_COVER_POSITION'],
    [{ extraCommercialField: true }, 'SUBSCRIPTION_INVALID_PLAN']
  ])('rejects malformed or unsupported plan input %o', (override, code) => {
    try {
      normalizeSubscriptionPlan(validPlan(override));
      throw new Error('Expected validation to fail.');
    } catch (error) {
      expect(error).toMatchObject({ code });
    }
  });

  it('rejects duplicate IDs and sorts a bounded plan list by writer order', () => {
    const sorted = normalizeSubscriptionPlans([
      validPlan({ id: 'second-plan', name: 'Second', order: 5 }),
      validPlan({ id: 'first-plan', name: 'First', order: 1 })
    ]);
    expect(sorted.map(plan => plan.id)).toEqual(['first-plan', 'second-plan']);
    expect(() => normalizeSubscriptionPlans([
      validPlan({ id: 'same-plan' }),
      validPlan({ id: 'same-plan' })
    ])).toThrow(/duplicated/i);
  });

  it('projects only published plans and excludes administrative fields', () => {
    const publicPlans = projectPublicSubscriptionPlans([
      validPlan({ id: 'hidden-plan', isPublished: false, order: 0 }),
      validPlan({
        id: 'public-plan',
        order: 1,
        createdAt: '2026-10-01T08:00:00.000Z',
        updatedAt: '2026-10-02T08:00:00.000Z'
      })
    ]);
    expect(publicPlans).toHaveLength(1);
    expect(publicPlans[0].id).toBe('public-plan');
    expect(publicPlans[0]).not.toHaveProperty('isPublished');
    expect(publicPlans[0]).not.toHaveProperty('createdAt');
    expect(publicPlans[0]).not.toHaveProperty('updatedAt');

    const projected = toPublicSubscriptionPlan(validPlan());
    expect(projected).not.toHaveProperty('isPublished');
  });
});

describe('WhatsApp Channel URL security', () => {
  const requestedChannel = 'https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z';

  it('accepts and canonicalizes the configured public channel', () => {
    expect(normalizeWhatsAppChannelUrl(requestedChannel)).toBe(requestedChannel);
    expect(normalizeWhatsAppChannelUrl(
      'https://www.whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z/'
    )).toBe(requestedChannel);
    expect(isSafeWhatsAppChannelUrl(requestedChannel)).toBe(true);
  });

  it.each([
    'http://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z',
    'https://whatsapp.example/channel/0029Vb8zwQA0gcfBDoRCWM3z',
    'https://whatsapp.com.evil.test/channel/0029Vb8zwQA0gcfBDoRCWM3z',
    'https://whatsapp.com/channel/short',
    'https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z?redirect=evil',
    'https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z#fragment',
    'https://user:pass@whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z',
    ' https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z'
  ])('rejects unsafe channel URL %s', url => {
    expect(normalizeWhatsAppChannelUrl(url)).toBeNull();
    expect(isSafeWhatsAppChannelUrl(url)).toBe(false);
  });
});

describe('subscription calendar renewal', () => {
  it('uses exact UTC calendar months and clamps end-of-month dates', () => {
    expect(addUtcCalendarMonths('2024-01-31T10:15:30.125Z', 1))
      .toBe('2024-02-29T10:15:30.125Z');
    expect(addUtcCalendarMonths('2023-01-31T10:15:30.125Z', 1))
      .toBe('2023-02-28T10:15:30.125Z');
    expect(addUtcCalendarMonths('2024-01-31T10:15:30.125Z', 2))
      .toBe('2024-03-31T10:15:30.125Z');
    expect(addUtcCalendarMonths('2026-11-30T23:59:59.999Z', 3))
      .toBe('2027-02-28T23:59:59.999Z');
  });

  it('extends an active subscription from its later current expiry', () => {
    expect(calculateSubscriptionRenewalWindow({
      currentExpiry: '2026-12-31T08:00:00.000Z',
      settledAt: '2026-10-11T08:00:00.000Z',
      durationMonths: 3
    })).toEqual({
      renewalBaseAt: '2026-12-31T08:00:00.000Z',
      expiresAt: '2027-03-31T08:00:00.000Z'
    });
  });

  it('starts an expired subscription from confirmed payment settlement', () => {
    expect(calculateSubscriptionRenewalWindow({
      currentExpiry: '2026-09-30T08:00:00.000Z',
      settledAt: '2026-10-11T08:00:00.000Z',
      durationMonths: 6
    })).toEqual({
      renewalBaseAt: '2026-10-11T08:00:00.000Z',
      expiresAt: '2027-04-11T08:00:00.000Z'
    });
  });

  it('fails closed for ambiguous timestamps and invalid durations', () => {
    expect(() => addUtcCalendarMonths('2026-10-11', 3)).toThrow(/UTC timestamp/i);
    expect(() => addUtcCalendarMonths('2026-10-11T08:00:00.000Z', 0)).toThrow(/between 1/i);
    expect(() => calculateSubscriptionRenewalWindow({
      settledAt: 'invalid',
      durationMonths: 3
    })).toThrow(/UTC timestamp/i);
  });
});

describe('reader subscription identifiers', () => {
  it('creates a stable, non-reversible SHA-256 account identifier', () => {
    const first = getReaderSubscriptionId('reader-account-123');
    expect(first).toBe(getReaderSubscriptionId('reader-account-123'));
    expect(first).not.toContain('reader-account-123');
    expect(READER_SUBSCRIPTION_ID_PATTERN.test(first)).toBe(true);
    expect(getReaderSubscriptionId('reader-account-124')).not.toBe(first);
  });

  it('rejects identifiers that could normalize ambiguously', () => {
    expect(() => getReaderSubscriptionId(' reader-account-123')).toThrow(/valid reader account/i);
    expect(() => getReaderSubscriptionId('reader\naccount')).toThrow(/valid reader account/i);
    expect(() => getReaderSubscriptionId('')).toThrow(/valid reader account/i);
  });
});

describe('subscription purchase snapshots', () => {
  it('captures only immutable commercial fields from a published plan', () => {
    const snapshot = createSubscriptionPurchaseSnapshot(validPlan({
      coverImage: '/uploads/reader-season.jpg',
      order: 9
    }));
    expect(snapshot).toEqual({
      version: 1,
      planId: 'reader-season',
      planName: 'Reader Season',
      priceKes: 750,
      durationMonths: 4,
      renewable: true
    });
    expect(validateSubscriptionPurchaseSnapshot(snapshot)).toEqual(snapshot);
    expect(isSubscriptionPurchaseSnapshot(snapshot)).toBe(true);
  });

  it('does not permit purchase snapshots for unpublished plans', () => {
    expect(() => createSubscriptionPurchaseSnapshot(validPlan({ isPublished: false })))
      .toThrow(/not currently available/i);
  });

  it.each([
    [{ version: 2 }, 'unsupported version'],
    [{ priceKes: '750' }, 'whole number'],
    [{ durationMonths: 0 }, 'whole number'],
    [{ renewable: 'true' }, 'true or false'],
    [{ injected: true }, 'unsupported field']
  ])('rejects a tampered purchase snapshot %o', (override, message) => {
    const candidate = {
      version: 1,
      planId: 'reader-season',
      planName: 'Reader Season',
      priceKes: 750,
      durationMonths: 4,
      renewable: true,
      ...override
    };
    expect(() => validateSubscriptionPurchaseSnapshot(candidate)).toThrow(message);
    expect(isSubscriptionPurchaseSnapshot(candidate)).toBe(false);
  });
});

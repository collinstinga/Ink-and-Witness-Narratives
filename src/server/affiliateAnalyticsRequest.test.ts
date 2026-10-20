import { describe, expect, it } from 'vitest';

import { AffiliateAnalyticsValidationError } from './affiliateAnalytics.js';
import { parseAffiliateAnalyticsQuery } from './affiliateAnalyticsRequest.js';

describe('affiliate analytics request parsing', () => {
  it('allow-lists supported fields and never reflects unexpected input', () => {
    expect(parseAffiliateAnalyticsQuery({
      startDate: ' 2026-01-01 ',
      endDate: '2026-03-31',
      affiliateId: ' affiliate-1 ',
      articleId: 'piece-1',
      purchaseKind: 'bundle',
      subscriptionPlanId: 'plan-1',
      literaryCircleTierId: 'literary-partner',
      readerEmail: 'must-not-pass@example.test',
      buyerKey: 'abk1_must-not-pass',
    })).toEqual({
      startDate: '2026-01-01',
      endDate: '2026-03-31',
      filters: {
        affiliateId: 'affiliate-1',
        articleId: 'piece-1',
        purchaseKind: 'bundle',
        subscriptionPlanId: 'plan-1',
        literaryCircleTierId: 'literary-partner',
      },
    });
  });

  it('rejects duplicate, malformed, and unsupported values', () => {
    expect(() => parseAffiliateAnalyticsQuery({ affiliateId: ['one', 'two'] }))
      .toThrow(AffiliateAnalyticsValidationError);
    expect(() => parseAffiliateAnalyticsQuery({ purchaseKind: 'tip' }))
      .toThrow('Purchase type must be piece, bundle, or subscription.');
    expect(() => parseAffiliateAnalyticsQuery({ articleId: `piece-${'x'.repeat(300)}` }))
      .toThrow('Piece is invalid.');
    expect(() => parseAffiliateAnalyticsQuery({ subscriptionPlanId: 'plan\u0000hidden' }))
      .toThrow('Subscription plan is invalid.');
  });

  it('omits blank optional filters', () => {
    expect(parseAffiliateAnalyticsQuery({
      startDate: '',
      affiliateId: '   ',
      purchaseKind: undefined,
    })).toEqual({});
  });
});

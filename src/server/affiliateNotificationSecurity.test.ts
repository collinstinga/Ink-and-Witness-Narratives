import { describe, expect, it } from 'vitest';
import {
  createAffiliateMarketingOptOutToken,
  verifyAffiliateMarketingOptOutToken,
} from './affiliateNotificationSecurity.js';

const SECRET = 'affiliate-notification-test-secret-32-characters';

describe('affiliate notification opt-out capability', () => {
  it('round-trips a scoped affiliate marketing opt-out token', () => {
    const token = createAffiliateMarketingOptOutToken('aff_partner-1', SECRET);
    expect(verifyAffiliateMarketingOptOutToken(token, SECRET)).toEqual({ affiliateId: 'aff_partner-1' });
    expect(token).toMatch(/^v1\.marketing\./);
  });

  it('rejects tampering, a different secret and malformed identifiers', () => {
    const token = createAffiliateMarketingOptOutToken('aff_partner-1', SECRET);
    expect(verifyAffiliateMarketingOptOutToken(`${token}x`, SECRET)).toBeNull();
    expect(verifyAffiliateMarketingOptOutToken(token, `${SECRET}-different`)).toBeNull();
    expect(verifyAffiliateMarketingOptOutToken('v1.marketing...signature', SECRET)).toBeNull();
    expect(() => createAffiliateMarketingOptOutToken('../affiliate', SECRET)).toThrow(/identifier/i);
  });
});

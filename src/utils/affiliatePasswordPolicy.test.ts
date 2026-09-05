import { describe, expect, it } from 'vitest';
import { validateAffiliatePasswordForInput } from './affiliatePasswordPolicy.js';

describe('affiliate password input policy', () => {
  it('matches the server strength requirements', () => {
    expect(validateAffiliatePasswordForInput('short1')).toMatch(/at least 8/i);
    expect(validateAffiliatePasswordForInput('onlyletters')).toMatch(/number or special/i);
    expect(validateAffiliatePasswordForInput('12345678')).toMatch(/letter/i);
    expect(validateAffiliatePasswordForInput('StrongPass1')).toBeNull();
    expect(validateAffiliatePasswordForInput('Strong-Pass')).toBeNull();
  });

  it('rejects the historical default and oversized inputs', () => {
    expect(validateAffiliatePasswordForInput('affiliate123')).toMatch(/not permitted/i);
    expect(validateAffiliatePasswordForInput(`A1${'x'.repeat(255)}`)).toMatch(/256 characters or fewer/i);
  });

  it('uses a contextual label in validation messages', () => {
    expect(validateAffiliatePasswordForInput('short1', 'New password')).toMatch(/^New password/);
  });
});

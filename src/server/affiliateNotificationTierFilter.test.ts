import { describe, expect, it } from 'vitest';
import type { AffiliatePublicProfile } from '../types.js';
import { verifiedManualAffiliateNotificationTierIds } from './affiliateNotificationTierFilter.js';

const NOW = '2026-10-24T10:00:00.000Z';

function settings() {
  return { schemaVersion: 1, revision: 2, enabled: true, tiers: [
    { id: 'literary-partner', enabled: true }, { id: 'literary-ambassador', enabled: true },
  ] };
}

function affiliate(source = 'manual'): AffiliatePublicProfile {
  return { id: 'partner-one', literaryCircle: { schemaVersion: 1, tier: {
    id: 'literary-ambassador', source, assignedAt: '2026-10-23T10:00:00.000Z',
  } } } as AffiliatePublicProfile;
}

describe('bounded trusted manual tier-filter recognition', () => {
  it('recognizes only the exact effective manual assignment in current enabled writer settings', () => {
    const account = affiliate(); const config = settings(); const original = structuredClone({ account, config });
    expect(verifiedManualAffiliateNotificationTierIds([account], config, NOW)).toEqual({ 'partner-one': 'literary-ambassador' });
    expect({ account, config }).toEqual(original);
  });

  it.each(['default', 'monthly_performance', 'unknown'])('does not infer current automatic recognition from stored source %s', source => {
    expect(verifiedManualAffiliateNotificationTierIds([affiliate(source)], settings(), NOW)).toEqual({});
  });

  it.each(['missing', 'disabled', 'ambiguous', 'invalid_schema', 'missing_revision', 'empty'])('fails closed on %s settings without fabricated defaults', change => {
    const config: any = settings();
    if (change === 'missing') delete config.tiers;
    if (change === 'disabled') config.tiers[1].enabled = false;
    if (change === 'ambiguous') config.tiers.push({ ...config.tiers[1] });
    if (change === 'invalid_schema') config.schemaVersion = 0;
    if (change === 'missing_revision') delete config.revision;
    if (change === 'empty') config.tiers = [];
    expect(verifiedManualAffiliateNotificationTierIds([affiliate()], config, NOW)).toEqual({});
  });

  it.each([undefined, '2026-10-23', '2026-10-25T10:00:00.000Z'])('rejects missing, noncanonical or future manual assignment time %s', assignedAt => {
    const account = affiliate(); account.literaryCircle!.tier.assignedAt = assignedAt as string;
    expect(verifiedManualAffiliateNotificationTierIds([account], settings(), NOW)).toEqual({});
  });

  it('rejects duplicate recipients and oversized batches rather than silently truncating evidence', () => {
    expect(verifiedManualAffiliateNotificationTierIds([affiliate(), affiliate()], settings(), NOW)).toEqual({});
    const affiliates = Array.from({ length: 201 }, (_, i) => ({ ...affiliate(), id: `partner-${i}` }));
    expect(verifiedManualAffiliateNotificationTierIds(affiliates, settings(), NOW)).toEqual({});
  });
});

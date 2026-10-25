import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliatePublicProfile } from '../types.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import { affiliateTierPeriodDocumentId, type AffiliateTierPeriod } from './affiliateTierPeriods.js';
import {
  readVerifiedAffiliateNotificationMonthlyTiers,
  verifiedAffiliateNotificationMonthlyTiers,
} from './affiliateNotificationMonthlyTiers.js';

const NOW = '2026-10-24T10:00:00.000Z';
function settings() {
  const value = structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
  value.enabled = true; value.revision = 4;
  value.commissionPolicy = { status: 'active', version: 2, effectiveAt: '2026-10-01T00:00:00.000Z', subscriptionRenewalsEligible: false };
  value.tiers[1].monthlyVerifiedSalesThreshold = 2;
  return value;
}
function affiliate(id = 'partner-one', source = 'monthly_performance'): AffiliatePublicProfile {
  return { id, literaryCircle: { schemaVersion: 1, tier: {
    id: 'literary-patron', source, assignedAt: '2026-10-02T00:00:00.000Z', qualificationPeriod: '2026-09', policyVersion: 1,
  } } } as AffiliatePublicProfile;
}
function period(id = 'partner-one', count = 2): AffiliateTierPeriod {
  return { schemaVersion: 1, affiliateId: id, periodKey: '2026-10', revision: 3, evidenceComplete: true,
    awardedMilestones: [], members: Array.from({ length: count }, (_, i) => {
      const checkoutRequestId = `checkout-${id}-${i}`;
      return { checkoutRequestId, createdAt: `2026-10-0${i + 1}T12:00:00.000Z`,
        id: `com_tx_${crypto.createHash('sha256').update(checkoutRequestId).digest('hex').slice(0, 40)}` };
    }) };
}
function input() { return { affiliates: [affiliate()], settings: settings(), periods: new Map<string, unknown>([['partner-one', period()]]), now: NOW }; }

describe('canonical monthly notification tier evidence', () => {
  it('resolves current canonical qualification instead of a stale profile tier, without mutation', () => {
    const value = input(); const before = structuredClone(value);
    const proof = verifiedAffiliateNotificationMonthlyTiers(value);
    expect(proof['partner-one']).toMatchObject({ tierId: 'literary-ambassador', evidenceSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(value).toEqual(before);
    expect(verifiedAffiliateNotificationMonthlyTiers({ ...value, now: '2026-10-25T10:00:00.000Z' })).toEqual(proof);
  });

  it.each(['default', 'monthly_performance'])('requires explicit complete evidence even for source %s and a zero-sale default tier', source => {
    const value = input(); value.affiliates = [affiliate('partner-one', source)]; value.periods.set('partner-one', period('partner-one', 0));
    expect(verifiedAffiliateNotificationMonthlyTiers(value)['partner-one'].tierId).toBe('literary-partner');
    value.periods.clear(); expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });

  it.each(['manual', 'unknown'])('never overrides %s assignments with automatic evidence', source => {
    const value = input(); value.affiliates = [affiliate('partner-one', source)];
    expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });

  it('applies prospective qualification cutoff and exact Nairobi calendar-month boundaries', () => {
    const value = input(); value.settings.qualificationEffectiveFrom = '2026-10-02T00:00:00.000Z';
    expect(verifiedAffiliateNotificationMonthlyTiers(value)['partner-one'].tierId).toBe('literary-partner');
    value.now = '2026-10-31T21:00:00.000Z';
    expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });

  it('uses the previously approved effective policy when a future replacement is not yet effective', () => {
    const value = input();
    value.settings.commissionPolicyHistory = [{ version: 1, status: 'active', effectiveAt: '2026-10-01T00:00:00.000Z',
      confirmedAt: '2026-09-30T00:00:00.000Z', confirmedBy: 'Writer', defaultTierId: value.settings.defaultTierId,
      tiers: structuredClone(value.settings.tiers), subscriptionRenewalsEligible: false }];
    value.settings.commissionPolicy.effectiveAt = '2026-11-01T00:00:00.000Z';
    value.settings.tiers[1].monthlyVerifiedSalesThreshold = 20;
    expect(verifiedAffiliateNotificationMonthlyTiers(value)['partner-one'].tierId).toBe('literary-ambassador');
  });

  it.each(['missing', 'wrong_affiliate', 'wrong_month', 'incomplete', 'bad_revision', 'duplicate', 'invalid_member', 'future_member', 'unknown_field'])('holds %s period evidence without substituting zero', change => {
    const value = input(); const evidence: any = value.periods.get('partner-one');
    if (change === 'missing') value.periods.clear();
    if (change === 'wrong_affiliate') evidence.affiliateId = 'partner-two';
    if (change === 'wrong_month') evidence.periodKey = '2026-09';
    if (change === 'incomplete') evidence.evidenceComplete = false;
    if (change === 'bad_revision') evidence.revision = 0;
    if (change === 'duplicate') evidence.members.push({ ...evidence.members[0] });
    if (change === 'invalid_member') evidence.members[0].id = 'invented';
    if (change === 'future_member') evidence.members[0].createdAt = '2026-10-25T10:00:00.000Z';
    if (change === 'unknown_field') evidence.total = 100;
    expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });

  it.each(['disabled', 'draft', 'future_policy', 'missing_policy', 'missing_revision', 'unknown_timezone', 'coerced_threshold', 'duplicate_tier', 'disabled_default', 'ambiguous_history', 'future_confirmation'])('holds %s policy evidence without normalized defaults', change => {
    const value = input(); const config: any = value.settings;
    if (change === 'disabled') config.enabled = false;
    if (change === 'draft') config.commissionPolicy.status = 'draft';
    if (change === 'future_policy') config.commissionPolicy.effectiveAt = '2026-11-01T00:00:00.000Z';
    if (change === 'missing_policy') delete config.commissionPolicy;
    if (change === 'missing_revision') delete config.revision;
    if (change === 'unknown_timezone') config.qualificationTimezone = 'UTC';
    if (change === 'coerced_threshold') config.tiers[1].monthlyVerifiedSalesThreshold = '2';
    if (change === 'duplicate_tier') config.tiers.push({ ...config.tiers[0] });
    if (change === 'disabled_default') config.tiers[0].enabled = false;
    if (change === 'future_confirmation') config.updatedAt = '2026-10-25T10:00:00.000Z';
    if (change === 'ambiguous_history') config.commissionPolicyHistory = [{ version: 1 }, { version: 1 }];
    expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });

  it.each(['revision', 'summary', 'cutoff', 'threshold', 'assignment'])('pins %s changes even if the resulting selected tier is unchanged', change => {
    const value = input(); const before = verifiedAffiliateNotificationMonthlyTiers(value)['partner-one'];
    if (change === 'revision') value.settings.revision!++;
    if (change === 'summary') (value.periods.get('partner-one') as AffiliateTierPeriod).revision++;
    if (change === 'cutoff') value.settings.qualificationEffectiveFrom = '2026-10-01T00:00:00.000Z';
    if (change === 'threshold') value.settings.tiers[1].monthlyVerifiedSalesThreshold = 1;
    if (change === 'assignment') value.affiliates[0].literaryCircle!.tier.source = 'default';
    const after = verifiedAffiliateNotificationMonthlyTiers(value)['partner-one'];
    expect(after.tierId).toBe(before.tierId); expect(after.evidenceSha256).not.toBe(before.evidenceSha256);
  });

  it('fails closed before reads on duplicate, oversized, invalid-time and invalid-source input', async () => {
    const value = input();
    expect(verifiedAffiliateNotificationMonthlyTiers({ ...value, affiliates: [affiliate(), affiliate()] })).toEqual({});
    expect(verifiedAffiliateNotificationMonthlyTiers({ ...value, affiliates: Array.from({ length: 201 }, (_, i) => affiliate(`partner-${i}`)) })).toEqual({});
    expect(verifiedAffiliateNotificationMonthlyTiers({ ...value, now: '2026-10-24' })).toEqual({});
    value.affiliates[0].literaryCircle!.tier.assignedAt = '2026-10-25T10:00:00.000Z';
    expect(verifiedAffiliateNotificationMonthlyTiers(value)).toEqual({});
  });
});

describe('exact read-only monthly notification tier resolver', () => {
  function harness() {
    const value = input(); const reads: string[] = [];
    const db = { collection: (name: string) => {
      if (name !== 'affiliate_tier_periods') throw new Error('unexpected collection scan');
      return { doc: (id: string) => ({ id, path: `${name}/${id}` }) };
    } };
    const getAll = vi.fn(async (...refs: Array<{ path: string }>) => refs.map(ref => {
      reads.push(ref.path);
      const id = ref.path.endsWith(affiliateTierPeriodDocumentId('partner-one', '2026-10')) ? 'partner-one' : 'partner-two';
      return { ref, exists: value.periods.has(id), data: () => structuredClone(value.periods.get(id)) };
    }));
    return { value, reads, getAll, input: { ...value, db: db as unknown as Firestore, transaction: { getAll } as unknown as Transaction } };
  }

  it('reads exactly one current-month summary per automatic recipient and never queries or writes', async () => {
    const h = harness(); h.value.affiliates.push(affiliate('partner-two', 'manual'));
    expect((await readVerifiedAffiliateNotificationMonthlyTiers(h.input))['partner-one'].tierId).toBe('literary-ambassador');
    expect(h.reads).toEqual([`affiliate_tier_periods/${affiliateTierPeriodDocumentId('partner-one', '2026-10')}`]);
    expect(h.getAll).toHaveBeenCalledTimes(1);
  });

  it('does not bootstrap a missing period or prevent another complete recipient from qualifying', async () => {
    const h = harness(); h.value.affiliates.push(affiliate('partner-two'));
    expect(Object.keys(await readVerifiedAffiliateNotificationMonthlyTiers(h.input))).toEqual(['partner-one']);
    expect(h.reads).toHaveLength(2);
  });

  it.each(['manual', 'disabled', 'duplicate', 'overflow'])('makes no reads for %s input', async change => {
    const h = harness();
    if (change === 'manual') h.value.affiliates[0].literaryCircle!.tier.source = 'manual';
    if (change === 'disabled') h.value.settings.enabled = false;
    if (change === 'duplicate') h.value.affiliates.push(affiliate());
    if (change === 'overflow') h.value.affiliates.push(...Array.from({ length: 200 }, (_, i) => affiliate(`partner-${i}`)));
    expect(await readVerifiedAffiliateNotificationMonthlyTiers(h.input)).toEqual({}); expect(h.reads).toEqual([]);
  });
});

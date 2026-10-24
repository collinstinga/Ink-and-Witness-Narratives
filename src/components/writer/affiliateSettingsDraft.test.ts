import { describe, expect, it } from 'vitest';
import type { AffiliateSettings } from '../../types.js';
import { resolveAffiliateSettingsDraft } from './affiliateSettingsDraft.js';

function settings(minPayoutThresholdKes: number, defaultCommissionRate = 15): AffiliateSettings {
  return { minPayoutThresholdKes, defaultCommissionRate, defaultAttributionDays: 30,
    allowTipsCommission: false, autoApproveCommissions: true, autoApproveDelayHours: 0,
    enablePublicLeaderboard: false, allowSelfRegistration: true, pieceCommissionOverrides: {} };
}

describe('authoritative affiliate settings refresh without losing drafts', () => {
  it('replaces a previously displayed payout minimum with an external newer save on refresh', () => {
    const previous = settings(1000);
    const savedElsewhere = settings(500, 20);
    expect(resolveAffiliateSettingsDraft(previous, savedElsewhere, false)).toBe(savedElsewhere);
    expect(resolveAffiliateSettingsDraft(previous, savedElsewhere, false))
      .toMatchObject({ minPayoutThresholdKes: 500, defaultCommissionRate: 20 });
  });

  it('preserves the pending local payout minimum and other unsaved programme edits while the server refreshes', () => {
    const pendingDraft = settings(250, 18);
    const savedElsewhere = settings(750, 20);
    expect(resolveAffiliateSettingsDraft(pendingDraft, savedElsewhere, true)).toBe(pendingDraft);
    expect(pendingDraft).toMatchObject({ minPayoutThresholdKes: 250, defaultCommissionRate: 18 });
    expect(savedElsewhere).toMatchObject({ minPayoutThresholdKes: 750, defaultCommissionRate: 20 });
  });

  it('accepts the next authoritative value after a successful save clears the dirty draft', () => {
    const pending = settings(250);
    const saved = settings(250);
    const changedLater = settings(600);
    expect(resolveAffiliateSettingsDraft(pending, saved, false)).toBe(saved);
    expect(resolveAffiliateSettingsDraft(saved, changedLater, false)).toBe(changedLater);
  });

  it('initializes an absent editor even if an earlier event marked it dirty', () => {
    const current = settings(500);
    expect(resolveAffiliateSettingsDraft(null, current, true)).toBe(current);
  });
});

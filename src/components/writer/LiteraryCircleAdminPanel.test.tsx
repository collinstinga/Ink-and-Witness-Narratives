import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AffiliatePublicProfile } from '../../types.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from '../../server/literaryCircle.js';
import {
  LiteraryCircleAdminPanel,
  isFinancialLiteraryCirclePolicyChange,
  isoToLocalDateTime,
  localDateTimeToIso,
} from './LiteraryCircleAdminPanel.js';

const affiliate: AffiliatePublicProfile = {
  id: 'affiliate-1',
  affiliateCode: 'FOUNDER1',
  name: 'Founding Partner',
  email: 'partner@example.test',
  phone: '254700000001',
  status: 'active',
  payoutMethod: 'mpesa',
  payoutDetails: {},
  totalClicks: 4,
  uniqueVisitors: 3,
  totalSalesCount: 1,
  totalRevenueKes: 500,
  totalCommissionEarnedKes: 75,
  totalCommissionPaidKes: 0,
  balanceAvailableKes: 75,
  balancePendingKes: 0,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
};

describe('LiteraryCircleAdminPanel', () => {
  it('keeps access, recognition, and draft commission controls visibly separated', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleAdminPanel
        settings={DEFAULT_LITERARY_CIRCLE_SETTINGS}
        affiliates={[affiliate]}
        savingSettings={false}
        onSaveSettings={vi.fn(async settings => settings)}
        onUpdateMembership={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('Literary Circle Management');
    expect(markup).toContain('Complimentary reading is not a sale');
    expect(markup).toContain('Draft: existing affiliate commission arrangements remain in force.');
    expect(markup).toContain('Permanently recognize this account as a Founding Literary Partner');
    expect(markup).toContain('Migration pending');
    expect(markup).toContain('Subscription renewals earn commission');
    expect(markup).toContain('Private community bulletin');
    expect(markup).toContain('Add bulletin item');
    expect(markup).toContain('Drafts stay writer-only');
    expect(markup).not.toContain('partner@example.test');
  });

  it('round-trips valid local date-time values and rejects invalid values', () => {
    const local = isoToLocalDateTime('2026-10-16T09:30:00.000Z');
    expect(local).toMatch(/^2026-10-16T/);
    expect(localDateTimeToIso(local)).toMatch(/^2026-10-16T/);
    expect(localDateTimeToIso('not-a-date')).toBeUndefined();
    expect(isoToLocalDateTime('not-a-date')).toBe('');
  });

  it('keeps unpublished community bulletin drafts editable in the writer-only panel', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleAdminPanel
        settings={{
          ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
          community: {
            ...DEFAULT_LITERARY_CIRCLE_SETTINGS.community,
            posts: [{
              id: 'campaign-draft',
              type: 'monthly_campaign',
              title: 'October reading campaign',
              body: 'Draft guidance for partners.',
              isPublished: false,
              order: 0,
            }],
          },
        }}
        affiliates={[]}
        savingSettings={false}
        onSaveSettings={vi.fn(async settings => settings)}
        onUpdateMembership={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('October reading campaign');
    expect(markup).toContain('Draft guidance for partners.');
    expect(markup).toContain('Publish this item to approved affiliates');
    expect(markup).toContain('Stable ID: campaign-draft');
  });

  it('shows a privacy-bounded monthly performance ledger with recorded snapshots', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleAdminPanel
        settings={DEFAULT_LITERARY_CIRCLE_SETTINGS}
        affiliates={[affiliate]}
        performanceReports={[{
          affiliateId: affiliate.id,
          affiliateCode: affiliate.affiliateCode,
          affiliateName: affiliate.name,
          periods: [{
            periodKey: '2026-10',
            startsAt: '2026-09-30T21:00:00.000Z',
            endsAt: '2026-10-31T20:59:59.999Z',
            isCurrent: true,
            verifiedSales: 2,
            qualifyingSales: 2,
            grossSalesKes: 500,
            commissionEarnedKes: 75,
            retainedRevenueKes: 425,
            pieceSales: 2,
            bundleSales: 0,
            subscriptionSales: 0,
            reversedOrRejectedSales: 0,
            qualifiedTier: DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers[0],
            qualificationMode: 'projected',
            policyVersion: 1,
            recordedTierIds: ['literary-partner'],
            recordedPolicyVersions: [1],
          }],
        }]}
        savingSettings={false}
        onSaveSettings={vi.fn(async settings => settings)}
        onUpdateMembership={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('Monthly performance ledger');
    expect(markup).toContain('KES 500');
    expect(markup).toContain('KES 75');
    expect(markup).toContain('Tier: literary-partner');
    expect(markup).toContain('Policy: v1');
    expect(markup).not.toContain(affiliate.email);
  });

  it('distinguishes financial policy changes from ordinary programme copy edits', () => {
    expect(isFinancialLiteraryCirclePolicyChange(
      DEFAULT_LITERARY_CIRCLE_SETTINGS,
      {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
        community: {
          ...DEFAULT_LITERARY_CIRCLE_SETTINGS.community,
          description: 'Updated private community description.'
        }
      }
    )).toBe(false);
    expect(isFinancialLiteraryCirclePolicyChange(
      DEFAULT_LITERARY_CIRCLE_SETTINGS,
      {
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
        tiers: DEFAULT_LITERARY_CIRCLE_SETTINGS.tiers.map((tier, index) => index === 0
          ? { ...tier, proposedCommissionRate: 16 }
          : tier)
      }
    )).toBe(true);
  });
});

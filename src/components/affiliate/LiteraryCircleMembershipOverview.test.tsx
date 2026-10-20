import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { LiteraryCircleDashboardSummary } from '../../types.js';
import {
  getSafeCommunityInviteUrl,
  LiteraryCircleMembershipOverview,
} from './LiteraryCircleMembershipOverview.js';

const summary = (overrides: Partial<LiteraryCircleDashboardSummary> = {}): LiteraryCircleDashboardSummary => ({
  enabled: true,
  foundingMember: true,
  complimentaryAccessStatus: 'active',
  currentTier: {
    id: 'literary-partner',
    name: 'Literary Partner',
    description: 'The default circle membership.',
    rank: 1,
    monthlyVerifiedSalesThreshold: 0,
    proposedCommissionRate: 15,
    enabled: true,
    badgeLabel: 'Partner',
  },
  nextTier: {
    id: 'literary-ambassador',
    name: 'Literary Ambassador',
    description: 'Recognised monthly performance.',
    rank: 2,
    monthlyVerifiedSalesThreshold: 10,
    proposedCommissionRate: 20,
    enabled: true,
    badgeLabel: 'Ambassador',
  },
  monthlyVerifiedSales: 4,
  lifetimeVerifiedSales: 12,
  progressToNextTierPercent: 40,
  salesToNextTier: 6,
  onboarding: {
    version: 1,
    audience: 'existing_upgrade',
    status: 'not_started',
    completedStepIds: [],
    welcomeRequired: true,
  },
  introductoryPeriodActive: false,
  commissionPolicyStatus: 'draft',
  community: {
    enabled: true,
    title: 'Private Literary Circle',
    description: 'Writer announcements and release previews.',
    whatsappInviteUrl: 'https://chat.whatsapp.com/example',
  },
  ...overrides,
});

describe('LiteraryCircleMembershipOverview', () => {
  it('renders founding recognition, access, tier progress, and non-retroactive draft wording', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleMembershipOverview
        summary={summary()}
        affiliateName="Amina"
        activeCommissionRate={17}
        onOpenCatalogue={vi.fn()}
      />,
    );

    expect(markup).toContain('Welcome, Amina');
    expect(markup).toContain('Founding Literary Partner');
    expect(markup).toContain('Active · every current and future published piece');
    expect(markup).toContain('15%');
    expect(markup).toContain('Your existing 17% arrangement remains in force');
    expect(markup).toContain('never reduced or recalculated retroactively');
    expect(markup).toContain('Next: Literary Ambassador');
    expect(markup).toContain('aria-valuenow="40"');
    expect(markup).toContain('href="https://chat.whatsapp.com/example"');
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it('omits private community details when the writer disables the community', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleMembershipOverview
        summary={summary({
          community: {
            enabled: false,
            title: 'Hidden community',
            description: 'This must stay private while disabled.',
            whatsappInviteUrl: 'https://chat.whatsapp.com/hidden',
          },
        })}
        affiliateName="Amina"
        activeCommissionRate={15}
      />,
    );

    expect(markup).not.toContain('Hidden community');
    expect(markup).not.toContain('chat.whatsapp.com/hidden');
  });

  it('renders bounded historical performance without changing recorded earnings', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleMembershipOverview
        summary={summary({
          performancePeriods: [{
            periodKey: '2026-10',
            startsAt: '2026-09-30T21:00:00.000Z',
            endsAt: '2026-10-31T20:59:59.999Z',
            isCurrent: true,
            verifiedSales: 4,
            qualifyingSales: 3,
            grossSalesKes: 1400,
            commissionEarnedKes: 280,
            retainedRevenueKes: 1120,
            pieceSales: 3,
            bundleSales: 1,
            subscriptionSales: 0,
            reversedOrRejectedSales: 1,
            qualifiedTier: {
              id: 'literary-partner',
              name: 'Literary Partner',
              description: 'Default tier',
              rank: 1,
              monthlyVerifiedSalesThreshold: 0,
              proposedCommissionRate: 15,
              enabled: true,
            },
            qualificationMode: 'projected',
            policyVersion: 2,
            recordedTierIds: ['literary-partner'],
            recordedPolicyVersions: [1],
          }],
        })}
        affiliateName="Amina"
        activeCommissionRate={15}
      />,
    );

    expect(markup).toContain('Six-month performance record');
    expect(markup).toContain('4');
    expect(markup).toContain('3 qualifying');
    expect(markup).toContain('KES 1,400');
    expect(markup).toContain('KES 280');
    expect(markup).toContain('projected');
    expect(markup).toContain('aria-label="Six-month affiliate performance table"');
    expect(markup).toContain('<caption class="sr-only">');
    expect(markup).toContain('scope="col"');
    expect(markup).toContain('tabindex="0"');
  });

  it('allows only secure external community invitation links', () => {
    expect(getSafeCommunityInviteUrl('javascript:alert(1)')).toBeNull();
    expect(getSafeCommunityInviteUrl('http://chat.whatsapp.com/insecure')).toBeNull();
    expect(getSafeCommunityInviteUrl('https://example.com/not-whatsapp')).toBeNull();
    expect(getSafeCommunityInviteUrl('https://chat.whatsapp.com/safe')).toBe('https://chat.whatsapp.com/safe');
  });
});

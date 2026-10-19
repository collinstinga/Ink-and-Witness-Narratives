import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AffiliateNotificationPreferences } from '../../types.js';
import {
  AffiliateNotificationPreferencesPanel,
  affiliatePreferencesToDraft,
} from './AffiliateNotificationPreferencesPanel.js';

const preferences = (overrides: Partial<AffiliateNotificationPreferences> = {}): AffiliateNotificationPreferences => ({
  schemaVersion: 1,
  revision: 0,
  marketingConsent: 'unknown',
  releaseUpdates: false,
  campaignUpdates: false,
  inactivityReminders: false,
  exclusiveOpportunities: false,
  commissionAlerts: true,
  tierAlerts: true,
  allMarketingOptOut: true,
  ...overrides,
});

describe('AffiliateNotificationPreferencesPanel', () => {
  it('does not treat unknown or opted-out consent as permission to market', () => {
    expect(affiliatePreferencesToDraft(preferences())).toMatchObject({
      marketingConsent: false,
      releaseUpdates: false,
      campaignUpdates: false,
    });
    expect(affiliatePreferencesToDraft(preferences({
      marketingConsent: 'granted',
      allMarketingOptOut: true,
      releaseUpdates: true,
    })).marketingConsent).toBe(false);
  });

  it('reflects a current granted choice without conflating operational alerts', () => {
    expect(affiliatePreferencesToDraft(preferences({
      marketingConsent: 'granted',
      allMarketingOptOut: false,
      releaseUpdates: true,
      commissionAlerts: false,
    }))).toEqual({
      marketingConsent: true,
      releaseUpdates: true,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: false,
      commissionAlerts: false,
      tierAlerts: true,
    });
  });

  it('renders a bounded loading state before private preferences arrive', () => {
    const markup = renderToStaticMarkup(<AffiliateNotificationPreferencesPanel />);
    expect(markup).toContain('Loading communication preferences');
    expect(markup).toContain('role="status"');
  });
});

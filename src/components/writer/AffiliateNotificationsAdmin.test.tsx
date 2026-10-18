import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from '../../server/affiliateNotifications.js';
import { AffiliateNotificationsAdmin } from './AffiliateNotificationsAdmin.js';

const settings = () => JSON.parse(JSON.stringify(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS));

describe('AffiliateNotificationsAdmin', () => {
  it('renders all seven separate partner events behind the preview-only gate', () => {
    const markup = renderToStaticMarkup(
      <AffiliateNotificationsAdmin
        settings={settings()}
        providerConfigured={false}
        onSave={vi.fn(async value => value)}
        onCheckEligibility={vi.fn(async eventType => ({
          eventType,
          total: 0,
          eligible: 0,
          excluded: 0,
          reasons: {},
        }))}
      />,
    );

    expect(markup).toContain('Partner notifications');
    expect(markup).toContain('Preview-only safety gate');
    expect(markup).toContain('Literary Circle activation');
    expect(markup).toContain('New release');
    expect(markup).toContain('Upcoming campaign');
    expect(markup).toContain('New commission');
    expect(markup).toContain('Tier upgrade');
    expect(markup).toContain('Inactivity reminder');
    expect(markup).toContain('Exclusive opportunity');
    expect(markup).not.toMatch(/send now/i);
  });

  it('makes approval and separate marketing consent visible as immutable safety requirements', () => {
    const markup = renderToStaticMarkup(
      <AffiliateNotificationsAdmin
        settings={settings()}
        providerConfigured
        onSave={vi.fn(async value => value)}
        onCheckEligibility={vi.fn(async eventType => ({
          eventType,
          total: 9,
          eligible: 0,
          excluded: 9,
          reasons: { writer_approval_missing: 9 },
        }))}
      />,
    );

    expect(markup).toContain('Writer approval, active status, valid email and accepted terms are mandatory');
    expect(markup).toContain('separate marketing consent');
    expect(markup).toContain('configured, but delivery locked');
    expect(markup).toContain('Saving never sends a message');
  });

  it('locks the editor while a mutation is in flight', () => {
    const draft = settings();
    draft.templates[0].subject = 'Changed subject';
    const markup = renderToStaticMarkup(
      <AffiliateNotificationsAdmin
        settings={draft}
        providerConfigured={false}
        saving
        onSave={vi.fn(async value => value)}
        onCheckEligibility={vi.fn(async eventType => ({
          eventType,
          total: 0,
          eligible: 0,
          excluded: 0,
          reasons: {},
        }))}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
  });
});

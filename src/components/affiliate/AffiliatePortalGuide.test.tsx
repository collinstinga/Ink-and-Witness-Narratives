import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import AffiliatePortalGuide from './AffiliatePortalGuide.js';
import { affiliatePortalGuide } from '../../data/affiliatePortalGuide.js';
import { PortalGuidePanel } from '../guides/PortalGuideDialog.js';

describe('AffiliatePortalGuide', () => {
  it('is absent while closed and preserves callbacks without executing them during rendering', () => {
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    expect(renderToStaticMarkup(<AffiliatePortalGuide open={false} onClose={onClose} onNavigate={onNavigate} />)).toBe('');
    const markup = renderToStaticMarkup(<AffiliatePortalGuide open onClose={onClose} onNavigate={onNavigate} />);
    expect(markup).toContain('Literary Circle Guide &amp; Demo');
    expect(markup).toContain('Start safe demo');
    expect(markup).toContain('Find a feature or task');
    expect(markup).toContain('Open Overview &amp; Stats');
    expect(onClose).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps every topic readable without granting pre-terms navigation', () => {
    const markup = renderToStaticMarkup(<AffiliatePortalGuide
      open
      onClose={() => undefined}
      navigationNotice="Review programme terms before opening dashboard tabs."
    />);
    for (const item of affiliatePortalGuide.sections) {
      const escapedTitle = item.title.replace(/&/g, '&amp;').replace(/'/g, '&#x27;');
      expect(markup).toContain(escapedTitle);
    }
    expect(markup).toContain('Review programme terms before opening dashboard tabs.');
    expect(markup).not.toContain('>Open Overview &amp; Stats<');
  });

  it('lets the permanent guide search locate specific financial and privacy help', () => {
    const payoutMarkup = renderToStaticMarkup(<PortalGuidePanel
      guide={affiliatePortalGuide}
      onClose={() => undefined}
      initialQuery="payouts threshold"
    />);
    expect(payoutMarkup).toContain('Set your payout details and request earnings');
    expect(payoutMarkup).toContain('not fixed by this guide');
    const privacyMarkup = renderToStaticMarkup(<PortalGuidePanel
      guide={affiliatePortalGuide}
      onClose={() => undefined}
      initialQuery="optional marketing consent"
    />);
    expect(privacyMarkup).toContain('Programme terms are not consent to optional marketing.');
  });

  it('is a conditional lazy overlay, not an account action or replacement dashboard', () => {
    const source = readFileSync(new URL('./AffiliateDashboardModal.tsx', import.meta.url), 'utf8');
    const wrapper = readFileSync(new URL('./AffiliatePortalGuide.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/const AffiliatePortalGuide = React\.lazy\([\s\S]*?import\('\.\/AffiliatePortalGuide\.js'\)/);
    expect(source).toContain('{showPortalGuide ? (');
    expect(source).toContain('aria-haspopup="dialog"');
    expect(source.indexOf('id="affiliate-portal-guide-btn"')).toBeLessThan(source.indexOf('id="affiliate-quick-copy-default-btn"'));
    const integration = source.match(/<AffiliatePortalGuide\s([\s\S]*?)\/>/)?.[1] || '';
    expect(integration).not.toContain('onNavigate=');
    expect(integration).toContain('never switches your live dashboard tab');
    expect(source).toContain('<PortalGuideLoadBoundary onClose={() => setShowPortalGuide(false)}>');
    expect(wrapper).not.toMatch(/api\.|fetch\(|localStorage|sessionStorage|onboarding|payoutAmount|useEffect/);
    expect(source).not.toContain('30-day attribution cookie');
    expect(source).not.toContain('15% Flatbed Rate');
    expect(source).not.toContain('data.totalConfirmedSales / data.clicks');
  });
});

import { describe, expect, it } from 'vitest';
import { affiliatePortalGuide } from './affiliatePortalGuide.js';

const section = (id: string) => {
  const found = affiliatePortalGuide.sections.find(item => item.id === id);
  expect(found, `Missing guide topic: ${id}`).toBeDefined();
  return JSON.stringify(found);
};

describe('permanent Literary Circle guide content', () => {
  it('has unique topics, useful steps and only real portal destinations', () => {
    const sections = affiliatePortalGuide.sections;
    const destinations = new Set(['overview', 'resources', 'links', 'sales', 'payouts', 'settings']);
    expect(sections.length).toBeGreaterThanOrEqual(12);
    expect(new Set(sections.map(item => item.id)).size).toBe(sections.length);
    for (const item of sections) {
      expect(item.title.length).toBeGreaterThan(8);
      expect(item.summary.length).toBeGreaterThan(15);
      expect(item.steps.length).toBeGreaterThanOrEqual(3);
      expect(destinations.has(item.destination || '')).toBe(true);
      expect(item.destinationLabel).toBeTruthy();
      expect(item.keywords?.length).toBeGreaterThan(0);
    }
    for (const step of affiliatePortalGuide.journey) {
      expect(sections.some(item => item.id === step.sectionId)).toBe(true);
    }
    expect(affiliatePortalGuide.journey.length).toBeGreaterThanOrEqual(6);
  });

  it('preserves existing identity and separates founding recognition from performance tiers', () => {
    expect(section('welcome')).toContain('do not need to register again');
    expect(section('membership')).toContain('independent of the current tier');
    expect(section('membership')).toContain('existing commission arrangement remains in force');
    expect(section('membership')).toContain('do not retroactively recalculate');
    expect(section('library')).toContain('does not add permanently purchased library items');
    expect(section('library')).toContain('record a sale, or earn commission');
    expect(section('library')).toContain('server');
  });

  it('explains first-checkout attribution without implying lifetime customer commission', () => {
    expect(section('attribution')).toContain('single-use and bound to one eligible checkout journey');
    expect(section('attribution')).toContain('Only confirmed payment earns commission');
    expect(section('attribution')).toContain('later session is not automatically your referral forever');
    expect(section('attribution')).toContain('renewals qualify only if the writer has enabled them');
    expect(section('links')).toContain('a collection, a bundle');
    expect(section('links')).toContain('subscription plan');
  });

  it('does not hardcode financial policy, claim exact visitors or promise live email', () => {
    expect(section('statistics')).toContain('estimates');
    expect(section('statistics')).toContain('not your wallet or the writer’s net profit');
    expect(section('payouts')).toContain('not fixed by this guide');
    expect(section('payouts')).toContain('does not itself prove that money was sent');
    expect(section('notifications')).toContain('do not mean that automated emails are live');
    expect(JSON.stringify(affiliatePortalGuide)).not.toMatch(/(?:KES|Ksh)\s*1[,.]?000|\b(?:15|20|25)%/i);
  });

  it('keeps marketing voluntary, private invitations unembedded and demo non-mutating', () => {
    expect(section('community')).toContain('Joining an external group is your choice');
    expect(section('notifications')).toContain('Opting out of optional marketing does not remove');
    expect(section('security')).toContain('do not pay again');
    expect(affiliatePortalGuide.intro).toContain('does not create a sale, send a message, request money, or change your account');
    expect(JSON.stringify(affiliatePortalGuide)).not.toMatch(/https?:\/\/|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  });
});

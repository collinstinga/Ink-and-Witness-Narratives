import { describe, expect, it, vi } from 'vitest';
import type { AffiliatePublicProfile } from '../types.js';

const database = vi.hoisted(() => ({ getDb: vi.fn(), getFirestoreDoc: vi.fn() }));
vi.mock('./db.js', () => ({ ...database, sanitizeForFirestore: (value: unknown) => value }));

import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import {
  AFFILIATE_MARKETING_DISCLOSURE_VERSION,
  DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
} from './affiliateNotificationPreferences.js';
import { planAffiliateNotifications, type AffiliateNotificationSource } from './affiliateNotificationPlan.js';

const NOW = '2026-10-23T06:00:00.000Z';
const source: AffiliateNotificationSource = {
  eventType: 'new_commission', sourceId: 'commission-one', sourceVersion: 1,
  occurredAt: '2026-10-23T05:00:00.000Z', targetAffiliateId: 'partner-one',
};

function affiliate(overrides: Partial<AffiliatePublicProfile> = {}): AffiliatePublicProfile {
  return {
    id: 'partner-one', status: 'active', email: 'partner@example.test', name: 'Private Partner',
    approvedAt: '2026-10-01T00:00:00.000Z', approvedBy: 'Writer', acceptedTerms: true,
    literaryCircle: {
      schemaVersion: 1, foundingMember: true, memberSince: '2026-10-01T00:00:00.000Z',
      complimentaryAccess: { status: 'active', scope: 'all_published', grantedAt: NOW, updatedAt: NOW, updatedBy: 'Writer' },
      tier: { id: 'literary-partner', assignedAt: NOW, source: 'default' },
      onboarding: { version: 1, audience: 'existing_upgrade', status: 'completed', completedStepIds: [], welcomeRequired: false },
    },
    ...overrides,
  } as AffiliatePublicProfile;
}

function settings() {
  const value = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  value.enabled = true;
  value.templates.forEach(template => { template.enabled = true; });
  return value;
}

function input() {
  return { source: { ...source }, settings: settings(), affiliates: [affiliate()], now: NOW };
}

describe('held partner notification planning', () => {
  it('uses the verified upgrade destination for tier filters without changing membership', () => {
    const candidate = input();
    candidate.source.eventType = 'tier_upgrade';
    candidate.settings.templates.find(template => template.eventType === 'tier_upgrade')!.eligibility.tierIds = ['literary-ambassador'];
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
    candidate.source.targetTierId = 'literary-ambassador';
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(1);
    expect(candidate.affiliates[0].literaryCircle!.tier.id).toBe('literary-partner');
    candidate.source.eventType = 'new_commission';
    expect(() => planAffiliateNotifications(candidate)).toThrow('Invalid partner notification planning input.');
  });

  it('explicitly declines automatic general tier filters instead of using a stale stored default', () => {
    const candidate = input();
    candidate.settings.templates.find(template => template.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { automatic_tier_filter_requires_verified_evidence: 1 } });
    candidate.affiliates[0].literaryCircle!.tier.source = 'monthly_performance';
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { automatic_tier_filter_requires_verified_evidence: 1 } });
    // Even a guessed map cannot convert an automatic profile into manual proof.
    expect(planAffiliateNotifications({ ...candidate, verifiedManualTierIds: { 'partner-one': 'literary-partner' } }).intents).toEqual([]);
    candidate.settings.templates.find(template => template.eventType === 'new_commission')!.eligibility.tierIds = [];
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(1);
  });

  it('requires current settings evidence for manual tier filters without changing ordinary audiences', () => {
    const candidate = input();
    candidate.settings.templates.find(template => template.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
    candidate.affiliates[0].literaryCircle!.tier.source = 'manual';
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { manual_tier_filter_requires_current_settings: 1 } });
    expect(planAffiliateNotifications({ ...candidate, verifiedManualTierIds: { 'partner-one': 'literary-partner' } }).intents).toHaveLength(1);
    expect(planAffiliateNotifications({ ...candidate, verifiedManualTierIds: { 'partner-one': 'literary-ambassador' } }).intents).toEqual([]);
  });

  it('creates stable IDs across retries, recipient order and template revisions', () => {
    const first = input();
    const expected = planAffiliateNotifications(first);
    first.settings.revision++;
    first.affiliates.unshift(affiliate({ id: 'partner-two' }));
    first.now = '2026-10-23T07:00:00.000Z';
    const retry = planAffiliateNotifications(first);
    expect(retry.eventId).toBe(expected.eventId);
    expect(retry.intents[0].id).toBe(expected.intents[0].id);
    expect(retry.intents[0].state).toBe('held');
    expect(retry.intents[0].settingsRevision).toBe(1);
    expect(retry.excluded).toBe(1);
  });

  it('isolates source event versions and targeted recipients', () => {
    const first = planAffiliateNotifications(input());
    const changed = input();
    changed.source.sourceVersion = 2;
    expect(planAffiliateNotifications(changed).eventId).not.toBe(first.eventId);
    changed.source = { ...source, targetAffiliateId: 'partner-two' };
    changed.affiliates = [affiliate({ id: 'partner-two' })];
    expect(planAffiliateNotifications(changed).intents[0].id).not.toBe(first.intents[0].id);
  });

  it.each(['activation', 'new_commission', 'tier_upgrade'] as const)('never broadcasts %s', eventType => {
    const candidate = input();
    candidate.source.eventType = eventType;
    candidate.affiliates.push(affiliate({ id: 'partner-two' }));
    expect(planAffiliateNotifications(candidate).intents.map(intent => intent.affiliateId)).toEqual(['partner-one']);
    delete candidate.source.targetAffiliateId;
    expect(() => planAffiliateNotifications(candidate)).toThrow('Invalid partner notification planning input.');
  });

  it('uses source time plus configured delay, not retry time', () => {
    const candidate = input();
    candidate.settings.templates.find(template => template.eventType === 'new_commission')!.timing.delayMinutes = 90;
    expect(planAffiliateNotifications(candidate).intents[0].dueAt).toBe('2026-10-23T06:30:00.000Z');
  });

  it.each([{ status: 'suspended' }, { approvedAt: undefined }, { acceptedTerms: false }, { email: 'invalid' }] as Partial<AffiliatePublicProfile>[])('excludes accounts that fail existing eligibility: %j', overrides => {
    const candidate = input();
    candidate.affiliates = [affiliate(overrides)];
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], excluded: 1 });
  });

  it('requires current marketing consent and observes an opt-out before a retry', () => {
    const candidate = input();
    candidate.source = { eventType: 'new_release', sourceId: 'piece-one', sourceVersion: 1, occurredAt: source.occurredAt };
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
    candidate.affiliates[0].notificationPreferences = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: source.occurredAt, marketingConsentSource: 'affiliate_dashboard',
      releaseUpdatesEnabledAt: source.occurredAt,
      allMarketingOptOut: false, releaseUpdates: true,
    };
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(1);
    candidate.affiliates[0].notificationPreferences.allMarketingOptOut = true;
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
  });

  it.each([
    ['2026-10-23T04:59:59.999Z', 1],
    [source.occurredAt, 1],
    ['2026-10-23T05:00:00.001Z', 0],
    [NOW, 0],
    ['2026-10-24T00:00:00.000Z', 0],
  ] as const)('prevents historical release backlogs for consent at %s', (consentAt, count) => {
    const candidate = input();
    candidate.source = { eventType: 'new_release', sourceId: 'piece-one', sourceVersion: 1, occurredAt: source.occurredAt };
    candidate.affiliates[0].notificationPreferences = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: consentAt, marketingConsentSource: 'affiliate_dashboard',
      releaseUpdatesEnabledAt: source.occurredAt,
      allMarketingOptOut: false, releaseUpdates: true,
    };
    const initial = planAffiliateNotifications(candidate);
    expect(initial.intents).toHaveLength(count);
    candidate.now = '2026-10-25T00:00:00.000Z';
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(count);
    if (!count) expect(initial.reasons).toEqual({ marketing_consent_after_event: 1 });
  });

  it('does not prepare an intent before a recorded writer approval takes effect', () => {
    const candidate = input();
    candidate.affiliates[0].approvedAt = '2026-10-24T00:00:00.000Z';
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { writer_approval_not_effective: 1 } });
  });

  it('keeps operational commission alerts independent of marketing consent', () => {
    const candidate = input();
    candidate.affiliates[0].notificationPreferences = { ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES };
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(1);
    candidate.affiliates[0].notificationPreferences.commissionAlerts = false;
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
  });

  it.each([
    [undefined, 0], ['not-a-date', 0], ['2026-10-23', 0],
    ['2026-10-23T08:00:00+03:00', 0],
    ['2026-10-23T04:59:59.999Z', 1], [source.occurredAt, 1],
    ['2026-10-23T05:00:00.001Z', 0], [NOW, 0],
  ] as const)('requires independent release-topic opt-in evidence at %s', (releaseUpdatesEnabledAt, count) => {
    const candidate = input();
    candidate.source = { eventType: 'new_release', sourceId: 'piece-one', sourceVersion: 1, occurredAt: source.occurredAt };
    candidate.affiliates[0].notificationPreferences = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', marketingConsentSource: 'affiliate_dashboard',
      allMarketingOptOut: false, releaseUpdates: true, releaseUpdatesEnabledAt,
    };
    const initial = planAffiliateNotifications(candidate);
    expect(initial.intents).toHaveLength(count);
    candidate.now = '2026-10-25T00:00:00.000Z';
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(count);
    if (!count) expect(initial.reasons).toEqual({ release_opt_in_after_event: 1 });
  });

  it('honors global and per-template disabled switches', () => {
    const candidate = input();
    candidate.settings.enabled = false;
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
    candidate.settings.enabled = true;
    candidate.settings.templates.find(template => template.eventType === 'new_commission')!.enabled = false;
    expect(planAffiliateNotifications(candidate).intents).toEqual([]);
  });

  it.each(['upcoming_campaign', 'exclusive_opportunity', 'inactivity_reminder'] as const)('requires exact scheduling bounds and event-time topic consent for %s', eventType => {
    const candidate = input();
    candidate.source = { eventType, sourceId: 'scheduled-one', sourceVersion: 1,
      occurredAt: source.occurredAt, notBefore: source.occurredAt, expiresAt: '2026-10-24T00:00:00.000Z',
      ...(eventType === 'inactivity_reminder' ? { targetAffiliateId: 'partner-one' } : { evidenceId: 'audit-one' }),
    };
    candidate.affiliates[0].notificationPreferences = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false,
      campaignUpdates: true, campaignUpdatesEnabledAt: '2026-10-01T00:00:00.000Z',
      inactivityReminders: true, inactivityRemindersEnabledAt: '2026-10-01T00:00:00.000Z',
      exclusiveOpportunities: true, exclusiveOpportunitiesEnabledAt: '2026-10-01T00:00:00.000Z',
    };
    expect(planAffiliateNotifications(candidate).intents).toHaveLength(1);
    const field = eventType === 'upcoming_campaign' ? 'campaignUpdatesEnabledAt'
      : eventType === 'inactivity_reminder' ? 'inactivityRemindersEnabledAt' : 'exclusiveOpportunitiesEnabledAt';
    candidate.affiliates[0].notificationPreferences[field] = NOW;
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { topic_opt_in_after_event: 1 } });
    candidate.affiliates[0].notificationPreferences[field] = '2026-10-01T00:00:00.000Z';
    candidate.now = candidate.source.expiresAt!;
    expect(planAffiliateNotifications(candidate)).toMatchObject({ intents: [], reasons: { scheduled_event_expired: 1 } });
    candidate.now = NOW;
    delete candidate.source.expiresAt;
    expect(() => planAffiliateNotifications(candidate)).toThrow('Invalid partner notification planning input.');
  });

  it('rejects duplicate recipients and bounds the batch without silently truncating', () => {
    const candidate = input();
    candidate.affiliates.push(affiliate());
    expect(() => planAffiliateNotifications(candidate)).toThrow();
    candidate.affiliates = Array.from({ length: 201 }, (_, i) => affiliate({ id: `partner-${i}` }));
    expect(() => planAffiliateNotifications(candidate)).toThrow();
  });

  it.each([
    { sourceId: undefined }, { sourceId: 'private@example.test' }, { sourceVersion: 0 },
    { eventType: 'inactivity_reminder' }, { occurredAt: 'tomorrow' },
    { occurredAt: '2026-10-24T00:00:00.000Z' }, { receipt: 'private-receipt' },
  ])('rejects unsupported or corrupt source evidence without reflecting it: %j', patch => {
    const candidate = input();
    Object.assign(candidate.source, patch);
    expect(() => planAffiliateNotifications(candidate)).toThrow('Invalid partner notification planning input.');
  });

  it('does not copy recipient details or source IDs, mutate inputs, or access a database', () => {
    const candidate = input();
    const original = structuredClone(candidate);
    const serialized = JSON.stringify(planAffiliateNotifications(candidate));
    for (const privateValue of ['Private Partner', 'partner@example.test', 'commission-one']) {
      expect(serialized).not.toContain(privateValue);
    }
    expect(candidate).toEqual(original);
    expect(database.getDb).not.toHaveBeenCalled();
    expect(database.getFirestoreDoc).not.toHaveBeenCalled();
  });
});

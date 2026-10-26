import crypto from 'crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

vi.mock('./db.js', () => ({
  getFirestoreClientTarget: (client: { projectId?: string; databaseId?: string }) => ({ projectId: client.projectId, firestoreDatabaseId: client.databaseId }),
  getDb: vi.fn(() => { throw new Error('No implicit database is permitted'); }),
  getFirestoreDoc: vi.fn(), sanitizeForFirestore: (value: unknown) => value,
}));

import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS, validateAffiliateNotificationSettings } from './affiliateNotifications.js';
import { AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN, AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT,
  affiliateNotificationRolloutHash } from './affiliateNotificationRollout.js';
import { DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES, AFFILIATE_MARKETING_DISCLOSURE_VERSION } from './affiliateNotificationPreferences.js';
import { prepareScheduledAffiliateNotifications, resolveScheduledAffiliateNotificationSource } from './affiliateNotificationSchedule.js';
import { resolveAffiliateNotificationSource } from './affiliateNotificationEvents.js';
import type { AffiliateNotificationSource } from './affiliateNotificationPlan.js';

const NOW = '2026-10-23T10:00:00.000Z';
const EARLY = '2026-10-01T00:00:00.000Z';
const ENV: NodeJS.ProcessEnv = { AFFILIATE_NOTIFICATION_EVENT_MODE: 'held', FIREBASE_PROJECT_ID: 'ink-witness-staging',
  LITERARY_CIRCLE_STAGING_PROJECT_IDS: 'ink-witness-staging', VERCEL_ENV: 'preview', NODE_ENV: 'production' };
type Ref = { id: string; path: string };

function harness() {
  const documents = new Map<string, any>(); const writes: string[] = [];
  let beforeTransaction: (() => void) | undefined;
  const snapshot = (ref: Ref) => ({ id: ref.id, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const transaction = () => {
    const staged: Array<{ ref: Ref; value: any }> = [];
    return {
      get: async (ref: Ref) => { if (staged.length) throw new Error('read after write'); return snapshot(ref); },
      getAll: async (...refs: Ref[]) => { if (staged.length) throw new Error('read after write'); return refs.map(snapshot); },
      create: (ref: Ref, value: any) => { if (documents.has(ref.path)) throw new Error('already exists'); staged.push({ ref, value: structuredClone(value) }); },
      commit: () => { for (const { ref, value } of staged) { documents.set(ref.path, value); writes.push(ref.path); } },
    };
  };
  const db = {
    projectId: 'ink-witness-staging', databaseId: '(default)',
    collection: (collection: string) => ({ doc: (id: string) => ({ id, path: `${collection}/${id}` }) }),
    getAll: vi.fn(async (...refs: Ref[]) => refs.map(snapshot)),
    runTransaction: vi.fn(async (operation: (value: unknown) => Promise<unknown>) => {
      beforeTransaction?.(); beforeTransaction = undefined;
      const tx = transaction(); const result = await operation(tx); tx.commit(); return result;
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.enabled = true; settings.updatedAt = EARLY; settings.updatedBy = 'Writer';
  settings.templates.forEach(template => { template.enabled = true; });
  settings.templates.find(template => template.eventType === 'inactivity_reminder')!.timing = { delayMinutes: 0, inactivityDays: 7, cooldownDays: 7 };
  documents.set('site_configs/affiliate_notifications', settings);
  documents.set('affiliates/partner-one', {
    id: 'partner-one', status: 'active', name: 'Private Partner', email: 'private@example.test', acceptedTerms: true,
    createdAt: EARLY, approvedAt: EARLY, approvedBy: 'Writer',
    lastActivityAt: '2026-10-02T10:00:00.000Z',
    literaryCircle: { schemaVersion: 1, memberSince: EARLY, foundingMember: true,
      tier: { id: 'literary-partner' }, complimentaryAccess: { status: 'active' } },
    notificationPreferences: {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES, marketingConsent: 'granted',
      marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION, marketingConsentAt: EARLY,
      allMarketingOptOut: false, campaignUpdates: true, campaignUpdatesEnabledAt: EARLY,
      inactivityReminders: true, inactivityRemindersEnabledAt: EARLY,
      exclusiveOpportunities: true, exclusiveOpportunitiesEnabledAt: EARLY,
    },
    balanceAvailableKes: 650, balancePendingKes: 80,
  });
  const campaign = { id: 'campaign-one', revision: 1, code: 'OCTOBER', name: 'October Reading', commissionRate: 20,
    attributionDays: 30, eligiblePieceIds: [], startDate: '2026-10-26T10:00:00.000Z', endDate: '2026-10-30T10:00:00.000Z',
    createdAt: '2026-10-23T09:00:00.000Z', updatedAt: '2026-10-23T09:00:00.000Z', updatedBy: 'Writer',
    isActive: true, clicksCount: 0, salesCount: 0, revenueKes: 0, commissionsKes: 0 };
  documents.set('affiliate_campaigns/campaign-one', campaign);
  documents.set('affiliate_audit/audit-campaign', { id: 'audit-campaign', actor: 'Writer', action: 'campaign_saved',
    targetType: 'campaign', targetId: 'campaign-one', timestamp: campaign.updatedAt, newValue: structuredClone(campaign) });
  const circle = { enabled: true, revision: 1, updatedAt: '2026-10-23T09:00:00.000Z', updatedBy: 'Writer',
    community: { enabled: true, posts: [{ id: 'opportunity-one', type: 'announcement', isPublished: true, order: 0,
      title: 'Private Reading Campaign', body: 'Read and share at your own pace.', publishedAt: '2026-10-23T09:00:00.000Z' }] } };
  documents.set('site_configs/affiliate_literary_circle', circle);
  documents.set('affiliate_audit/audit-opportunity', { id: 'audit-opportunity', actor: 'Writer', action: 'literary_circle_settings_updated',
    targetType: 'settings', targetId: 'affiliate_literary_circle', timestamp: circle.updatedAt, newValue: structuredClone(circle) });
  return { db, client: db as unknown as Firestore, documents, writes, settings,
    beforeTransaction: (operation: () => void) => { beforeTransaction = operation; },
    tx: () => transaction() as unknown as Transaction,
  };
}

function request(h: ReturnType<typeof harness>, kind: 'upcoming_campaign' | 'exclusive_opportunity' | 'inactivity_reminder' = 'upcoming_campaign') {
  return { db: h.client, kind, affiliateIds: ['partner-one'], now: NOW,
    ...(kind === 'inactivity_reminder' ? {} : kind === 'upcoming_campaign'
      ? { sourceId: 'campaign-one', evidenceId: 'audit-campaign' } : { sourceId: 'opportunity-one', evidenceId: 'audit-opportunity' }),
  };
}

function source(h: ReturnType<typeof harness>): AffiliateNotificationSource {
  return [...h.documents.values()].find(value => value.kind === 'source').source;
}

// Real signed-review validation is used here; no mocked authorization adapter
// can accidentally make a test-only mode prepare ordinary marketing records.
function productionFixture(h: ReturnType<typeof harness>, mode: 'production_test' | 'production_live' = 'production_live') {
  const recipient = 'approved-owner@example.invalid';
  const sha = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
  const env: NodeJS.ProcessEnv = {
    AFFILIATE_NOTIFICATION_EVENT_MODE: 'production_held', AFFILIATE_NOTIFICATION_DELIVERY_MODE: mode,
    FIREBASE_PROJECT_ID: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT, FIRESTORE_DATABASE_ID: '(default)', VERCEL_ENV: 'production',
    AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN,
    AFFILIATE_NOTIFICATION_SIGNING_SECRET: 'isolated-scheduled-review-fixture-secret-not-a-real-secret',
    AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: sha(recipient), RESEND_API_KEY: 'fixture-provider-never-sent',
    NEWSLETTER_FROM_EMAIL: 'Writer <sender@example.invalid>', RESEND_WEBHOOK_SECRET: 'fixture-webhook-never-used',
  };
  h.db.projectId = AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT;
  const settings = validateAffiliateNotificationSettings(h.settings);
  const review = { schemaVersion: 1, revision: 1, mode, projectId: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT,
    databaseId: '(default)', canonicalBaseUrl: AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN,
    fromEmail: env.NEWSLETTER_FROM_EMAIL!, providerAccountSha256: sha(env.RESEND_API_KEY!), settingsRevision: settings.revision,
    settingsSha256: affiliateNotificationRolloutHash(settings), activatedAt: EARLY, reviewedAt: EARLY,
    expiresAt: '2026-10-30T00:00:00.000Z', reviewedBySha256: sha('writer@example.invalid'),
    ...(mode === 'production_test' ? { testRecipient: recipient } : { verifiedTestDeliveryId: `nld_${'a'.repeat(48)}` }),
  };
  const unsigned = { schemaVersion: 1, revision: 1, state: 'reviewed', review, reviewSha256: affiliateNotificationRolloutHash(review) };
  const commit = () => {
    unsigned.reviewSha256 = affiliateNotificationRolloutHash(unsigned.review);
    const signature = crypto.createHmac('sha256', env.AFFILIATE_NOTIFICATION_SIGNING_SECRET!)
      .update(`affiliate-production-review-v1\0${affiliateNotificationRolloutHash(unsigned)}`).digest('hex');
    h.documents.set('site_configs/affiliate_notification_rollout', { ...structuredClone(unsigned), signature });
  };
  commit();
  return { env, unsigned, commit };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('bounded scheduled partner notification sources', () => {
  it.each(['upcoming_campaign', 'exclusive_opportunity', 'inactivity_reminder'] as const)('cannot prepare %s outbox records in controlled production test mode', async kind => {
    const h = harness(); const production = productionFixture(h, 'production_test');
    expect(await prepareScheduledAffiliateNotifications(request(h, kind), production.env)).toEqual({ attempted: 1, counts: { ineligible: 1 }, intentCount: 0 });
    expect(h.writes).toEqual([]);
    expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  it.each(['upcoming_campaign', 'exclusive_opportunity', 'inactivity_reminder'] as const)('prepares and reconstructs %s only under the genuine current signed live review', async kind => {
    const h = harness(); const production = productionFixture(h);
    expect(await prepareScheduledAffiliateNotifications(request(h, kind), production.env)).toEqual({ attempted: 1, counts: { created: 1 }, intentCount: 1 });
    const resolved = await resolveScheduledAffiliateNotificationSource({ db: h.client, source: source(h), now: NOW }, production.env);
    expect(resolved).not.toBeNull();
    expect(await resolved!.verifySource(h.tx())).toBe(true);
    expect(h.writes.every(path => path.startsWith('affiliate_notification_outbox/'))).toBe(true);
  });

  it.each(['unreviewed', 'paused', 'expired'] as const)('keeps direct scheduled preparation off for a %s production review', async state => {
    const h = harness(); const production = productionFixture(h);
    if (state === 'unreviewed') h.documents.delete('site_configs/affiliate_notification_rollout');
    if (state === 'paused') { production.unsigned.state = 'paused'; production.commit(); }
    if (state === 'expired') { production.unsigned.review.expiresAt = NOW; production.commit(); }
    expect((await prepareScheduledAffiliateNotifications(request(h), production.env)).counts).toEqual({ ineligible: 1 });
    expect(h.writes).toEqual([]);
  });

  it('pins the production review again in the outbox transaction and cancels a concurrent writer pause', async () => {
    const h = harness(); const production = productionFixture(h);
    h.beforeTransaction(() => { production.unsigned.state = 'paused'; production.commit(); });
    expect((await prepareScheduledAffiliateNotifications(request(h), production.env)).counts).toEqual({ ineligible: 1 });
    expect(h.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(h.writes).toEqual([]);
  });

  it.each(['upcoming_campaign', 'exclusive_opportunity', 'inactivity_reminder'] as const)('prepares/replays %s without touching accounts, finances or the immutable held records', async kind => {
    const h = harness(); const original = structuredClone([...h.documents]);
    expect(await prepareScheduledAffiliateNotifications(request(h, kind), ENV)).toEqual({ attempted: 1, counts: { created: 1 }, intentCount: 1 });
    const held = structuredClone([...h.documents].filter(([path]) => path.startsWith('affiliate_notification_outbox/')));
    expect(await prepareScheduledAffiliateNotifications(request(h, kind), ENV)).toEqual({ attempted: 1, counts: { existing: 1 }, intentCount: 1 });
    expect(h.writes).toHaveLength(2);
    for (const [path, value] of original) expect(h.documents.get(path)).toEqual(value);
    for (const [path, value] of held) expect(h.documents.get(path)).toEqual(value);
    const resolved = await resolveAffiliateNotificationSource({ db: h.client, source: source(h), now: NOW }, ENV);
    expect(resolved).not.toBeNull();
    expect(await resolved!.verifySource(h.tx())).toBe(true);
  });

  it('uses Nairobi campaign dates and lead time, stable identity, and a strict campaign-start expiry', async () => {
    const h = harness();
    await prepareScheduledAffiliateNotifications(request(h), ENV);
    const event = source(h);
    expect(event).toMatchObject({ eventType: 'upcoming_campaign', sourceVersion: 1, evidenceId: 'audit-campaign',
      occurredAt: '2026-10-23T09:00:00.000Z', notBefore: NOW, expiresAt: '2026-10-26T10:00:00.000Z' });
    const resolved = await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: NOW }, ENV);
    expect(resolved!.context.campaignName).toBe('October Reading');
    expect(resolved!.context.campaignStartDate).toContain('13:00');
    expect(await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: event.expiresAt! }, ENV)).toBeNull();
    // Current source reconstruction prevents changing a persisted occurrence.
    expect(await resolveScheduledAffiliateNotificationSource({ db: h.client, source: { ...event, occurredAt: EARLY }, now: NOW }, ENV)).toBeNull();
  });

  it('preserves campaign counter updates but refuses settings edits not backed by the exact audit', async () => {
    const h = harness(); h.documents.get('affiliate_campaigns/campaign-one').salesCount = 4;
    expect((await prepareScheduledAffiliateNotifications(request(h), ENV)).counts).toEqual({ created: 1 });
    h.documents.get('affiliate_campaigns/campaign-one').commissionRate = 100;
    expect(await resolveScheduledAffiliateNotificationSource({ db: h.client, source: source(h), now: NOW }, ENV)).toBeNull();
  });

  it.each(['missing_audit', 'paused', 'audit_mismatch', 'future_audit', 'past_start', 'zero_revision', 'unsafe_title'] as const)('refuses unauthoritative campaign evidence: %s', async change => {
    const h = harness(); const campaign = h.documents.get('affiliate_campaigns/campaign-one');
    if (change === 'missing_audit') h.documents.delete('affiliate_audit/audit-campaign');
    if (change === 'paused') campaign.isActive = false;
    if (change === 'audit_mismatch') h.documents.get('affiliate_audit/audit-campaign').newValue.name = 'Uncommitted rename';
    if (change === 'future_audit') h.documents.get('affiliate_audit/audit-campaign').timestamp = '2026-10-24T09:00:00.000Z';
    if (change === 'past_start') campaign.startDate = NOW;
    if (change === 'zero_revision') campaign.revision = 0;
    if (change === 'unsafe_title') campaign.name = 'bad\nheader';
    expect((await prepareScheduledAffiliateNotifications(request(h), ENV)).counts).toEqual({ ineligible: 1 });
    expect(h.writes).toEqual([]);
  });

  it.each(['upcoming_campaign', 'exclusive_opportunity', 'inactivity_reminder'] as const)('requires independent, current marketing/topic opt-in for %s', async kind => {
    const h = harness(); const preferences = h.documents.get('affiliates/partner-one').notificationPreferences;
    const field = kind === 'upcoming_campaign' ? 'campaignUpdatesEnabledAt'
      : kind === 'exclusive_opportunity' ? 'exclusiveOpportunitiesEnabledAt' : 'inactivityRemindersEnabledAt';
    delete preferences[field];
    expect((await prepareScheduledAffiliateNotifications(request(h, kind), ENV)).counts).toEqual({ ineligible: 1 });
    expect(h.writes).toEqual([]);
    preferences[field] = NOW;
    expect((await prepareScheduledAffiliateNotifications(request(h, kind), ENV)).counts).toEqual({ ineligible: 1 });
  });

  it('checks audit and settings again inside the outbox transaction before any create', async () => {
    const h = harness(); h.beforeTransaction(() => { h.documents.get('affiliate_audit/audit-campaign').newValue.isActive = false; });
    expect((await prepareScheduledAffiliateNotifications(request(h), ENV)).counts).toEqual({ ineligible: 1 });
    expect(h.writes).toEqual([]);
  });

  it.each(['unpublished', 'expired', 'unchanged', 'future', 'duplicate', 'unsupported'] as const)('suppresses invalid or unchanged private opportunities: %s', async change => {
    const h = harness(); const circle = h.documents.get('site_configs/affiliate_literary_circle');
    const post = circle.community.posts[0]; const audit = h.documents.get('affiliate_audit/audit-opportunity');
    if (change === 'unpublished') post.isPublished = false;
    if (change === 'expired') post.expiresAt = NOW;
    if (change === 'unchanged') audit.previousValue = structuredClone(circle);
    if (change === 'future') post.publishedAt = '2026-10-24T09:00:00.000Z';
    if (change === 'duplicate') circle.community.posts.push(structuredClone(post));
    if (change === 'unsupported') post.type = 'exclusive_excerpt';
    audit.newValue = structuredClone(circle);
    expect((await prepareScheduledAffiliateNotifications(request(h, 'exclusive_opportunity'), ENV)).counts).toEqual({ ineligible: 1 });
    expect(h.writes).toEqual([]);
  });

  it('caps evergreen opportunity expiry and invalidates unpublished/edited sources before delivery', async () => {
    const h = harness(); await prepareScheduledAffiliateNotifications(request(h, 'exclusive_opportunity'), ENV);
    const event = source(h); expect(event.expiresAt).toBe('2026-11-22T09:00:00.000Z');
    const resolved = await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: NOW }, ENV);
    expect(resolved!.context).toEqual({ opportunityTitle: 'Private Reading Campaign' });
    h.documents.get('site_configs/affiliate_literary_circle').community.posts[0].isPublished = false;
    expect(await resolved!.verifySource(h.tx())).toBe(false);
    expect(await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: NOW }, ENV)).toBeNull();
  });

  it('uses current quiet-cycle identity with a sender-enforced elapsed cooldown and no historical catch-up', async () => {
    const h = harness(); await prepareScheduledAffiliateNotifications(request(h, 'inactivity_reminder'), ENV);
    const event = source(h);
    expect(event).toMatchObject({ eventType: 'inactivity_reminder', sourceVersion: 3, targetAffiliateId: 'partner-one',
      occurredAt: NOW, notBefore: NOW, expiresAt: '2026-10-24T10:00:00.000Z' });
    const resolved = await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: NOW }, ENV);
    expect(resolved!.cooldown).toMatchObject({ minimumIntervalMs: 7 * 86_400_000 });
    expect(resolved!.cooldown!.key).toMatch(/^[a-f0-9]{64}$/);
    expect((await prepareScheduledAffiliateNotifications({ ...request(h, 'inactivity_reminder'), now: '2026-10-25T10:00:00.000Z' }, ENV)).counts).toEqual({ ineligible: 1 });
    expect((await prepareScheduledAffiliateNotifications({ ...request(h, 'inactivity_reminder'), now: '2026-10-30T10:00:00.000Z' }, ENV)).counts).toEqual({ created: 1 });
    expect([...h.documents.values()].filter(value => value.kind === 'source').map(value => value.source.sourceVersion)).toEqual([3, 4]);
  });

  it.each(['lastLoginAt', 'lastActivityAt', 'lastReferralAt', 'lastVerifiedSaleAt', 'lastDashboardAt'] as const)('fresh %s restarts inactivity instead of reusing a held reminder', async key => {
    const h = harness(); await prepareScheduledAffiliateNotifications(request(h, 'inactivity_reminder'), ENV);
    const event = source(h); h.documents.get('affiliates/partner-one')[key] = NOW;
    expect(await resolveScheduledAffiliateNotificationSource({ db: h.client, source: event, now: NOW }, ENV)).toBeNull();
  });

  it('waits a full quiet period after newly granted reminder consent or a policy edit', async () => {
    const h = harness(); h.documents.get('affiliates/partner-one').notificationPreferences.inactivityRemindersEnabledAt = NOW;
    expect((await prepareScheduledAffiliateNotifications(request(h, 'inactivity_reminder'), ENV)).counts).toEqual({ ineligible: 1 });
    h.documents.get('affiliates/partner-one').notificationPreferences.inactivityRemindersEnabledAt = EARLY;
    h.settings.updatedAt = NOW;
    expect((await prepareScheduledAffiliateNotifications(request(h, 'inactivity_reminder'), ENV)).counts).toEqual({ ineligible: 1 });
  });

  it('defaults off, blocks every production/emulator/mismatched client target before reads', async () => {
    const h = harness();
    expect(await prepareScheduledAffiliateNotifications(request(h), {})).toEqual({ attempted: 0, counts: { disabled: 1 }, intentCount: 0 });
    for (const patch of [{ VERCEL_ENV: 'production' }, { FIREBASE_PROJECT_ID: 'divine-experience-pq6d2' }, { FIRESTORE_DATABASE_ID: 'different' }, { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }]) {
      expect((await prepareScheduledAffiliateNotifications(request(h), { ...ENV, ...patch })).counts).toEqual({ blocked: 1 });
    }
    expect(h.db.getAll).not.toHaveBeenCalled(); expect(h.db.runTransaction).not.toHaveBeenCalled();
  });

  it('bounds exact audiences and requires one frozen broadcast audience instead of splitting/replacing it', async () => {
    const h = harness();
    await expect(prepareScheduledAffiliateNotifications({ ...request(h), affiliateIds: ['partner-one', 'partner-one'] }, ENV)).rejects.toThrow('Invalid scheduled partner notification audience.');
    await expect(prepareScheduledAffiliateNotifications({ ...request(h, 'inactivity_reminder'), affiliateIds: Array.from({ length: 26 }, (_, i) => `partner-${i}`) }, ENV)).rejects.toThrow();
    await expect(prepareScheduledAffiliateNotifications({ ...request(h), affiliateIds: Array.from({ length: 201 }, (_, i) => `partner-${i}`) }, ENV)).rejects.toThrow();
    expect(h.db.getAll).not.toHaveBeenCalled();
    await prepareScheduledAffiliateNotifications(request(h), ENV);
    const existing = structuredClone([...h.documents].filter(([path]) => path.startsWith('affiliate_notification_outbox/')));
    expect((await prepareScheduledAffiliateNotifications({ ...request(h), affiliateIds: ['partner-one', 'partner-two'] }, ENV)).counts).toEqual({ failed: 1 });
    for (const [path, value] of existing) expect(h.documents.get(path)).toEqual(value);
  });
});

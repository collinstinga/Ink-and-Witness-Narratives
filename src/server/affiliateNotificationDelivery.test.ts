import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { AffiliatePublicProfile } from '../types.js';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import { planAffiliateNotifications, type AffiliateNotificationSource } from './affiliateNotificationPlan.js';
import { NewsletterProviderError } from './newsletterEmail.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import { affiliateTierPeriodDocumentId } from './affiliateTierPeriods.js';
import { verifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationMonthlyTiers.js';
import {
  AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN, AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT,
  pauseProductionAffiliateNotifications, saveProductionAffiliateNotificationReview,
  sendProductionAffiliateNotificationTest,
} from './affiliateNotificationRollout.js';
import {
  affiliateNotificationDeliveryHash as hash,
  deliverHeldAffiliateNotification,
  reconcileAffiliateNotificationWebhook,
  type AffiliateNotificationSourceVerifier,
} from './affiliateNotificationDelivery.js';

vi.mock('./db.js', () => ({
  getFirestoreClientTarget: (db: { target: unknown }) => db.target,
  getDb: vi.fn(), getFirestoreDoc: vi.fn(), sanitizeForFirestore: (value: unknown) => value,
}));

const NOW = '2026-10-23T09:00:00.000Z';
type Ref = { id: string; path: string };

function harness(eventType: 'new_commission' | 'new_release' = 'new_commission') {
  let current = NOW;
  const documents = new Map<string, any>();
  const writes: string[] = [];
  const reads: string[] = [];
  let queue = Promise.resolve();
  let transactionCount = 0;
  let beforeTransaction: ((count: number) => void) | undefined;
  let failCommitNumber = -1;
  const snapshot = (ref: Ref) => ({ id: ref.id, ref, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const db = {
    target: { projectId: 'ink-witness-circle-staging', firestoreDatabaseId: '(default)' },
    collection: (name: string) => ({ doc: (id: string): Ref => ({ id, path: `${name}/${id}` }) }),
    getAll: vi.fn(async (...refs: Ref[]) => refs.map(snapshot)),
    runTransaction: vi.fn(async (callback: (transaction: any) => Promise<any>) => {
      let release!: () => void;
      const previous = queue;
      queue = new Promise<void>(resolve => { release = resolve; });
      await previous;
      const count = ++transactionCount;
      beforeTransaction?.(count);
      const staged: Array<{ ref: Ref; value: unknown; mergeFields?: string[] }> = [];
      const get = async (ref: Ref) => {
        if (staged.length) throw new Error('read after write');
        reads.push(ref.path);
        return snapshot(ref);
      };
      try {
        const result = await callback({
          get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
          create: (ref: Ref, value: unknown) => {
            if (documents.has(ref.path)) throw new Error('already exists');
            staged.push({ ref, value: structuredClone(value) });
          },
          set: (ref: Ref, value: unknown, options?: { mergeFields?: string[] }) => staged.push({ ref, value: structuredClone(value), mergeFields: options?.mergeFields }),
          update: () => { throw new Error('unexpected update'); }, delete: () => { throw new Error('unexpected delete'); },
        });
        if (count === failCommitNumber) throw new Error('private-provider-token@example.test');
        for (const item of staged) {
          documents.set(item.ref.path, item.mergeFields ? { ...documents.get(item.ref.path), ...(item.value as any) } : item.value);
          writes.push(item.ref.path);
        }
        return result;
      } finally { release(); }
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.enabled = true; settings.revision = 3;
  settings.templates.find(item => item.eventType === eventType)!.enabled = true;
  const affiliate = {
    id: 'partner-one', name: 'Reader <One>', email: 'reader@example.test', status: 'active', acceptedTerms: true,
    approvedAt: '2026-10-20T09:00:00.000Z', approvedBy: 'Writer',
    literaryCircle: { complimentaryAccess: { status: 'active' }, tier: { id: 'literary-partner' } },
    notificationPreferences: {
      schemaVersion: 1, revision: 1, marketingConsent: 'granted', marketingConsentVersion: 'literary-circle-marketing-2026-10-v1',
      marketingConsentAt: '2026-10-20T09:00:00.000Z', releaseUpdatesEnabledAt: '2026-10-20T09:00:00.000Z',
      releaseUpdates: true, allMarketingOptOut: false, commissionAlerts: true,
    },
  } as unknown as AffiliatePublicProfile;
  const source: AffiliateNotificationSource = {
    eventType, sourceId: 'verified-source-one', sourceVersion: 1, occurredAt: '2026-10-23T08:00:00.000Z',
    ...(eventType === 'new_commission' ? { targetAffiliateId: affiliate.id } : {}),
  };
  const plan = planAffiliateNotifications({ source, settings, affiliates: [affiliate], now: NOW });
  const intent = { ...plan.intents[0], kind: 'intent', createdAt: NOW };
  documents.set(`affiliate_notification_outbox/${intent.id}`, intent);
  documents.set(`affiliate_notification_outbox/${plan.eventId}`, {
    schemaVersion: 1, kind: 'source', id: plan.eventId, source, sourceSha256: hash(source),
    audienceSha256: hash([affiliate.id]), intentEvidence: [{ id: intent.id, sha256: hash(intent) }],
    createdAt: NOW, deliveryMode: 'preview_only',
  });
  documents.set('site_configs/affiliate_notifications', settings);
  documents.set('affiliates/partner-one', affiliate);
  const review = {
    schemaVersion: 1, enabled: true, mode: 'staging_test', projectId: db.target.projectId, databaseId: '(default)',
    canonicalBaseUrl: 'https://circle-staging.example.test', fromEmail: 'Writer <writer@example.test>', allowedRecipients: ['reader@example.test'],
    settingsRevision: 3, settingsSha256: hash(settings), reviewedAt: '2026-10-23T08:00:00.000Z',
    expiresAt: '2026-10-25T08:00:00.000Z', reviewedBy: 'Writer staging test review',
  };
  documents.set('site_configs/affiliate_notification_delivery', review);
  const env = {
    AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'staging_test', FIREBASE_PROJECT_ID: db.target.projectId,
    LITERARY_CIRCLE_STAGING_PROJECT_IDS: db.target.projectId, VERCEL_ENV: 'preview',
    AFFILIATE_NOTIFICATION_STAGING_BASE_URL: review.canonicalBaseUrl,
    AFFILIATE_NOTIFICATION_DELIVERY_REVIEW_SHA256: hash(review),
    RESEND_API_KEY: 'local-test-never-sent', NEWSLETTER_FROM_EMAIL: 'Writer <writer@example.test>',
    RESEND_WEBHOOK_SECRET: 'local-test-webhook-secret-never-sent',
    AFFILIATE_NOTIFICATION_SIGNING_SECRET: 'test-signing-secret-with-at-least-thirty-two-characters',
  };
  const verifySource = vi.fn<AffiliateNotificationSourceVerifier>(async () => ({ eligible: true as const, variables: {
    commissionAmount: 'KES 75', pieceTitle: 'A quiet piece', piecePath: '/?monograph=piece-one',
  }, evidenceSha256: hash('verified payment/source evidence') }));
  const sendEmail = vi.fn(async (_input: any) => ({ providerMessageId: 'email_verified_123' }));
  const input = { db: db as unknown as Firestore, intentId: intent.id, env, clock: () => current, verifySource, sendEmail };
  const delivery = () => [...documents.entries()].find(([path, value]) => path.startsWith('affiliate_notification_deliveries/nld_') && value.kind === 'delivery')?.[1];
  return {
    input, documents, writes, reads, db, settings, affiliate, review, source, intent, delivery, sendEmail, verifySource,
    advance: (milliseconds: number) => { current = new Date(Date.parse(current) + milliseconds).toISOString(); },
    beforeTransaction: (callback: (count: number) => void) => { beforeTransaction = callback; },
    failCommit: (count: number) => { failCommitNumber = count; },
    repinReview: () => { env.AFFILIATE_NOTIFICATION_DELIVERY_REVIEW_SHA256 = hash(review); },
  };
}

function prepareMonthlyTier(h: ReturnType<typeof harness>) {
  h.settings.templates.find(item => item.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
  h.review.settingsSha256 = hash(h.settings); h.repinReview();
  h.affiliate.literaryCircle!.schemaVersion = 1;
  h.affiliate.literaryCircle!.tier = { id: 'literary-patron', source: 'monthly_performance', assignedAt: NOW, qualificationPeriod: '2026-09' };
  const circle = structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
  circle.enabled = true; circle.revision = 4;
  circle.commissionPolicy = { status: 'active', version: 1, effectiveAt: '2026-10-01T00:00:00.000Z', subscriptionRenewalsEligible: false };
  const period = { schemaVersion: 1, affiliateId: 'partner-one', periodKey: '2026-10', revision: 1,
    evidenceComplete: true, members: [], awardedMilestones: [] };
  const path = `affiliate_tier_periods/${affiliateTierPeriodDocumentId('partner-one', '2026-10')}`;
  h.documents.set('site_configs/affiliate_literary_circle', circle); h.documents.set(path, period);
  const proof = verifiedAffiliateNotificationMonthlyTiers({ affiliates: [h.affiliate], settings: circle,
    periods: new Map([['partner-one', period]]), now: NOW });
  h.intent.tierEvidenceSha256 = proof['partner-one'].evidenceSha256;
  h.documents.get(`affiliate_notification_outbox/${h.intent.eventId}`).intentEvidence = [{ id: h.intent.id, sha256: hash(h.intent) }];
  return { circle, period, path };
}

describe('guarded partner notification delivery', () => {
  it('defaults off with no reads, transactions or provider calls', async () => {
    const h = harness(); delete (h.input.env as NodeJS.ProcessEnv).AFFILIATE_NOTIFICATION_DELIVERY_MODE;
    expect(await deliverHeldAffiliateNotification(h.input)).toEqual({ status: 'disabled' });
    expect(h.reads).toEqual([]); expect(h.writes).toEqual([]); expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it.each(['production', 'production_label_whitespace', 'mismatched_target', 'unreviewed', 'production_project', 'emulator', 'missing_secret', 'unsafe_origin', 'unknown_mode'])(
    'blocks %s before database access', async change => {
      const h = harness();
      if (change === 'production') h.input.env.VERCEL_ENV = 'production';
      if (change === 'production_label_whitespace') h.input.env.VERCEL_ENV = ' Production ';
      if (change === 'mismatched_target') h.db.target.projectId = 'different-staging-project';
      if (change === 'unreviewed') delete (h.input.env as NodeJS.ProcessEnv).AFFILIATE_NOTIFICATION_DELIVERY_REVIEW_SHA256;
      if (change === 'production_project') { h.input.env.FIREBASE_PROJECT_ID = 'ink-and-witness-narratives'; h.input.env.LITERARY_CIRCLE_STAGING_PROJECT_IDS = 'ink-and-witness-narratives'; }
      if (change === 'emulator') (h.input.env as any).FIRESTORE_EMULATOR_HOST = 'localhost:8080';
      if (change === 'missing_secret') h.input.env.AFFILIATE_NOTIFICATION_SIGNING_SECRET = '';
      if (change === 'unsafe_origin') h.input.env.AFFILIATE_NOTIFICATION_STAGING_BASE_URL = 'http://localhost';
      if (change === 'unknown_mode') h.input.env.AFFILIATE_NOTIFICATION_DELIVERY_MODE = 'live';
      expect(await deliverHeldAffiliateNotification(h.input)).toEqual({ status: 'blocked' });
      expect(h.reads).toEqual([]); expect(h.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('dispatches one exact operational email after two fresh validations and preserves held records', async () => {
    const h = harness(); const before = structuredClone([...h.documents]);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.verifySource).toHaveBeenCalledTimes(2); expect(h.sendEmail).toHaveBeenCalledTimes(1);
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.to).toBe('reader@example.test'); expect(email.idempotencyKey).toMatch(/^affiliate-notification-v1:nld_/);
    expect(email.html).toContain('Reader &lt;One&gt;'); expect(email.html).toContain('/#affiliates');
    expect(email).not.toHaveProperty('unsubscribeUrl'); expect(email.html).not.toContain('Stop marketing updates');
    expect(h.delivery()).toMatchObject({ status: 'accepted', attemptCount: 1, providerMessageId: 'email_verified_123' });
    expect(h.delivery()).not.toHaveProperty('leaseToken');
    for (const [path, value] of before) expect(h.documents.get(path)).toEqual(value);
    expect(h.writes.every(path => path.startsWith('affiliate_notification_deliveries/'))).toBe(true);
  });

  it('adds a signed marketing-only opt-out and safe canonical piece link', async () => {
    const h = harness('new_release');
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    const email = h.sendEmail.mock.calls[0][0];
    expect(email.unsubscribeUrl).toMatch(/^https:\/\/circle-staging\.example\.test\/affiliate\/notifications\/unsubscribe\?token=v1\.marketing\.partner-one\./);
    expect(email.html).toContain('https://circle-staging.example.test/?monograph=piece-one');
  });

  it('leases concurrency and never resends a provider-accepted intent', async () => {
    const h = harness();
    const results = await Promise.all([deliverHeldAffiliateNotification(h.input), deliverHeldAffiliateNotification(h.input)]);
    expect(results.map(item => item.status).sort()).toEqual(['accepted', 'busy']);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'already_processed' });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
  });

  it.each(['suspended', 'optout', 'stale_settings', 'unallowlisted', 'expired_review', 'tampered_intent', 'tampered_source', 'source_reversed', 'unsafe_cta', 'unresolved_template'])(
    'sends nothing for %s', async change => {
      const h = harness('new_release');
      if (change === 'suspended') h.affiliate.status = 'suspended' as any;
      if (change === 'optout') h.affiliate.notificationPreferences!.allMarketingOptOut = true;
      if (change === 'stale_settings') h.settings.revision++;
      if (change === 'unallowlisted') { h.review.allowedRecipients = ['other@example.test']; h.repinReview(); }
      if (change === 'expired_review') { h.review.expiresAt = NOW; h.repinReview(); }
      if (change === 'tampered_intent') h.intent.dueAt = '2026-10-23T08:30:00.000Z';
      if (change === 'tampered_source') (h.documents.get(`affiliate_notification_outbox/${h.intent.eventId}`).source as any).sourceId = 'forged';
      if (change === 'source_reversed') h.verifySource.mockResolvedValue(null as any);
      if (change === 'unsafe_cta') h.verifySource.mockResolvedValue({ eligible: true, variables: { pieceTitle: 'A piece', piecePath: 'https://evil.example.test/' }, evidenceSha256: hash('evidence') });
      if (change === 'unresolved_template') h.verifySource.mockResolvedValue({ eligible: true, variables: { piecePath: '/?monograph=one' }, evidenceSha256: hash('evidence') });
      expect((await deliverHeldAffiliateNotification(h.input)).status).toMatch(/ineligible|failed/);
      expect(h.sendEmail).not.toHaveBeenCalled();
    },
  );

  it('cancels if consent or source eligibility changes after leasing', async () => {
    const h = harness('new_release');
    h.beforeTransaction(count => { if (count === 2) h.affiliate.notificationPreferences!.allMarketingOptOut = true; });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.delivery()).toMatchObject({ status: 'cancelled', attemptCount: 0, lastErrorCode: 'eligibility_changed' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('accepts harmless backing-document changes after fresh validation without changing the provider envelope', async () => {
    const h = harness();
    const initial = hash('original complete source snapshots');
    const latest = hash('source snapshots after legitimate login or ledger status update');
    h.verifySource.mockImplementation(async () => ({ eligible: true, variables: {
      commissionAmount: 'KES 75', pieceTitle: 'A quiet piece',
    }, evidenceSha256: h.verifySource.mock.calls.length === 1 ? initial : latest }));
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.verifySource).toHaveBeenCalledTimes(2);
    expect(h.delivery()).toMatchObject({ initialSourceEvidenceSha256: initial, sourceEvidenceSha256: latest });
  });

  it('allows exact-envelope retry after a harmless status update but cancels a source invalidated before retry', async () => {
    const h = harness(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Timed out', 503));
    await deliverHeldAffiliateNotification(h.input);
    h.advance(121_000);
    h.verifySource.mockResolvedValue({ eligible: true, variables: {
      commissionAmount: 'KES 75', pieceTitle: 'A quiet piece', piecePath: '/?monograph=piece-one',
    }, evidenceSha256: hash('fresh approved commission with identical financial envelope') });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.sendEmail.mock.calls[1][0]).toEqual(h.sendEmail.mock.calls[0][0]);

    const reversed = harness(); reversed.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Timed out', 503));
    await deliverHeldAffiliateNotification(reversed.input); reversed.advance(121_000);
    reversed.verifySource.mockResolvedValue(null);
    expect(await deliverHeldAffiliateNotification(reversed.input)).toMatchObject({ status: 'ineligible' });
    expect(reversed.delivery()).toMatchObject({ status: 'cancelled', lastErrorCode: 'eligibility_changed' });
    expect(await deliverHeldAffiliateNotification(reversed.input)).toMatchObject({ status: 'already_processed' });
    expect(reversed.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not send when the reviewed authorization expires during source validation', async () => {
    const h = harness();
    h.review.expiresAt = '2026-10-23T09:00:01.000Z'; h.repinReview();
    h.verifySource.mockImplementation(async () => {
      if (h.verifySource.mock.calls.length === 2) h.advance(2_000);
      return { eligible: true, variables: { commissionAmount: 'KES 75', pieceTitle: 'A quiet piece' }, evidenceSha256: hash('fresh source') };
    });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'failed' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('does not send a release when its seven-day age window expires during fresh validation', async () => {
    const h = harness('new_release');
    h.advance(6 * 86_400_000 + 23 * 3_600_000 - 1_000);
    h.review.reviewedAt = '2026-10-29T08:00:00.000Z';
    h.review.expiresAt = '2026-10-31T08:00:00.000Z'; h.repinReview();
    h.verifySource.mockImplementation(async () => {
      if (h.verifySource.mock.calls.length === 2) h.advance(2_000);
      return { eligible: true, variables: { pieceTitle: 'A quiet piece', piecePath: '/?monograph=piece-one' }, evidenceSha256: hash('fresh source') };
    });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'failed' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('fails closed for an automatic stored tier and verifies explicit manual recognition against current enabled tiers', async () => {
    const automatic = harness();
    automatic.settings.templates.find(item => item.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
    automatic.review.settingsSha256 = hash(automatic.settings); automatic.repinReview();
    automatic.affiliate.literaryCircle!.schemaVersion = 1;
    automatic.affiliate.literaryCircle!.tier = { id: 'literary-partner', source: 'monthly_performance', assignedAt: NOW };
    automatic.documents.set('site_configs/affiliate_literary_circle', {
      schemaVersion: 1, revision: 1, enabled: true, tiers: [{ id: 'literary-partner', enabled: true }],
    });
    expect(await deliverHeldAffiliateNotification(automatic.input)).toMatchObject({ status: 'ineligible' });
    expect(automatic.sendEmail).not.toHaveBeenCalled();

    const manual = harness();
    manual.settings.templates.find(item => item.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
    manual.review.settingsSha256 = hash(manual.settings); manual.repinReview();
    manual.affiliate.literaryCircle!.schemaVersion = 1;
    manual.affiliate.literaryCircle!.tier = { id: 'literary-partner', source: 'manual', assignedAt: NOW };
    manual.documents.set('site_configs/affiliate_literary_circle', {
      schemaVersion: 1, revision: 1, enabled: true, tiers: [{ id: 'literary-partner', enabled: true }],
    });
    expect(await deliverHeldAffiliateNotification(manual.input)).toMatchObject({ status: 'accepted' });
    expect(manual.reads.filter(path => path === 'site_configs/affiliate_literary_circle')).toHaveLength(2);
  });

  it('cancels a tier-filtered send if the manual tier is disabled after leasing', async () => {
    const h = harness();
    h.settings.templates.find(item => item.eventType === 'new_commission')!.eligibility.tierIds = ['literary-partner'];
    h.review.settingsSha256 = hash(h.settings); h.repinReview();
    h.affiliate.literaryCircle!.schemaVersion = 1;
    h.affiliate.literaryCircle!.tier = { id: 'literary-partner', source: 'manual', assignedAt: NOW };
    const circle = { schemaVersion: 1, revision: 1, enabled: true, tiers: [{ id: 'literary-partner', enabled: true }] };
    h.documents.set('site_configs/affiliate_literary_circle', circle);
    h.beforeTransaction(index => { if (index === 2) circle.tiers[0].enabled = false; });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.delivery()).toMatchObject({ status: 'cancelled' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('rechecks the exact complete canonical monthly summary twice before the injected test transport', async () => {
    const h = harness(); const { path } = prepareMonthlyTier(h);
    const before = structuredClone([...h.documents]);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.reads.filter(item => item === path)).toHaveLength(2);
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    for (const [key, value] of before) expect(h.documents.get(key)).toEqual(value);
    expect(h.writes.every(item => item.startsWith('affiliate_notification_deliveries/'))).toBe(true);
  });

  it.each(['policy', 'summary', 'missing', 'incomplete', 'manual_override'])('cancels an automatic audience when %s evidence changes after leasing, even if the selected tier is unchanged', async change => {
    const h = harness(); const evidence = prepareMonthlyTier(h);
    h.beforeTransaction(index => {
      if (index !== 2) return;
      if (change === 'policy') evidence.circle.revision++;
      if (change === 'summary') evidence.period.revision++;
      if (change === 'missing') h.documents.delete(evidence.path);
      if (change === 'incomplete') evidence.period.evidenceComplete = false;
      if (change === 'manual_override') h.affiliate.literaryCircle!.tier = { id: 'literary-partner', source: 'manual', assignedAt: NOW };
    });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.delivery()).toMatchObject({ status: 'cancelled' }); expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('holds a previously pinned month after Nairobi month rollover instead of reusing its zero-sale default tier', async () => {
    const h = harness(); prepareMonthlyTier(h);
    h.advance(Date.parse('2026-10-31T21:00:00.000Z') - Date.parse(NOW));
    h.review.reviewedAt = '2026-10-31T20:00:00.000Z'; h.review.expiresAt = '2026-11-01T20:00:00.000Z'; h.repinReview();
    h.documents.set(`affiliate_tier_periods/${affiliateTierPeriodDocumentId('partner-one', '2026-11')}`,
      { schemaVersion: 1, affiliateId: 'partner-one', periodKey: '2026-11', revision: 1, evidenceComplete: true, members: [], awardedMilestones: [] });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('checks shared provider suppression but public-newsletter unsubscribe does not block operational alerts', async () => {
    const h = harness(); const emailHash = crypto.createHash('sha256').update(h.affiliate.email).digest('hex');
    h.documents.set(`newsletter_email_index/${emailHash}`, { storageVersion: 1, emailHash, subscriberId: 'sub_abcdefghijklmnop' });
    h.documents.set('newsletter_subscribers/sub_abcdefghijklmnop', { storageVersion: 1, email: h.affiliate.email, emailIndexId: emailHash, status: 'unsubscribed' });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    const blocked = harness();
    blocked.documents.set(`newsletter_email_index/${emailHash}`, h.documents.get(`newsletter_email_index/${emailHash}`));
    blocked.documents.set('newsletter_subscribers/sub_abcdefghijklmnop', { ...h.documents.get('newsletter_subscribers/sub_abcdefghijklmnop'), status: 'suppressed' });
    expect(await deliverHeldAffiliateNotification(blocked.input)).toMatchObject({ status: 'ineligible' });
    expect(blocked.sendEmail).not.toHaveBeenCalled();
  });

  it('retries transient errors with exactly the same content/provider key after backoff', async () => {
    const h = harness(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('private provider error with credential', 503));
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'retry_pending' });
    expect(h.delivery().lastErrorCode).toBe('provider_retryable');
    expect(JSON.stringify(h.delivery())).not.toContain('private provider');
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'not_due' });
    h.advance(121_000);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.sendEmail.mock.calls[1][0]).toEqual(h.sendEmail.mock.calls[0][0]);
    expect(h.delivery().attemptCount).toBe(2);
  });

  it('dead-letters rejected configuration and never retries after provider idempotency retention', async () => {
    const h = harness(); h.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Rejected', 400));
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'dead_letter' });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'already_processed' });
    const expired = harness(); expired.sendEmail.mockRejectedValueOnce(new NewsletterProviderError('Timed out', 503));
    await deliverHeldAffiliateNotification(expired.input); expired.advance(23 * 60 * 60 * 1_000 + 1);
    expect(await deliverHeldAffiliateNotification(expired.input)).toMatchObject({ status: 'dead_letter' });
    expect(expired.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('recovers an ambiguous acknowledgement only with same provider key and content', async () => {
    const h = harness(); h.failCommit(3);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'failed' });
    expect(h.delivery()).toMatchObject({ status: 'dispatching', attemptCount: 1 });
    h.advance(121_000);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(h.sendEmail.mock.calls[1][0]).toEqual(h.sendEmail.mock.calls[0][0]);
  });
});

/** No network transport: exercises real review signatures, delivery ledger and
 * webhook verifier together using a private in-memory SDK fixture. */
async function productionDeliveryHarness(live = true) {
  const h = harness();
  const owner = 'approved-owner@example.invalid';
  const key = Buffer.from('production-notification-unit-webhook-key');
  Object.assign(h.input.env, {
    VERCEL_ENV: 'production', FIREBASE_PROJECT_ID: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT,
    FIRESTORE_DATABASE_ID: '(default)', AFFILIATE_NOTIFICATION_EVENT_MODE: 'production_held',
    AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_test',
    AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN,
    AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL: owner,
    AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: crypto.createHash('sha256').update(owner).digest('hex'),
    RESEND_WEBHOOK_SECRET: `whsec_${key.toString('base64')}`,
  });
  h.db.target.projectId = AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT;
  const reviewInput = { db: h.input.db, authenticatedWriterEmail: 'actual-writer@example.invalid' };
  const request = { expectedRevision: 0, mode: 'production_test' as const, durationDays: 7, includeFoundingWelcome: false };
  await saveProductionAffiliateNotificationReview({ ...reviewInput, request, now: h.input.clock() }, h.input.env);
  const sign = (id: string, providerMessageId: string, recipient: string, type = 'email.delivered') => {
    const eventAt = h.input.clock();
    const payload = JSON.stringify({ type, created_at: eventAt, data: { email_id: providerMessageId,
      to: [recipient], from: 'writer@example.test', tags: { delivery_id: id } } });
    const headers = { id: `evt_${id}_${type}`, timestamp: String(Math.floor(Date.now() / 1_000)), signature: '' };
    headers.signature = `v1,${crypto.createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest('base64')}`;
    return { db: h.input.db, env: h.input.env, payload, headers, webhookSecret: h.input.env.RESEND_WEBHOOK_SECRET, clock: h.input.clock };
  };
  const probe = await sendProductionAffiliateNotificationTest({ ...reviewInput, clock: h.input.clock,
    sendEmail: vi.fn(async () => ({ providerMessageId: 'unit_owner_probe' })) }, h.input.env);
  expect(probe.status).toBe('accepted');
  const hook = sign(probe.deliveryId!, 'unit_owner_probe', owner);
  const writesBeforeTampering = h.writes.length;
  expect(await reconcileAffiliateNotificationWebhook({ ...hook, payload: `${hook.payload} ` })).toEqual({ status: 'failed' });
  expect(h.writes).toHaveLength(writesBeforeTampering);
  expect(await reconcileAffiliateNotificationWebhook(hook)).toEqual({ status: 'recorded' });
  if (live) {
    h.advance(1_000); h.input.env.AFFILIATE_NOTIFICATION_DELIVERY_MODE = 'production_live';
    expect(await saveProductionAffiliateNotificationReview({ ...reviewInput, request: { ...request,
      expectedRevision: 1, mode: 'production_live' }, now: h.input.clock() }, h.input.env)).toMatchObject({ status: 'ready' });
    // The ordinary sale is prospective, not the pre-activation fixture sale.
    h.advance(1_000);
    const source = { ...h.source, occurredAt: h.input.clock() };
    const plan = planAffiliateNotifications({ source, settings: h.settings, affiliates: [h.affiliate], now: h.input.clock() });
    const intent = { ...plan.intents[0], kind: 'intent', createdAt: h.input.clock() };
    h.input.intentId = intent.id;
    h.documents.set(`affiliate_notification_outbox/${intent.id}`, intent);
    h.documents.set(`affiliate_notification_outbox/${plan.eventId}`, {
      schemaVersion: 1, kind: 'source', id: plan.eventId, source, sourceSha256: hash(source),
      audienceSha256: hash([h.affiliate.id]), intentEvidence: [{ id: intent.id, sha256: hash(intent) }],
      createdAt: h.input.clock(), deliveryMode: 'preview_only',
    });
  }
  return { ...h, sign };
}

describe('real signed production review / mocked transport integration', () => {
  it('owner-only test mode reconciles a signed receipt but cannot drain an ordinary affiliate intent', async () => {
    const h = await productionDeliveryHarness(false);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('sends a prospective ordinary message once under a signed live review, preserving account and sale data', async () => {
    const h = await productionDeliveryHarness();
    const before = structuredClone([...h.documents].filter(([path]) => !path.startsWith('affiliate_notification_deliveries/')));
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'accepted' });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'already_processed' });
    expect(h.sendEmail).toHaveBeenCalledTimes(1); expect(h.verifySource).toHaveBeenCalledTimes(2);
    expect(h.sendEmail.mock.calls[0][0].html).toContain(`${AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN}/#affiliates`);
    for (const [path, value] of before) expect(h.documents.get(path)).toEqual(value);
  });

  it('a pause between claim and pre-send validation cancels rather than dispatching', async () => {
    const h = await productionDeliveryHarness();
    let validated = 0;
    // The source verifier runs inside the claim transaction. Install the same
    // signed pause state after its first read to emulate the later commit.
    h.verifySource.mockImplementation(async () => {
      validated++;
      if (validated === 1) {
        const { signature: _signature, ...review } = h.documents.get('site_configs/affiliate_notification_rollout');
        const paused = { ...review, state: 'paused', revision: review.revision + 1 };
        h.documents.set('site_configs/affiliate_notification_rollout', { ...paused,
          signature: crypto.createHmac('sha256', h.input.env.AFFILIATE_NOTIFICATION_SIGNING_SECRET)
            .update(`affiliate-production-review-v1\0${hash(paused)}`).digest('hex') });
      }
      return { eligible: true, variables: { commissionAmount: 'KES 75', pieceTitle: 'A piece' }, evidenceSha256: hash('source') };
    });
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.sendEmail).not.toHaveBeenCalled();
  });

  it('an authenticated review pause prevents a later dispatch without deleting any held intent', async () => {
    const h = await productionDeliveryHarness();
    const intent = structuredClone(h.documents.get(`affiliate_notification_outbox/${h.input.intentId}`));
    await pauseProductionAffiliateNotifications({ db: h.input.db, expectedRevision: 2,
      authenticatedWriterEmail: 'actual-writer@example.invalid', now: h.input.clock() }, h.input.env);
    expect(await deliverHeldAffiliateNotification(h.input)).toMatchObject({ status: 'ineligible' });
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.documents.get(`affiliate_notification_outbox/${h.input.intentId}`)).toEqual(intent);
  });
});

function signedWebhook(h: ReturnType<typeof harness>, type = 'email.delivered', edits: Record<string, unknown> = {}) {
  const time = '2026-10-23T09:01:00.000Z';
  const payload = JSON.stringify({ type, created_at: time, data: {
    email_id: h.delivery().providerMessageId || 'email_verified_123', message_id: 'message_one', created_at: time,
    from: 'writer@example.test', to: ['reader@example.test'], subject: 'Account update',
    tags: { delivery_id: h.delivery().id }, ...edits,
  } });
  const key = Buffer.from('affiliate-notification-webhook-test-key');
  const webhookSecret = `whsec_${key.toString('base64')}`;
  h.input.env.RESEND_WEBHOOK_SECRET = webhookSecret;
  const headers = { id: `evt_${type.replace('.', '_')}`, timestamp: String(Math.floor(Date.now() / 1_000)), signature: '' };
  headers.signature = `v1,${crypto.createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest('base64')}`;
  return { payload, headers, webhookSecret, clock: () => time };
}

describe('signed partner delivery reconciliation', () => {
  it('rejects tampering before database access', async () => {
    const h = harness(); await deliverHeldAffiliateNotification(h.input);
    const signed = signedWebhook(h); h.reads.length = 0;
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signed, payload: `${signed.payload} ` })).toEqual({ status: 'failed' });
    expect(h.reads).toEqual([]);
  });

  it('reconciles signed tags/provider/recipient, preserves delivery on out-of-order sent replay', async () => {
    const h = harness(); await deliverHeldAffiliateNotification(h.input);
    const signed = signedWebhook(h);
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signed })).toEqual({ status: 'recorded' });
    expect(h.delivery().status).toBe('delivered');
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signedWebhook(h, 'email.sent') })).toEqual({ status: 'recorded' });
    expect(h.delivery().status).toBe('delivered');
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signedWebhook(h, 'email.delivered', { email_id: 'other-provider-id' }) })).toEqual({ status: 'invalid' });
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signedWebhook(h, 'email.delivered', { to: ['wrong@example.test'] }) })).toEqual({ status: 'invalid' });
  });

  it('records provider suppression and propagates it to an existing newsletter subscriber without altering consent', async () => {
    const h = harness(); await deliverHeldAffiliateNotification(h.input);
    const emailHash = crypto.createHash('sha256').update(h.affiliate.email).digest('hex');
    h.documents.set(`newsletter_email_index/${emailHash}`, { storageVersion: 1, emailHash, subscriberId: 'sub_abcdefghijklmnop' });
    h.documents.set('newsletter_subscribers/sub_abcdefghijklmnop', { storageVersion: 1, email: h.affiliate.email, emailIndexId: emailHash, status: 'active', consentVersion: 'preserved-consent' });
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signedWebhook(h, 'email.complained') })).toEqual({ status: 'recorded' });
    expect(h.delivery().status).toBe('complained');
    expect(h.documents.get(`affiliate_notification_deliveries/suppression_${emailHash}`)).toMatchObject({ kind: 'provider_suppression', reason: 'complained' });
    expect(h.documents.get('newsletter_subscribers/sub_abcdefghijklmnop')).toMatchObject({ status: 'suppressed', consentVersion: 'preserved-consent' });
    expect(await reconcileAffiliateNotificationWebhook({ db: h.input.db, env: h.input.env, ...signedWebhook(h, 'email.delivered') })).toEqual({ status: 'recorded' });
    expect(h.delivery().status).toBe('complained');
  });
});

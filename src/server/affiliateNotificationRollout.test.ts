import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS } from './affiliateNotifications.js';
import {
  AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN, AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT,
  affiliateNotificationRolloutHash, authorizeProductionAffiliateNotificationSource,
  getProductionAffiliateNotificationRolloutStatus, parseProductionAffiliateNotificationReviewRequest,
  pauseProductionAffiliateNotifications, productionAffiliateNotificationGate, readProductionAffiliateNotificationReview,
  reconcileProductionAffiliateNotificationTest, saveProductionAffiliateNotificationReview, sendProductionAffiliateNotificationTest,
} from './affiliateNotificationRollout.js';

vi.mock('./db.js', () => ({ getFirestoreClientTarget: (db: { target: unknown }) => db.target,
  getDb: vi.fn(), getFirestoreDoc: vi.fn(), sanitizeForFirestore: (value: unknown) => value }));
const NOW = '2026-10-26T12:00:00.000Z';
const WRITER = 'writer-account@example.invalid';
const RECIPIENT = 'approved-owner@example.invalid';
const hash = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
type Ref = { id: string; path: string };
function harness() {
  const documents = new Map<string, any>(); const reads: string[] = []; const writes: string[] = [];
  let current = NOW; let transactions = 0; let beforeTransaction: ((index: number) => void) | undefined;
  const snapshot = (ref: Ref) => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  const db = { target: { projectId: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT, firestoreDatabaseId: '(default)' },
    collection: (name: string) => ({ doc: (id: string): Ref => ({ id, path: `${name}/${id}` }),
      where: () => ({ limit: () => ({ fixtureQuery: name }) }) }),
    getAll: vi.fn(async (...refs: Ref[]) => refs.map(ref => { reads.push(ref.path); return snapshot(ref); })),
    runTransaction: vi.fn(async (callback: (transaction: any) => Promise<any>) => {
      // Optional-call arguments are not evaluated when there is no hook. Count
      // every transaction, including review creation before a race hook is set.
      transactions += 1;
      beforeTransaction?.(transactions);
      const pending: Array<{ ref: Ref; value: unknown }> = [];
      const get = async (ref: Ref & { fixtureQuery?: string }) => {
        if (pending.length) throw new Error('read after write');
        if (ref.fixtureQuery) return { docs: [] };
        reads.push(ref.path); return snapshot(ref);
      };
      const result = await callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
        set: (ref: Ref, value: unknown, options?: { mergeFields: string[] }) => pending.push({ ref,
          value: structuredClone(options?.mergeFields ? { ...documents.get(ref.path), ...(value as object) } : value) }),
        create: (ref: Ref, value: unknown) => { if (documents.has(ref.path)) throw new Error('exists'); pending.push({ ref, value: structuredClone(value) }); },
      });
      for (const { ref, value } of pending) { documents.set(ref.path, value); writes.push(ref.path); }
      return result;
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.revision = 3; settings.enabled = true; settings.templates.forEach(template => { template.enabled = true; });
  documents.set('site_configs/affiliate_notifications', settings);
  documents.set('transactions/preserved', { status: 'CONFIRMED', amount: 500 });
  documents.set('affiliates/preserved', { wallet: 700, notificationPreferences: { marketingConsent: 'unknown' } });
  const env: NodeJS.ProcessEnv = {
    VERCEL_ENV: 'production', FIREBASE_PROJECT_ID: AFFILIATE_NOTIFICATION_PRODUCTION_PROJECT, FIRESTORE_DATABASE_ID: '(default)',
    AFFILIATE_NOTIFICATION_EVENT_MODE: 'production_held', AFFILIATE_NOTIFICATION_DELIVERY_MODE: 'production_test',
    AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: AFFILIATE_NOTIFICATION_PRODUCTION_ORIGIN,
    AFFILIATE_NOTIFICATION_SIGNING_SECRET: 'unit-test-dedicated-signing-secret-not-a-real-provider-secret',
    AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: hash(RECIPIENT), AFFILIATE_NOTIFICATION_TEST_RECIPIENT_EMAIL: RECIPIENT,
    RESEND_API_KEY: 'unit-test-provider-never-sent', RESEND_WEBHOOK_SECRET: 'unit-test-webhook-never-used',
    NEWSLETTER_FROM_EMAIL: 'Writer <sender@example.invalid>',
  };
  const request = { expectedRevision: 0, mode: 'production_test' as const, durationDays: 30, includeFoundingWelcome: false };
  const input = { db: db as unknown as Firestore, authenticatedWriterEmail: WRITER, clock: () => current,
    sendEmail: vi.fn(async () => ({ providerMessageId: 'provider_test_ack' })) };
  const review = (expectedRevision = 0) => saveProductionAffiliateNotificationReview({ db: input.db,
    authenticatedWriterEmail: WRITER, request: { ...request, expectedRevision }, now: current }, env);
  return { db, input, env, request, review, documents, reads, writes, settings,
    now: () => current, advance: (ms: number) => { current = new Date(Date.parse(current) + ms).toISOString(); },
    beforeTransaction: (hook: (index: number) => void) => { beforeTransaction = hook; },
  };
}

describe('production affiliate notification rollout', () => {
  it('requires an exact default-off production SDK and independently committed test address', async () => {
    const h = harness();
    for (const override of [
      { AFFILIATE_NOTIFICATION_EVENT_MODE: 'off' }, { AFFILIATE_NOTIFICATION_EVENT_MODE: ' Production_held ' },
      { VERCEL_ENV: 'preview' }, { FIREBASE_PROJECT_ID: 'another-project' }, { FIRESTORE_DATABASE_ID: 'other' },
      { AFFILIATE_NOTIFICATION_PRODUCTION_BASE_URL: 'https://attacker.example.invalid' },
      { AFFILIATE_NOTIFICATION_SIGNING_SECRET: '' }, { AFFILIATE_NOTIFICATION_TEST_RECIPIENT_SHA256: '' },
      { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { RESEND_WEBHOOK_SECRET: '' },
    ]) expect(productionAffiliateNotificationGate(h.input.db, { ...h.env, ...override }, true)).not.toBe('allowed');
    h.db.target.projectId = 'different-project';
    expect(productionAffiliateNotificationGate(h.input.db, h.env, true)).toBe('blocked');
    expect(h.reads).toEqual([]); expect(h.writes).toEqual([]); expect(h.input.sendEmail).not.toHaveBeenCalled();
  });

  it.each([null, [], {}, { expectedRevision: 0, mode: 'production_live', durationDays: 31, includeFoundingWelcome: false },
    { expectedRevision: 0, mode: 'production_test', durationDays: 1, includeFoundingWelcome: true },
    { expectedRevision: 0, mode: 'production_test', durationDays: 1, includeFoundingWelcome: false, recipient: 'unapproved@example.invalid' },
  ])('rejects unsupported writer review input %#', input => expect(parseProductionAffiliateNotificationReviewRequest(input)).toBeNull());

  it('creates a signed, prospective, sender/account/settings-bound review without changing any account or finances', async () => {
    const h = harness(); const financial = structuredClone(h.documents.get('transactions/preserved'));
    const affiliate = structuredClone(h.documents.get('affiliates/preserved'));
    const result = await h.review();
    expect(result).toMatchObject({ status: 'ready', mode: 'production_test', revision: 1, activatedAt: NOW, foundingWelcomeCount: 0 });
    expect(JSON.stringify(result)).not.toMatch(/@|signature|settingsSha256|reviewSha256|unit-test-provider/);
    const review = await readProductionAffiliateNotificationReview({ db: h.input.db, now: NOW }, h.env);
    expect(review?.review.testRecipient).toBe(RECIPIENT);
    expect(review?.review.reviewedBySha256).toBe(hash(WRITER));
    expect(review?.review.providerAccountSha256).toBe(hash(h.env.RESEND_API_KEY!));
    expect(h.documents.get('transactions/preserved')).toEqual(financial);
    expect(h.documents.get('affiliates/preserved')).toEqual(affiliate);
    expect(h.writes.every(path => path === 'site_configs/affiliate_notification_rollout' || path.startsWith('affiliate_audit/'))).toBe(true);
    expect(h.input.sendEmail).not.toHaveBeenCalled();
  });

  it('cannot authorize ordinary affiliate sends in controlled test mode', async () => {
    const h = harness(); await h.review();
    expect(await authorizeProductionAffiliateNotificationSource({ db: h.input.db, now: NOW,
      source: { eventType: 'activation', sourceId: 'partner-one', targetAffiliateId: 'partner-one', sourceVersion: 1, occurredAt: NOW } }, h.env)).toBeNull();
  });

  it('reports safe review capability separately from delivery authorization during an explicit test-to-live transition', async () => {
    const h = harness(); await h.review(); h.env.AFFILIATE_NOTIFICATION_DELIVERY_MODE = 'production_live';
    expect(await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env))
      .toMatchObject({ status: 'blocked', revision: 1, environmentMode: 'production_live', reviewAvailable: true });
    expect(await readProductionAffiliateNotificationReview({ db: h.input.db, now: NOW }, h.env)).toBeNull();
    h.env.RESEND_WEBHOOK_SECRET = '';
    expect(await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env))
      .toMatchObject({ status: 'blocked', reviewAvailable: false });
    h.env.AFFILIATE_NOTIFICATION_EVENT_MODE = 'off';
    expect(await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env))
      .toMatchObject({ status: 'disabled', reviewAvailable: false });
    expect(h.input.sendEmail).not.toHaveBeenCalled();
  });

  it('enforces expected revision, corruption refusal, expiry and exact current template hash', async () => {
    const h = harness(); await h.review();
    await expect(h.review()).rejects.toMatchObject({ code: 'conflict' });
    h.settings.revision++;
    expect((await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env)).status).toBe('settings_changed');
    expect(await readProductionAffiliateNotificationReview({ db: h.input.db, now: NOW }, h.env)).toBeNull();
    h.settings.revision--;
    h.advance(30 * 86_400_000);
    expect((await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: h.now() }, h.env)).status).toBe('expired');
    h.documents.get('site_configs/affiliate_notification_rollout').review.settingsRevision = 99;
    await expect(h.review(1)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('allows the authenticated writer to renew after a template edit without redeployment, and pause idempotently', async () => {
    const h = harness(); await h.review(); h.settings.revision++;
    h.advance(1_000); expect((await h.review(1)).revision).toBe(2);
    const input = { db: h.input.db, expectedRevision: 2, authenticatedWriterEmail: WRITER, now: h.now() };
    expect(await pauseProductionAffiliateNotifications(input, h.env)).toMatchObject({ status: 'paused', revision: 3 });
    const before = h.writes.length;
    expect(await pauseProductionAffiliateNotifications({ ...input, expectedRevision: 3 }, h.env)).toMatchObject({ status: 'paused', revision: 3 });
    expect(h.writes).toHaveLength(before);
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'ineligible' });
    expect(h.input.sendEmail).not.toHaveBeenCalled();
  });

  it('sends exactly one owner-allowlisted operational probe even when the writer account has a different email', async () => {
    const h = harness(); await h.review();
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'accepted' });
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'already_processed' });
    expect(h.input.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.input.sendEmail.mock.calls[0]).toEqual([expect.objectContaining({ to: RECIPIENT,
      idempotencyKey: expect.stringMatching(/^affiliate-writer-test-v1:nld_/), deliveryId: expect.stringMatching(/^nld_/) })]);
    const status = await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env);
    expect(status.testDeliveryStatus).toBe('accepted');
    expect(JSON.stringify(status)).not.toContain(RECIPIENT);
  });

  it('rejects an uncommitted probe address before database access and does not substitute the actor address', async () => {
    const h = harness();
    expect(await sendProductionAffiliateNotificationTest({ ...h.input, approvedTestRecipient: WRITER }, h.env)).toEqual({ status: 'blocked' });
    await expect(saveProductionAffiliateNotificationReview({ db: h.input.db, request: h.request,
      authenticatedWriterEmail: WRITER, approvedTestRecipient: WRITER, now: NOW }, h.env)).rejects.toMatchObject({ code: 'blocked' });
    expect(h.reads).toEqual([]); expect(h.writes).toEqual([]); expect(h.input.sendEmail).not.toHaveBeenCalled();
  });

  it('cancels a probe if settings change between lease and its second fresh authorization', async () => {
    const h = harness(); await h.review();
    h.beforeTransaction(index => { if (index === 3) h.settings.revision++; });
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'ineligible' });
    expect(h.input.sendEmail).not.toHaveBeenCalled();
    expect([...h.documents.values()].find(value => value?.kind === 'writer_test')?.status).toBe('cancelled');
  });

  it('holds an ambiguous provider attempt for investigation rather than sending a second message', async () => {
    const h = harness(); await h.review(); h.input.sendEmail.mockRejectedValue(new Error('private-provider-detail'));
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'failed' });
    expect(await sendProductionAffiliateNotificationTest(h.input, h.env)).toMatchObject({ status: 'already_processed' });
    expect(h.input.sendEmail).toHaveBeenCalledTimes(1);
    expect([...h.documents.values()].find(value => value?.kind === 'writer_test')?.status).toBe('needs_investigation');
    expect(JSON.stringify([...h.documents.values()])).not.toContain('private-provider-detail');
  });

  it('requires delivered webhook evidence before live review, keeps it separate from provider acceptance, and excludes historical sources', async () => {
    const h = harness(); await h.review();
    const probe = await sendProductionAffiliateNotificationTest(h.input, h.env);
    h.env.AFFILIATE_NOTIFICATION_DELIVERY_MODE = 'production_live';
    const live = () => saveProductionAffiliateNotificationReview({ db: h.input.db, authenticatedWriterEmail: WRITER,
      request: { ...h.request, expectedRevision: 1, mode: 'production_live' }, now: h.now() }, h.env);
    await expect(live()).rejects.toMatchObject({ code: 'blocked' });
    h.advance(1_000);
    expect(await reconcileProductionAffiliateNotificationTest({ db: h.input.db, deliveryId: probe.deliveryId!, providerMessageId: 'provider_test_ack',
      eventId: 'signed-event-id', eventAt: h.now(), recipients: [RECIPIENT], status: 'delivered', now: h.now() })).toEqual({ status: 'recorded' });
    h.advance(1_000); expect(await live()).toMatchObject({ status: 'ready', mode: 'production_live', revision: 2 });
    const source = { eventType: 'new_commission' as const, sourceId: 'verified-commission', sourceVersion: 1, targetAffiliateId: 'partner-one', occurredAt: NOW };
    expect(await authorizeProductionAffiliateNotificationSource({ db: h.input.db, source, now: h.now() }, h.env)).toBeNull();
    expect(await authorizeProductionAffiliateNotificationSource({ db: h.input.db, source: { ...source, occurredAt: h.now() }, now: h.now() }, h.env))
      .toMatchObject({ reviewSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await pauseProductionAffiliateNotifications({ db: h.input.db, authenticatedWriterEmail: WRITER, expectedRevision: 2, now: h.now() }, h.env);
    expect(await authorizeProductionAffiliateNotificationSource({ db: h.input.db, source: { ...source, occurredAt: h.now() }, now: h.now() }, h.env)).toBeNull();
  });

  it('does not accept wrong-recipient or stale webhook evidence and preserves delivered outcome on sent replay', async () => {
    const h = harness(); await h.review(); const probe = await sendProductionAffiliateNotificationTest(h.input, h.env);
    const event = { db: h.input.db, deliveryId: probe.deliveryId!, providerMessageId: 'provider_test_ack', eventId: 'verified-one', eventAt: NOW,
      recipients: [RECIPIENT], status: 'delivered', now: NOW };
    expect(await reconcileProductionAffiliateNotificationTest({ ...event, recipients: [WRITER] })).toEqual({ status: 'invalid' });
    expect(await reconcileProductionAffiliateNotificationTest(event)).toEqual({ status: 'recorded' });
    expect(await reconcileProductionAffiliateNotificationTest({ ...event, status: 'sent', eventId: 'verified-two' })).toEqual({ status: 'recorded' });
    expect((await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env)).testDeliveryStatus).toBe('delivered');
  });

  it('pins a review to its original provider account but permits an explicit fresh review after rotation', async () => {
    const h = harness(); await h.review(); h.env.RESEND_API_KEY = 'another-test-provider-account';
    expect(await readProductionAffiliateNotificationReview({ db: h.input.db, now: NOW }, h.env)).toBeNull();
    expect((await getProductionAffiliateNotificationRolloutStatus({ db: h.input.db, now: NOW }, h.env)).status).toBe('blocked');
    expect(await h.review(1)).toMatchObject({ status: 'ready', revision: 2 });
    expect(affiliateNotificationRolloutHash(h.settings)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each(['bounced', 'complained', 'suppressed'])('shares a signed writer-test %s with the matching newsletter subscriber without replacing its preferences', async status => {
    const h = harness(); await h.review();
    const probe = await sendProductionAffiliateNotificationTest(h.input, h.env);
    const emailHash = hash(RECIPIENT); const subscriberId = 'sub_approved_owner_fixture';
    const subscriber = { storageVersion: 1, email: RECIPIENT, emailIndexId: emailHash, status: 'active',
      name: 'Preserved owner', interests: ['healing'], discreetSubjects: true, consentAt: NOW };
    h.documents.set(`newsletter_email_index/${emailHash}`, { storageVersion: 1, emailHash, subscriberId });
    h.documents.set(`newsletter_subscribers/${subscriberId}`, structuredClone(subscriber));
    const event = { db: h.input.db, deliveryId: probe.deliveryId!, providerMessageId: 'provider_test_ack',
      eventId: `signed-${status}`, eventAt: NOW, recipients: [RECIPIENT], status, now: NOW };
    expect(await reconcileProductionAffiliateNotificationTest(event)).toEqual({ status: 'recorded' });
    expect(h.documents.get(`affiliate_notification_deliveries/suppression_${emailHash}`)).toMatchObject({ reason: status });
    expect(h.documents.get(`newsletter_subscribers/${subscriberId}`)).toEqual({ ...subscriber,
      status: 'suppressed', suppressionReason: status, updatedAt: NOW });
    const writeCount = h.writes.length;
    expect(await reconcileProductionAffiliateNotificationTest(event)).toEqual({ status: 'recorded' });
    expect(h.writes).toHaveLength(writeCount);
  });

  it.each(['index_hash', 'subscriber_hash', 'subscriber_email', 'missing_subscriber'])('does not modify unrelated newsletter data for a malformed %s identity', async change => {
    const h = harness(); await h.review(); const probe = await sendProductionAffiliateNotificationTest(h.input, h.env);
    const emailHash = hash(RECIPIENT); const subscriberId = 'sub_approved_owner_fixture';
    const index = { storageVersion: 1, emailHash, subscriberId };
    const subscriber = { storageVersion: 1, email: RECIPIENT, emailIndexId: emailHash, status: 'active', name: 'Preserved' };
    if (change === 'index_hash') index.emailHash = '0'.repeat(64);
    if (change === 'subscriber_hash') subscriber.emailIndexId = '0'.repeat(64);
    if (change === 'subscriber_email') subscriber.email = WRITER;
    h.documents.set(`newsletter_email_index/${emailHash}`, index);
    if (change !== 'missing_subscriber') h.documents.set(`newsletter_subscribers/${subscriberId}`, structuredClone(subscriber));
    expect(await reconcileProductionAffiliateNotificationTest({ db: h.input.db, deliveryId: probe.deliveryId!,
      providerMessageId: 'provider_test_ack', eventId: 'signed-bounce', eventAt: NOW, recipients: [RECIPIENT], status: 'bounced', now: NOW }))
      .toEqual({ status: 'recorded' });
    expect(h.documents.get(`newsletter_subscribers/${subscriberId}`)).toEqual(change === 'missing_subscriber' ? undefined : subscriber);
    expect(h.writes).not.toContain(`newsletter_subscribers/${subscriberId}`);
    expect(h.documents.get(`affiliate_notification_deliveries/suppression_${emailHash}`)).toMatchObject({ reason: 'bounced' });
  });
});

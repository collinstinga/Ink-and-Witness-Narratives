import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const firestore = vi.hoisted(() => ({
  documents: new Map<string, any>(),
  getDb: vi.fn(),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('./db.js', () => ({
  getDb: firestore.getDb,
  getFirestoreDoc: firestore.getDoc,
  sanitizeForFirestore: (value: unknown) => JSON.parse(JSON.stringify(value)),
}));

import {
  AFFILIATE_MARKETING_DISCLOSURE_VERSION,
  AffiliateNotificationPreferencesConflictError,
  DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
  getAffiliateNotificationPreferencesFresh,
  normalizeAffiliateNotificationPreferences,
  optOutAffiliateMarketingByToken,
  saveAffiliateNotificationPreferences,
} from './affiliateNotificationPreferences.js';
import { createAffiliateMarketingOptOutToken } from './affiliateNotificationSecurity.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

const validUpdate = (overrides: Record<string, unknown> = {}) => ({
  expectedRevision: 0,
  marketingConsent: true,
  releaseUpdates: true,
  campaignUpdates: true,
  inactivityReminders: false,
  exclusiveOpportunities: true,
  commissionAlerts: true,
  tierAlerts: true,
  ...overrides,
});

describe('affiliate notification preferences', () => {
  beforeEach(() => {
    firestore.documents.clear();
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
    firestore.getDoc.mockImplementation(async (collection: string, id: string) => (
      clone(firestore.documents.get(`${collection}/${id}`) ?? null)
    ));
    const db = {
      collection: (collection: string) => ({ doc: (id: string) => ({ collection, id }) }),
      runTransaction: firestore.runTransaction,
    };
    firestore.getDb.mockReturnValue(db);
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: any[] = [];
      let writeStarted = false;
      const transaction = {
        get: async (reference: any) => {
          if (writeStarted) throw new Error('read after write');
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return { exists: value !== undefined, data: () => clone(value) };
        },
        set: (reference: any, value: any, options?: { merge?: boolean; mergeFields?: string[] }) => {
          writeStarted = true;
          if (reference.collection === 'affiliates') {
            // Replacing this whole map must remove omitted consent evidence;
            // Firestore merge:true would recursively retain those old fields.
            expect(options).toEqual({ mergeFields: ['notificationPreferences', 'updatedAt'] });
            expect(Object.keys(value).sort()).toEqual([...options!.mergeFields!].sort());
          }
          writes.push({ reference, value: clone(value), merge: options?.merge === true || Boolean(options?.mergeFields) });
        },
      };
      const result = await operation(transaction);
      for (const write of writes) {
        const key = `${write.reference.collection}/${write.reference.id}`;
        firestore.documents.set(key, write.merge
          ? { ...(firestore.documents.get(key) || {}), ...write.value }
          : write.value);
      }
      return clone(result);
    });
  });

  afterEach(() => { vi.useRealTimers(); });

  it('defaults marketing to unknown and fully opted out without borrowing terms consent', async () => {
    firestore.documents.set('affiliates/aff-one', { id: 'aff-one', acceptedTerms: true });
    const preferences = await getAffiliateNotificationPreferencesFresh('aff-one');

    expect(preferences).toEqual(DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES);
    expect(preferences.marketingConsent).toBe('unknown');
    expect(preferences.allMarketingOptOut).toBe(true);
  });

  it('fails closed when a stored consent lacks the current disclosure version or timestamp', () => {
    const normalized = normalizeAffiliateNotificationPreferences({
      schemaVersion: 1,
      revision: 4,
      marketingConsent: 'granted',
      marketingConsentVersion: 'old-version',
      releaseUpdates: true,
      allMarketingOptOut: false,
    });
    expect(normalized).toMatchObject({
      revision: 4,
      marketingConsent: 'unknown',
      releaseUpdates: false,
      allMarketingOptOut: true,
    });
  });

  it.each([undefined, 'not-a-date', '2026-10-01', '2026-10-01T03:00:00+03:00'])('does not fabricate release-topic chronology from missing/noncanonical evidence: %s', releaseUpdatesEnabledAt => {
    const normalized = normalizeAffiliateNotificationPreferences({
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false,
      releaseUpdates: true, releaseUpdatesEnabledAt,
    });
    expect(normalized.releaseUpdates).toBe(true);
    expect(normalized.releaseUpdatesEnabledAt).toBeUndefined();
  });

  it('retains canonical topic evidence only while release marketing remains enabled', () => {
    const value = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false,
      releaseUpdates: true, releaseUpdatesEnabledAt: '2026-10-02T00:00:00.000Z',
    };
    expect(normalizeAffiliateNotificationPreferences(value).releaseUpdatesEnabledAt).toBe(value.releaseUpdatesEnabledAt);
    expect(normalizeAffiliateNotificationPreferences({ ...value, releaseUpdates: false }).releaseUpdatesEnabledAt).toBeUndefined();
    expect(normalizeAffiliateNotificationPreferences({ ...value, marketingConsent: 'denied' }).releaseUpdatesEnabledAt).toBeUndefined();
  });

  it('atomically records explicit consent, category choices and a notification audit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'));
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      notificationPreferences: DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
    });

    const saved = await saveAffiliateNotificationPreferences('aff-one', validUpdate(), 'Affiliate (Amina)');

    expect(saved.preferences).toMatchObject({
      revision: 1,
      marketingConsent: 'granted',
      marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentSource: 'affiliate_dashboard',
      releaseUpdates: true,
      releaseUpdatesEnabledAt: '2026-10-23T10:00:00.000Z',
      campaignUpdates: true,
      inactivityReminders: false,
      allMarketingOptOut: false,
    });
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).toEqual(saved.preferences);
    const audit = [...firestore.documents.entries()].find(([key]) => key.startsWith('affiliate_audit/'))?.[1];
    expect(audit).toMatchObject({
      action: 'affiliate_notification_preferences_saved',
      targetType: 'notification',
      targetId: 'aff-one',
    });
  });

  it('dates a new release-topic opt-in independently, preserves it on saves, and resets it after re-enabling', async () => {
    vi.useFakeTimers();
    const initialConsent = '2026-10-01T00:00:00.000Z';
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one', affiliateCode: 'AFFONE', walletBalanceKes: 700,
      customData: { preserved: true },
      notificationPreferences: {
        ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
        marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: initialConsent, releaseUpdates: false, campaignUpdates: true,
        allMarketingOptOut: false, commissionAlerts: false, tierAlerts: true,
      },
    });
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'));
    const first = await saveAffiliateNotificationPreferences('aff-one', validUpdate({ commissionAlerts: false }), 'Affiliate');
    expect(first.preferences.marketingConsentAt).toBe(initialConsent);
    expect(first.preferences.releaseUpdatesEnabledAt).toBe('2026-10-23T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-23T11:00:00.000Z'));
    const savedAgain = await saveAffiliateNotificationPreferences('aff-one', validUpdate({ expectedRevision: 1, commissionAlerts: false }), 'Affiliate');
    expect(savedAgain.preferences.releaseUpdatesEnabledAt).toBe(first.preferences.releaseUpdatesEnabledAt);
    const disabled = await saveAffiliateNotificationPreferences('aff-one', validUpdate({ expectedRevision: 2, releaseUpdates: false, commissionAlerts: false }), 'Affiliate');
    expect(disabled.preferences.releaseUpdatesEnabledAt).toBeUndefined();
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty('releaseUpdatesEnabledAt');
    vi.setSystemTime(new Date('2026-10-24T10:00:00.000Z'));
    const reenabled = await saveAffiliateNotificationPreferences('aff-one', validUpdate({ expectedRevision: 3, commissionAlerts: false }), 'Affiliate');
    expect(reenabled.preferences.releaseUpdatesEnabledAt).toBe('2026-10-24T10:00:00.000Z');
    expect(reenabled.preferences.marketingConsentAt).toBe(initialConsent);
    expect(reenabled.preferences).toMatchObject({ commissionAlerts: false, tierAlerts: true, campaignUpdates: true });
    expect(firestore.documents.get('affiliates/aff-one')).toMatchObject({
      id: 'aff-one', affiliateCode: 'AFFONE', walletBalanceKes: 700, customData: { preserved: true },
    });
  });

  it('allows an old release preference without evidence to opt in only from an explicit current save', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'));
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one', notificationPreferences: {
        ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
        marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false, releaseUpdates: true,
      },
    });
    const saved = await saveAffiliateNotificationPreferences('aff-one', validUpdate(), 'Affiliate');
    expect(saved.preferences.releaseUpdatesEnabledAt).toBe('2026-10-23T10:00:00.000Z');
    expect(saved.preferences.marketingConsentAt).toBe('2026-10-01T00:00:00.000Z');
  });

  it.each([
    ['campaignUpdates', 'campaignUpdatesEnabledAt'],
    ['inactivityReminders', 'inactivityRemindersEnabledAt'],
    ['exclusiveOpportunities', 'exclusiveOpportunitiesEnabledAt'],
  ] as const)('records independent server opt-in chronology for %s without backfilling or accepting spoofed dates', async (topic, evidence) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T10:00:00.000Z'));
    const initial = {
      ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
      marketingConsent: 'granted', marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
      marketingConsentAt: '2026-10-01T00:00:00.000Z', allMarketingOptOut: false,
      [topic]: true,
    };
    expect(normalizeAffiliateNotificationPreferences(initial)[evidence]).toBeUndefined();
    expect(normalizeAffiliateNotificationPreferences({ ...initial, [evidence]: '2026-10-01' })[evidence]).toBeUndefined();
    firestore.documents.set('affiliates/aff-one', { id: 'aff-one', notificationPreferences: initial, balanceAvailableKes: 800 });
    const update = { ...validUpdate(), [topic]: true };
    const first = await saveAffiliateNotificationPreferences('aff-one', update, 'Affiliate');
    expect(first.preferences[evidence]).toBe('2026-10-23T10:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-23T11:00:00.000Z'));
    const again = await saveAffiliateNotificationPreferences('aff-one', { ...update, expectedRevision: 1 }, 'Affiliate');
    expect(again.preferences[evidence]).toBe(first.preferences[evidence]);
    await saveAffiliateNotificationPreferences('aff-one', { ...update, expectedRevision: 2, [topic]: false }, 'Affiliate');
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty(evidence);
    const reenabled = await saveAffiliateNotificationPreferences('aff-one', { ...update, expectedRevision: 3 }, 'Affiliate');
    expect(reenabled.preferences[evidence]).toBe('2026-10-23T11:00:00.000Z');
    expect(reenabled.preferences.marketingConsentAt).toBe('2026-10-01T00:00:00.000Z');
    expect(firestore.documents.get('affiliates/aff-one').balanceAvailableKes).toBe(800);
    await expect(saveAffiliateNotificationPreferences('aff-one', { ...update, expectedRevision: 4, [evidence]: '2020-01-01T00:00:00.000Z' }, 'Affiliate')).rejects.toThrow(/unsupported/i);
    const optedOut = await saveAffiliateNotificationPreferences('aff-one', { ...update, expectedRevision: 4, marketingConsent: false }, 'Affiliate');
    expect(optedOut.preferences[evidence]).toBeUndefined();
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty(evidence);
  });

  it('turns a refusal into an explicit all-marketing opt-out and clears marketing categories', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      notificationPreferences: {
        ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
        revision: 2,
        marketingConsent: 'granted',
        marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: '2026-10-01T00:00:00.000Z',
        marketingConsentSource: 'affiliate_dashboard',
        releaseUpdates: true,
        releaseUpdatesEnabledAt: '2026-10-02T00:00:00.000Z',
        allMarketingOptOut: false,
      },
    });

    const saved = await saveAffiliateNotificationPreferences('aff-one', validUpdate({
      expectedRevision: 2,
      marketingConsent: false,
      commissionAlerts: false,
    }), 'Affiliate (Amina)');

    expect(saved.preferences).toMatchObject({
      revision: 3,
      marketingConsent: 'denied',
      marketingOptOutSource: 'affiliate_dashboard',
      releaseUpdates: false,
      campaignUpdates: false,
      exclusiveOpportunities: false,
      allMarketingOptOut: true,
      commissionAlerts: false,
    });
    expect(saved.preferences.marketingConsentAt).toBeUndefined();
    expect(saved.preferences.releaseUpdatesEnabledAt).toBeUndefined();
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty('releaseUpdatesEnabledAt');
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty('marketingConsentAt');
    expect(saved.preferences.marketingOptOutAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects stale revisions and unsupported writer-controlled fields', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      notificationPreferences: { ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES, revision: 3 },
    });

    await expect(saveAffiliateNotificationPreferences('aff-one', validUpdate(), 'Affiliate'))
      .rejects.toBeInstanceOf(AffiliateNotificationPreferencesConflictError);
    await expect(saveAffiliateNotificationPreferences('aff-one', {
      ...validUpdate({ expectedRevision: 3 }),
      marketingConsentSource: 'writer_recorded',
    }, 'Affiliate')).rejects.toThrow(/unsupported/i);
    await expect(saveAffiliateNotificationPreferences('aff-one', {
      ...validUpdate({ expectedRevision: 3 }),
      releaseUpdatesEnabledAt: '2020-01-01T00:00:00.000Z',
    }, 'Affiliate')).rejects.toThrow(/unsupported/i);
  });

  it('atomically applies a signed marketing opt-out while preserving operational alerts', async () => {
    firestore.documents.set('affiliates/aff-one', {
      id: 'aff-one',
      affiliateCode: 'AFFONE',
      notificationPreferences: {
        ...DEFAULT_AFFILIATE_NOTIFICATION_PREFERENCES,
        revision: 2,
        marketingConsent: 'granted',
        marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: '2026-10-01T00:00:00.000Z',
        marketingConsentSource: 'affiliate_dashboard',
        releaseUpdates: true,
        releaseUpdatesEnabledAt: '2026-10-02T00:00:00.000Z',
        campaignUpdates: true,
        inactivityReminders: true,
        exclusiveOpportunities: true,
        commissionAlerts: false,
        tierAlerts: true,
        allMarketingOptOut: false,
      },
    });
    const secret = 'affiliate-opt-out-test-secret-at-least-32-characters';
    const token = createAffiliateMarketingOptOutToken('aff-one', secret);

    const first = await optOutAffiliateMarketingByToken(token, { signingSecret: secret });
    const second = await optOutAffiliateMarketingByToken(token, { signingSecret: secret });

    expect(first).toMatchObject({ accepted: true, changed: true });
    expect(first.audit).toMatchObject({ action: 'affiliate_marketing_opt_out_confirmed' });
    expect(second).toEqual({ accepted: true, changed: false, affiliateId: 'aff-one' });
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).toMatchObject({
      revision: 3,
      marketingConsent: 'denied',
      marketingOptOutSource: 'signed_email_link',
      releaseUpdates: false,
      campaignUpdates: false,
      inactivityReminders: false,
      exclusiveOpportunities: false,
      commissionAlerts: false,
      tierAlerts: true,
      allMarketingOptOut: true,
    });
    expect([...firestore.documents.keys()].filter(key => key.startsWith('affiliate_audit/'))).toHaveLength(1);
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty('releaseUpdatesEnabledAt');
    expect(firestore.documents.get('affiliates/aff-one').notificationPreferences).not.toHaveProperty('marketingConsentAt');
  });

  it('accepts invalid or missing-account opt-out capabilities without disclosing account state', async () => {
    const secret = 'affiliate-opt-out-test-secret-at-least-32-characters';
    await expect(optOutAffiliateMarketingByToken('invalid-token', { signingSecret: secret }))
      .resolves.toEqual({ accepted: true, changed: false });
    const missing = createAffiliateMarketingOptOutToken('aff-missing', secret);
    await expect(optOutAffiliateMarketingByToken(missing, { signingSecret: secret }))
      .resolves.toEqual({ accepted: true, changed: false });
  });
});

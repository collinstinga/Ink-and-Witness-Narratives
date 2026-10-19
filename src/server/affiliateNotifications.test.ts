import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import type {
  AffiliatePublicProfile,
  LiteraryCircleNotificationSettings,
  LiteraryCircleNotificationTemplate,
} from '../types.js';
import {
  AffiliateNotificationConflictError,
  DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS,
  getAffiliateNotificationSettingsFresh,
  normalizeAffiliateNotificationSettings,
  renderAffiliateNotificationTemplate,
  saveAffiliateNotificationSettings,
  summarizeAffiliateNotificationEligibility,
  validateAffiliateNotificationSettings,
} from './affiliateNotifications.js';
import { AFFILIATE_MARKETING_DISCLOSURE_VERSION } from './affiliateNotificationPreferences.js';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function settings(): LiteraryCircleNotificationSettings {
  return clone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
}

function template(eventType: LiteraryCircleNotificationTemplate['eventType']): LiteraryCircleNotificationTemplate {
  return settings().templates.find(candidate => candidate.eventType === eventType)!;
}

function affiliate(overrides: Partial<AffiliatePublicProfile> = {}): AffiliatePublicProfile {
  return {
    id: 'affiliate-one',
    affiliateCode: 'AFFONE',
    name: 'Partner One',
    email: 'partner@example.com',
    phone: '+254700000000',
    status: 'active',
    approvedAt: '2026-10-01T00:00:00.000Z',
    approvedBy: 'Writer',
    payoutMethod: 'mpesa',
    payoutDetails: {},
    totalClicks: 0,
    uniqueVisitors: 0,
    totalSalesCount: 0,
    totalRevenueKes: 0,
    totalCommissionEarnedKes: 0,
    totalCommissionPaidKes: 0,
    balanceAvailableKes: 0,
    balancePendingKes: 0,
    acceptedTerms: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    literaryCircle: {
      schemaVersion: 1,
      memberSince: '2026-09-01T00:00:00.000Z',
      foundingMember: true,
      complimentaryAccess: {
        status: 'active',
        scope: 'all_published',
        grantedAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
        updatedBy: 'Writer',
      },
      tier: {
        id: 'literary-partner',
        assignedAt: '2026-09-01T00:00:00.000Z',
        source: 'default',
      },
      onboarding: {
        version: 1,
        audience: 'existing_upgrade',
        status: 'completed',
        completedStepIds: [],
        welcomeRequired: false,
      },
    },
    ...overrides,
  } as AffiliatePublicProfile;
}

describe('affiliate notification preview configuration', () => {
  beforeEach(() => {
    firestore.documents.clear();
    firestore.getDoc.mockReset();
    firestore.runTransaction.mockReset();
    firestore.getDoc.mockImplementation(async (collection: string, id: string) => (
      clone(firestore.documents.get(`${collection}/${id}`) ?? null)
    ));
    const db = {
      collection: (collection: string) => ({
        doc: (id: string) => ({ collection, id }),
      }),
      runTransaction: firestore.runTransaction,
    };
    firestore.getDb.mockReturnValue(db);
    firestore.runTransaction.mockImplementation(async (operation: (transaction: any) => Promise<any>) => {
      const writes: Array<{ reference: any; value: any; merge?: boolean }> = [];
      let writeStarted = false;
      const transaction = {
        get: async (reference: { collection: string; id: string }) => {
          if (writeStarted) throw new Error('read after write');
          const value = firestore.documents.get(`${reference.collection}/${reference.id}`);
          return { exists: value !== undefined, data: () => clone(value) };
        },
        set: (reference: any, value: any, options?: { merge?: boolean }) => {
          writeStarted = true;
          writes.push({ reference, value: clone(value), merge: options?.merge });
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

  it('fails closed with all seven events disabled and preview-only delivery', async () => {
    const fresh = await getAffiliateNotificationSettingsFresh();
    expect(fresh.deliveryMode).toBe('preview_only');
    expect(fresh.enabled).toBe(false);
    expect(fresh.templates).toHaveLength(7);
    expect(fresh.templates.every(candidate => !candidate.enabled)).toBe(true);

    const corrupt = normalizeAffiliateNotificationSettings({ schemaVersion: 99, enabled: true });
    expect(corrupt.enabled).toBe(false);
    expect(corrupt.templates.every(candidate => !candidate.enabled)).toBe(true);
  });

  it('rejects unknown fields, live delivery, raw HTML, malformed placeholders and unsafe URLs', () => {
    expect(() => validateAffiliateNotificationSettings({ ...settings(), surprise: true })).toThrow(/unsupported/i);
    expect(() => validateAffiliateNotificationSettings({ ...settings(), deliveryMode: 'live' })).toThrow(/preview-only/i);

    const html = settings();
    html.templates[0].body = '<script>alert(1)</script>';
    expect(() => validateAffiliateNotificationSettings(html)).toThrow(/must not contain HTML/i);

    const token = settings();
    token.templates[0].subject = 'Hello {{buyerPhone}}';
    expect(() => validateAffiliateNotificationSettings(token)).toThrow(/unsupported placeholder/i);

    const unsafeUrl = settings();
    unsafeUrl.templates[0].ctaUrl = 'javascript:alert(1)';
    expect(() => validateAffiliateNotificationSettings(unsafeUrl)).toThrow(/HTTPS/i);
  });

  it('stores settings and a copy-digest audit atomically, then rejects a stale revision', async () => {
    const candidate = settings();
    candidate.enabled = true;
    candidate.templates[0].enabled = true;
    const saved = await saveAffiliateNotificationSettings(candidate, 'Writer', 0);

    expect(saved.settings.revision).toBe(1);
    expect(saved.settings.deliveryMode).toBe('preview_only');
    expect(firestore.documents.get('site_configs/affiliate_notifications')).toMatchObject({ revision: 1 });
    const audit = [...firestore.documents.entries()].find(([key]) => key.startsWith('affiliate_audit/'))?.[1];
    expect(audit).toMatchObject({ targetType: 'notification', action: 'affiliate_notification_settings_saved' });
    expect(JSON.stringify(audit)).not.toContain(candidate.templates[0].body);
    expect(audit.newValue.templates[0].bodyDigest.sha256).toMatch(/^[a-f0-9]{64}$/);

    await expect(saveAffiliateNotificationSettings(settings(), 'Stale writer', 0))
      .rejects.toBeInstanceOf(AffiliateNotificationConflictError);
  });

  it('requires explicit writer approval and marketing consent while preserving operational notices', () => {
    const release = template('new_release');
    const commission = template('new_commission');
    const noApproval = affiliate({ approvedAt: undefined });
    const noConsent = affiliate();
    const optedIn = affiliate({
      notificationPreferences: {
        schemaVersion: 1,
        revision: 1,
        marketingConsent: 'granted',
        marketingConsentVersion: AFFILIATE_MARKETING_DISCLOSURE_VERSION,
        marketingConsentAt: '2026-10-01T00:00:00.000Z',
        marketingConsentSource: 'affiliate_dashboard',
        releaseUpdates: true,
        campaignUpdates: true,
        inactivityReminders: true,
        exclusiveOpportunities: true,
        commissionAlerts: true,
        tierAlerts: true,
        allMarketingOptOut: false,
      },
    });

    const releaseSummary = summarizeAffiliateNotificationEligibility([noApproval, noConsent, optedIn], release);
    expect(releaseSummary).toMatchObject({ total: 3, eligible: 1, excluded: 2 });
    expect(releaseSummary.reasons.writer_approval_missing).toBe(1);
    expect(releaseSummary.reasons.marketing_consent_or_preference_missing).toBe(1);

    const commissionSummary = summarizeAffiliateNotificationEligibility([noConsent], commission);
    expect(commissionSummary.eligible).toBe(1);
  });

  it('fails closed for marketing consent recorded under an old disclosure', () => {
    const release = template('new_release');
    const staleConsent = affiliate({
      notificationPreferences: {
        schemaVersion: 1,
        revision: 4,
        marketingConsent: 'granted',
        marketingConsentVersion: 'retired-disclosure',
        marketingConsentAt: '2026-10-01T00:00:00.000Z',
        marketingConsentSource: 'affiliate_dashboard',
        releaseUpdates: true,
        campaignUpdates: true,
        inactivityReminders: true,
        exclusiveOpportunities: true,
        commissionAlerts: true,
        tierAlerts: true,
        allMarketingOptOut: false,
      },
    });

    const summary = summarizeAffiliateNotificationEligibility([staleConsent], release);
    expect(summary).toMatchObject({ eligible: 0, excluded: 1 });
    expect(summary.reasons.marketing_consent_or_preference_missing).toBe(1);
  });

  it('applies founding, tier and complimentary access filters without changing affiliate state', () => {
    const inactivity = template('inactivity_reminder');
    inactivity.eligibility = {
      foundingMembersOnly: true,
      tierIds: ['literary-patron'],
      requireComplimentaryAccess: true,
    };
    const optedIn = affiliate({
      notificationPreferences: {
        schemaVersion: 1,
        revision: 1,
        marketingConsent: 'granted',
        releaseUpdates: true,
        campaignUpdates: true,
        inactivityReminders: true,
        exclusiveOpportunities: true,
        commissionAlerts: true,
        tierAlerts: true,
        allMarketingOptOut: false,
      },
    });
    const before = clone(optedIn);
    const summary = summarizeAffiliateNotificationEligibility([optedIn], inactivity);
    expect(summary).toMatchObject({ eligible: 0, excluded: 1 });
    expect(summary.reasons.tier_not_selected).toBe(1);
    expect(optedIn).toEqual(before);
  });

  it('renders only event-scoped placeholders and leaves missing sample values visible', () => {
    const rendered = renderAffiliateNotificationTemplate(template('tier_upgrade'), {
      affiliateName: 'Amina',
      tierName: 'Literary Patron',
      portalUrl: 'https://inkandwitness-narratives.co.ke/',
    });
    expect(rendered.heading).toBe('Welcome to Literary Patron');
    expect(rendered.body).toContain('Hello Amina');
    expect(rendered.ctaUrl).toBe('https://inkandwitness-narratives.co.ke/');
  });
});

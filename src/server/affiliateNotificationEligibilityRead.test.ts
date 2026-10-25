import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import { DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS, AffiliateNotificationValidationError } from './affiliateNotifications.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS } from './literaryCircle.js';
import { affiliateTierPeriodDocumentId } from './affiliateTierPeriods.js';
import {
  AffiliateNotificationEligibilityOverflowError,
  AffiliateNotificationEligibilityReadError,
  readAffiliateNotificationEligibility,
} from './affiliateNotificationEligibilityRead.js';

const NOW = '2026-10-24T10:00:00.000Z';
type Ref = { path: string; id: string };
function account(id: string, source = 'default') {
  return { id: 'untrusted-stored-id', status: 'active', name: 'Private affiliate name', email: `${id}@example.test`, acceptedTerms: true,
    approvedAt: '2026-10-01T00:00:00.000Z', approvedBy: 'Writer',
    literaryCircle: { schemaVersion: 1, complimentaryAccess: { status: 'active' },
      tier: { id: source === 'manual' ? 'literary-ambassador' : 'literary-patron', source, assignedAt: '2026-10-01T00:00:00.000Z' } } };
}
function harness() {
  const documents = new Map<string, any>(); const reads: string[] = []; const queries: number[] = [];
  const snapshot = (ref: Ref) => ({ ref, id: ref.id, exists: documents.has(ref.path), data: () => structuredClone(documents.get(ref.path)) });
  let failRead = false;
  const db = {
    collection: (name: string) => ({
      doc: (id: string): Ref => ({ id, path: `${name}/${id}` }),
      limit: (maximum: number) => ({ collection: name, maximum }),
    }),
    runTransaction: vi.fn(async (operation: (transaction: any) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({ readOnly: true });
      const get = async (target: Ref | { collection: string; maximum: number }) => {
        if (failRead) throw new Error('private-sdk-token@example.test');
        if ('collection' in target) {
          expect(target.collection).toBe('affiliates'); expect(target.maximum).toBe(201); queries.push(target.maximum);
          return { docs: [...documents.keys()].filter(path => path.startsWith('affiliates/')).slice(0, target.maximum)
            .map(path => snapshot({ path, id: path.slice('affiliates/'.length) })) };
        }
        reads.push(target.path); return snapshot(target);
      };
      return operation({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
        create: () => { throw new Error('unexpected write'); }, set: () => { throw new Error('unexpected write'); },
        update: () => { throw new Error('unexpected write'); }, delete: () => { throw new Error('unexpected write'); } });
    }),
  };
  const settings = structuredClone(DEFAULT_AFFILIATE_NOTIFICATION_SETTINGS);
  settings.enabled = true; settings.revision = 3;
  const template = settings.templates.find(item => item.eventType === 'new_commission')!;
  template.enabled = true; template.eligibility.tierIds = ['literary-ambassador'];
  const circle = structuredClone(DEFAULT_LITERARY_CIRCLE_SETTINGS);
  circle.enabled = true; circle.revision = 4; circle.tiers[1].monthlyVerifiedSalesThreshold = 2;
  circle.commissionPolicy = { status: 'active', version: 1, effectiveAt: '2026-10-01T00:00:00.000Z', subscriptionRenewalsEligible: false };
  documents.set('site_configs/affiliate_notifications', settings); documents.set('site_configs/affiliate_literary_circle', circle);
  documents.set('affiliates/partner-one', account('partner-one'));
  documents.set('affiliates/partner-manual', account('partner-manual', 'manual'));
  documents.set('affiliates/partner-missing', account('partner-missing'));
  const periodPath = `affiliate_tier_periods/${affiliateTierPeriodDocumentId('partner-one', '2026-10')}`;
  documents.set(periodPath, { schemaVersion: 1, affiliateId: 'partner-one', periodKey: '2026-10', revision: 1,
    evidenceComplete: true, awardedMilestones: [], members: [0, 1].map(index => {
      const checkoutRequestId = `checkout-${index}`;
      return { checkoutRequestId, createdAt: '2026-10-22T10:00:00.000Z',
        id: `com_tx_${crypto.createHash('sha256').update(checkoutRequestId).digest('hex').slice(0, 40)}` };
    }) });
  return { documents, reads, queries, db, settings, circle, template, periodPath,
    input: { db: db as unknown as Firestore, eventType: 'new_commission' as const, now: NOW },
    failRead: () => { failRead = true; } };
}

describe('bounded fresh writer notification eligibility preview', () => {
  it('matches canonical monthly and manual audiences from one read-only snapshot without exposing profiles or evidence', async () => {
    const h = harness(); const before = structuredClone([...h.documents]);
    const result = await readAffiliateNotificationEligibility(h.input);
    expect(result).toEqual({ eventType: 'new_commission', total: 3, eligible: 2, excluded: 1,
      reasons: { automatic_tier_filter_requires_verified_evidence: 1 } });
    expect(h.queries).toEqual([201]); expect(h.db.runTransaction).toHaveBeenCalledTimes(1);
    expect(h.reads).toEqual(['site_configs/affiliate_notifications', 'site_configs/affiliate_literary_circle', h.periodPath,
      `affiliate_tier_periods/${affiliateTierPeriodDocumentId('partner-missing', '2026-10')}`]);
    expect([...h.documents]).toEqual(before);
    expect(JSON.stringify(result)).not.toMatch(/Private|@example|partner-one|atp1_|evidenceSha256/);
  });

  it('rejects the 201st affiliate before settings, policy or monthly evidence reads and never truncates totals', async () => {
    const h = harness();
    for (let index = 0; index < 198; index++) h.documents.set(`affiliates/extra-${index}`, account(`extra-${index}`));
    await expect(readAffiliateNotificationEligibility(h.input)).rejects.toBeInstanceOf(AffiliateNotificationEligibilityOverflowError);
    expect(h.reads).toEqual([]); expect(h.queries).toEqual([201]);
  });

  it('supports exactly 200 affiliates without consulting financial evidence for an unfiltered template', async () => {
    const h = harness(); h.template.eligibility.tierIds = [];
    for (let index = 0; index < 197; index++) h.documents.set(`affiliates/extra-${index}`, account(`extra-${index}`));
    expect(await readAffiliateNotificationEligibility(h.input)).toMatchObject({ total: 200, eligible: 200, excluded: 0 });
    expect(h.reads).toEqual(['site_configs/affiliate_notifications']);
  });

  it('previews writer template drafts but resolves tier policy only from the database', async () => {
    const h = harness(); const draft = structuredClone(h.settings);
    draft.templates.find(item => item.eventType === 'new_commission')!.eligibility.tierIds = ['literary-patron'];
    expect(await readAffiliateNotificationEligibility({ ...h.input, settings: draft })).toMatchObject({ eligible: 0 });
    expect(h.reads).not.toContain('site_configs/affiliate_notifications');
    expect(h.reads).toContain('site_configs/affiliate_literary_circle');
    expect(h.documents.get('site_configs/affiliate_notifications')).toEqual(h.settings);
  });

  it.each(['missing_period', 'incomplete_period', 'disabled_policy', 'next_month'])('holds %s evidence in the preview just as in outbox planning', async change => {
    const h = harness();
    if (change === 'missing_period') h.documents.delete(h.periodPath);
    if (change === 'incomplete_period') h.documents.get(h.periodPath).evidenceComplete = false;
    if (change === 'disabled_policy') h.circle.commissionPolicy.status = 'draft';
    if (change === 'next_month') h.input.now = '2026-10-31T21:00:00.000Z';
    expect(await readAffiliateNotificationEligibility(h.input)).toMatchObject({ total: 3, eligible: 1 });
  });

  it('re-reads policy changes instead of returning an earlier cached audience', async () => {
    const h = harness(); expect((await readAffiliateNotificationEligibility(h.input)).eligible).toBe(2);
    h.circle.tiers[1].monthlyVerifiedSalesThreshold = 10; h.circle.revision!++;
    expect((await readAffiliateNotificationEligibility(h.input)).eligible).toBe(1);
    expect(h.db.runTransaction).toHaveBeenCalledTimes(2);
  });

  it('redacts SDK failures and supplies no partial or stale summary', async () => {
    const h = harness(); h.failRead();
    const error = await readAffiliateNotificationEligibility(h.input).catch(value => value);
    expect(error).toBeInstanceOf(AffiliateNotificationEligibilityReadError);
    expect(error.message).not.toMatch(/private-sdk|example|token/);
  });

  it('validates draft settings, event types and server clocks before any database operation', async () => {
    const h = harness();
    await expect(readAffiliateNotificationEligibility({ ...h.input, eventType: 'unknown' as any })).rejects.toBeInstanceOf(AffiliateNotificationValidationError);
    await expect(readAffiliateNotificationEligibility({ ...h.input, settings: {} })).rejects.toBeInstanceOf(AffiliateNotificationValidationError);
    await expect(readAffiliateNotificationEligibility({ ...h.input, now: '2026-10-24' })).rejects.toBeInstanceOf(AffiliateNotificationEligibilityReadError);
    expect(h.db.runTransaction).not.toHaveBeenCalled(); expect(h.queries).toEqual([]);
  });
});

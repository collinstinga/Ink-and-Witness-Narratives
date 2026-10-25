import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliatePublicProfile, LiteraryCircleSettings } from '../types.js';
import {
  AFFILIATE_TIER_PERIOD_COLLECTION,
  affiliateTierPeriodDocumentId,
  countAffiliateTierPeriodSales,
  type AffiliateTierPeriod,
} from './affiliateTierPeriods.js';
import {
  literaryCirclePeriodKey,
  resolveLiteraryCircleSettingsForTransaction,
  resolveLiteraryCircleTier,
} from './literaryCircle.js';
import type { VerifiedAffiliateNotificationMonthlyTiers } from './affiliateNotificationTierFilter.js';

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_TIER = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const MAX_RECIPIENTS = 200;

function record(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function time(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 && new Date(parsed).toISOString() === value ? parsed : null;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).filter(key => object[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}
function validTiers(value: unknown, defaultId: unknown): boolean {
  if (!Array.isArray(value) || !value.length || value.length > 12) return false;
  const ids = new Set<string>();
  for (const tier of value) {
    if (!record(tier) || typeof tier.id !== 'string' || !SAFE_TIER.test(tier.id) || ids.has(tier.id)
      || typeof tier.enabled !== 'boolean' || !Number.isSafeInteger(tier.rank) || tier.rank < 1 || tier.rank > 100
      || !Number.isSafeInteger(tier.monthlyVerifiedSalesThreshold) || tier.monthlyVerifiedSalesThreshold < 0
      || tier.monthlyVerifiedSalesThreshold > 1_000_000 || typeof tier.proposedCommissionRate !== 'number'
      || !Number.isFinite(tier.proposedCommissionRate) || tier.proposedCommissionRate <= 0 || tier.proposedCommissionRate > 100) return false;
    ids.add(tier.id);
  }
  return value.some(tier => tier.id === defaultId && tier.enabled);
}

/** Validate qualification-critical fields before legacy normalization can invent
 * defaults, discard corrupt history, coerce thresholds or clamp unknown values. */
function effectivePolicy(value: unknown, now: string): LiteraryCircleSettings | null {
  const nowMs = time(now);
  if (nowMs === null || !record(value) || value.schemaVersion !== 1 || value.enabled !== true
    || !Number.isSafeInteger(value.revision) || value.revision < 0
    || value.qualificationTimezone !== 'Africa/Nairobi' || !validTiers(value.tiers, value.defaultTierId)
    || value.qualificationEffectiveFrom !== undefined && time(value.qualificationEffectiveFrom) === null
    || value.updatedAt !== undefined && (time(value.updatedAt) === null || time(value.updatedAt)! > nowMs)
    || !record(value.commissionPolicy)) return null;
  const current = value.commissionPolicy;
  if (!['active', 'draft'].includes(current.status) || !Number.isSafeInteger(current.version)
    || current.version < 1 || current.version > 1_000_000 || typeof current.subscriptionRenewalsEligible !== 'boolean'
    || current.effectiveAt !== undefined && time(current.effectiveAt) === null
    || current.status === 'active' && time(current.effectiveAt) === null) return null;
  if (value.commissionPolicyHistory !== undefined) {
    if (!Array.isArray(value.commissionPolicyHistory) || value.commissionPolicyHistory.length > 256) return null;
    const versions = new Set<number>();
    for (const snapshot of value.commissionPolicyHistory) {
      if (!record(snapshot) || !Number.isSafeInteger(snapshot.version) || snapshot.version < 1 || snapshot.version > 1_000_000
        || snapshot.version > current.version
        || versions.has(snapshot.version) || !['active', 'draft'].includes(snapshot.status)
        || time(snapshot.effectiveAt) === null || time(snapshot.confirmedAt) === null || time(snapshot.confirmedAt)! > nowMs
        || typeof snapshot.confirmedBy !== 'string' || !snapshot.confirmedBy.trim()
        || typeof snapshot.subscriptionRenewalsEligible !== 'boolean' || !validTiers(snapshot.tiers, snapshot.defaultTierId)
        || snapshot.qualificationEffectiveFrom !== undefined && time(snapshot.qualificationEffectiveFrom) === null) return null;
      versions.add(snapshot.version);
    }
  }
  const settings = resolveLiteraryCircleSettingsForTransaction(value, now);
  const effectiveAt = time(settings.commissionPolicy.effectiveAt);
  return settings.enabled && settings.commissionPolicy.status === 'active' && effectiveAt !== null && effectiveAt <= nowMs
    && validTiers(settings.tiers, settings.defaultTierId) ? settings : null;
}

function automatic(affiliate: AffiliatePublicProfile, now: string): boolean {
  const membership = affiliate.literaryCircle;
  const assignedAt = time(membership?.tier?.assignedAt);
  return membership?.schemaVersion === 1 && ['default', 'monthly_performance'].includes(membership.tier?.source)
    && typeof membership.tier.id === 'string' && SAFE_TIER.test(membership.tier.id)
    && assignedAt !== null && assignedAt <= time(now)!;
}

/** Exact complete current-period snapshots only. Missing, corrupt, previous-
 * month or future-dated evidence is held for review, never treated as zero.
 * This pure projection does not bootstrap, update tiers or scan commissions. */
export function verifiedAffiliateNotificationMonthlyTiers(input: {
  affiliates: AffiliatePublicProfile[];
  settings: unknown;
  periods: ReadonlyMap<string, unknown>;
  now: string;
}): VerifiedAffiliateNotificationMonthlyTiers {
  const result: VerifiedAffiliateNotificationMonthlyTiers = Object.create(null);
  const settings = effectivePolicy(input.settings, input.now);
  if (!settings || !Array.isArray(input.affiliates) || input.affiliates.length > MAX_RECIPIENTS) return result;
  const seen = new Set<string>();
  for (const affiliate of input.affiliates) {
    if (!affiliate || typeof affiliate.id !== 'string' || !SAFE_ID.test(affiliate.id) || seen.has(affiliate.id)) return Object.create(null);
    seen.add(affiliate.id);
  }
  const periodKey = literaryCirclePeriodKey(input.now);
  for (const affiliate of input.affiliates) {
    if (!automatic(affiliate, input.now)) continue;
    const period = input.periods.get(affiliate.id);
    if (!record(period) || period.affiliateId !== affiliate.id || period.periodKey !== periodKey) continue;
    try {
      const monthlySales = countAffiliateTierPeriodSales(period as AffiliateTierPeriod, settings.qualificationEffectiveFrom, input.now);
      if (period.members.some((member: { createdAt: string }) => Date.parse(member.createdAt) > Date.parse(input.now))) continue;
      const tier = resolveLiteraryCircleTier(settings, monthlySales);
      result[affiliate.id] = {
        tierId: tier.id,
        evidenceSha256: crypto.createHash('sha256').update(canonical({
          schemaVersion: 1, affiliateId: affiliate.id, periodKey, period,
          settingsRevision: settings.revision, qualificationTimezone: settings.qualificationTimezone,
          defaultTierId: settings.defaultTierId, qualificationEffectiveFrom: settings.qualificationEffectiveFrom,
          tiers: settings.tiers, policy: settings.commissionPolicy,
          assignment: affiliate.literaryCircle!.tier,
        })).digest('hex'),
      };
    } catch { /* Complete canonical evidence is required; do not repair it here. */ }
  }
  return result;
}

/** Caller must supply affiliate and settings snapshots freshly read in this
 * same transaction. At most one exact document per automatic affiliate is read.
 * Missing summaries stay held; no history query or financial mutation exists. */
export async function readVerifiedAffiliateNotificationMonthlyTiers(input: {
  db: Firestore; transaction: Transaction; affiliates: AffiliatePublicProfile[]; settings: unknown; now: string;
}): Promise<VerifiedAffiliateNotificationMonthlyTiers> {
  const empty = (): VerifiedAffiliateNotificationMonthlyTiers => Object.create(null);
  if (!effectivePolicy(input.settings, input.now) || !Array.isArray(input.affiliates)
    || input.affiliates.length > MAX_RECIPIENTS) return empty();
  const ids = new Set<string>();
  for (const affiliate of input.affiliates) {
    if (!affiliate || typeof affiliate.id !== 'string' || !SAFE_ID.test(affiliate.id) || ids.has(affiliate.id)) return empty();
    ids.add(affiliate.id);
  }
  const automaticAffiliates = input.affiliates.filter(affiliate => automatic(affiliate, input.now));
  if (!automaticAffiliates.length) return empty();
  const periodKey = literaryCirclePeriodKey(input.now);
  const refs = automaticAffiliates.map(affiliate => input.db.collection(AFFILIATE_TIER_PERIOD_COLLECTION)
    .doc(affiliateTierPeriodDocumentId(affiliate.id, periodKey)));
  const snapshots = await input.transaction.getAll(...refs);
  const byPath = new Map(snapshots.map(snapshot => [snapshot.ref.path, snapshot]));
  const periods = new Map<string, unknown>();
  refs.forEach((ref, index) => {
    const snapshot = byPath.get(ref.path);
    if (snapshot?.exists) periods.set(automaticAffiliates[index].id, snapshot.data());
  });
  return verifiedAffiliateNotificationMonthlyTiers({ ...input, periods });
}

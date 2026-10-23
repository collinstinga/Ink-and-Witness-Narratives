import crypto from 'crypto';
import type {
  AffiliateAccount,
  AffiliateSaleCommission,
  LiteraryCircleSettings,
  LiteraryCircleTierDefinition,
  LiteraryCircleTierTransition,
} from '../types.js';
import { literaryCirclePeriodKey, resolveLiteraryCircleTier } from './literaryCircle.js';

/** Bound the evidence and the backing-payment reads required by a later adapter. */
export const MAX_TIER_TRANSITION_PRIOR_COMMISSIONS = 100;
const MAX_COMMISSION_HISTORY = 10_000;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_TIER_ID = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;
const VERIFIED_STATUSES = new Set(['PENDING', 'APPROVED', 'PAID']);

interface TransitionInput {
  commission: AffiliateSaleCommission;
  affiliate: AffiliateAccount;
  /** The effective-dated policy selected for this commission, not today's policy. */
  settings: LiteraryCircleSettings;
  /** Complete bounded history for creation; exact supporting rows for validation. */
  history: AffiliateSaleCommission[];
  monthlyVerifiedSalesAfter: number;
  historyComplete: boolean;
  paymentType: string;
}

function canonicalTime(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    && new Date(milliseconds).toISOString() === value ? milliseconds : undefined;
}

function positiveAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1_000_000;
}

function canonicalCommission(commission: AffiliateSaleCommission, affiliate: AffiliateAccount): boolean {
  const checkout = commission.checkoutRequestId;
  return typeof checkout === 'string' && SAFE_ID.test(checkout)
    && commission.id === `com_tx_${crypto.createHash('sha256').update(checkout).digest('hex').slice(0, 40)}`
    && commission.affiliateId === affiliate.id
    && typeof commission.affiliateCode === 'string' && Boolean(commission.affiliateCode.trim())
    && commission.affiliateCode.trim().toUpperCase() === affiliate.affiliateCode.trim().toUpperCase()
    && canonicalTime(commission.createdAt) !== undefined;
}

function validVerifiedCommission(commission: AffiliateSaleCommission): boolean {
  return VERIFIED_STATUSES.has(commission.status) && !commission.fraudFlag?.flagged
    && positiveAmount(commission.saleAmountKes) && positiveAmount(commission.commissionAmountKes)
    && commission.commissionAmountKes <= commission.saleAmountKes
    && typeof commission.commissionRate === 'number' && Number.isFinite(commission.commissionRate)
    && commission.commissionRate > 0 && commission.commissionRate <= 100;
}

function validPolicy(settings: LiteraryCircleSettings, occurredAt: number): boolean {
  const effectiveAt = canonicalTime(settings.commissionPolicy?.effectiveAt);
  if (settings.enabled !== true || settings.commissionPolicy?.status !== 'active'
    || !Number.isSafeInteger(settings.commissionPolicy.version) || settings.commissionPolicy.version < 1
    || settings.commissionPolicy.version > 1_000_000 || effectiveAt === undefined || effectiveAt > occurredAt
    || settings.qualificationTimezone !== 'Africa/Nairobi'
    || !Array.isArray(settings.tiers) || settings.tiers.length < 1 || settings.tiers.length > 12) return false;
  if (settings.qualificationEffectiveFrom !== undefined
    && (canonicalTime(settings.qualificationEffectiveFrom) === undefined
      || canonicalTime(settings.qualificationEffectiveFrom)! > occurredAt)) return false;
  const ids = new Set<string>();
  const ranks = new Set<number>();
  const thresholds = new Set<number>();
  for (const tier of settings.tiers) {
    if (!tier || !SAFE_TIER_ID.test(tier.id) || ids.has(tier.id)
      || typeof tier.enabled !== 'boolean' || !Number.isSafeInteger(tier.rank) || tier.rank < 1 || tier.rank > 100
      || !Number.isSafeInteger(tier.monthlyVerifiedSalesThreshold) || tier.monthlyVerifiedSalesThreshold < 0
      || tier.monthlyVerifiedSalesThreshold > 1_000_000
      || typeof tier.proposedCommissionRate !== 'number' || !Number.isFinite(tier.proposedCommissionRate)
      || tier.proposedCommissionRate <= 0 || tier.proposedCommissionRate > 100) return false;
    ids.add(tier.id);
    if (tier.enabled) {
      if (ranks.has(tier.rank) || thresholds.has(tier.monthlyVerifiedSalesThreshold)) return false;
      ranks.add(tier.rank);
      thresholds.add(tier.monthlyVerifiedSalesThreshold);
    }
  }
  return settings.tiers.some(tier => tier.enabled && tier.id === settings.defaultTierId);
}

/**
 * Additive evidence only: never changes membership, rates, commissions, or balances.
 * Backing payments are deliberately verified by the committed-source adapter.
 * Malformed or incomplete evidence is omitted rather than risking settlement.
 */
export function buildLiteraryCircleTierTransition(input: TransitionInput): LiteraryCircleTierTransition | undefined {
  try {
    const { commission, affiliate, settings, history } = input;
    if (input.paymentType !== 'PURCHASE' || input.historyComplete !== true
      || !Array.isArray(history) || history.length >= MAX_COMMISSION_HISTORY
      || !affiliate || affiliate.status !== 'active' || typeof affiliate.id !== 'string' || !SAFE_ID.test(affiliate.id)
      || typeof affiliate.affiliateCode !== 'string' || !affiliate.affiliateCode.trim()
      || affiliate.literaryCircle?.schemaVersion !== 1
      || !['default', 'monthly_performance'].includes(affiliate.literaryCircle.tier.source)
      || !canonicalCommission(commission, affiliate) || !validVerifiedCommission(commission)
      || commission.commissionRateSource !== 'literary_circle_tier'
      || !Number.isSafeInteger(input.monthlyVerifiedSalesAfter) || input.monthlyVerifiedSalesAfter < 1) return undefined;
    const occurredAt = canonicalTime(commission.createdAt)!;
    if (!validPolicy(settings, occurredAt)
      || commission.literaryCirclePolicyVersion !== settings.commissionPolicy.version) return undefined;
    const periodKey = literaryCirclePeriodKey(commission.createdAt);
    const qualificationStartsAt = settings.qualificationEffectiveFrom
      ? canonicalTime(settings.qualificationEffectiveFrom)! : 0;
    const qualifying: AffiliateSaleCommission[] = [];
    const checkoutIds = new Set([commission.checkoutRequestId!]);
    const documentIds = new Set([commission.id]);
    for (const prior of history) {
      if (!prior) return undefined;
      const priorTime = typeof prior.createdAt === 'string' ? Date.parse(prior.createdAt) : NaN;
      // Old legacy rows outside the qualification window do not contribute to
      // the existing count and must not disable every future monthly milestone.
      if (!Number.isFinite(priorTime) || literaryCirclePeriodKey(prior.createdAt) !== periodKey
        || priorTime < qualificationStartsAt || !VERIFIED_STATUSES.has(prior.status)) continue;
      if (!canonicalCommission(prior, affiliate)
        || documentIds.has(prior.id) || checkoutIds.has(prior.checkoutRequestId!)
        || canonicalTime(prior.createdAt)! > occurredAt) return undefined;
      documentIds.add(prior.id);
      checkoutIds.add(prior.checkoutRequestId!);
      if (!validVerifiedCommission(prior)) return undefined;
      qualifying.push(prior);
    }
    if (qualifying.length > MAX_TIER_TRANSITION_PRIOR_COMMISSIONS
      || input.monthlyVerifiedSalesAfter !== qualifying.length + 1) return undefined;
    const from: LiteraryCircleTierDefinition = resolveLiteraryCircleTier(settings, qualifying.length);
    const to: LiteraryCircleTierDefinition = resolveLiteraryCircleTier(settings, qualifying.length + 1);
    if (from.id === to.id || to.rank <= from.rank
      || to.monthlyVerifiedSalesThreshold <= from.monthlyVerifiedSalesThreshold
      || qualifying.length >= to.monthlyVerifiedSalesThreshold
      || qualifying.length + 1 < to.monthlyVerifiedSalesThreshold
      || commission.literaryCircleTierId !== to.id
      || commission.commissionRate !== to.proposedCommissionRate
      || commission.commissionAmountKes !== Math.round(commission.saleAmountKes * commission.commissionRate / 100)
      || history.some(prior => prior.literaryCircleTierTransition?.periodKey === periodKey
        && prior.literaryCircleTierTransition.policyVersion === settings.commissionPolicy.version
        && prior.literaryCircleTierTransition.toTierId === to.id)) return undefined;
    return {
      schemaVersion: 1,
      periodKey,
      policyVersion: settings.commissionPolicy.version,
      fromTierId: from.id,
      toTierId: to.id,
      fromRank: from.rank,
      toRank: to.rank,
      threshold: to.monthlyVerifiedSalesThreshold,
      verifiedSalesBefore: qualifying.length,
      verifiedSalesAfter: qualifying.length + 1,
      occurredAt: commission.createdAt,
      qualifyingCommissionIds: qualifying.map(prior => prior.id).sort(),
    };
  } catch {
    return undefined;
  }
}

/** Reconstruct and compare every field; unknown fields and changed evidence fail closed. */
export function validateStoredLiteraryCircleTierTransition(input: Omit<TransitionInput,
  'monthlyVerifiedSalesAfter' | 'historyComplete'>): boolean {
  try {
    const stored = input.commission.literaryCircleTierTransition;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return false;
    const rebuilt = buildLiteraryCircleTierTransition({
      ...input,
      historyComplete: true,
      monthlyVerifiedSalesAfter: stored.verifiedSalesAfter,
    });
    if (!rebuilt || Object.keys(stored).length !== Object.keys(rebuilt).length) return false;
    return Object.entries(rebuilt).every(([key, value]) => {
      const actual = stored[key as keyof LiteraryCircleTierTransition];
      return Array.isArray(value)
        ? Array.isArray(actual) && actual.length === value.length && value.every((id, index) => actual[index] === id)
        : actual === value;
    });
  } catch {
    return false;
  }
}

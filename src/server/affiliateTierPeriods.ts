import crypto from 'crypto';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import type { AffiliateAccount, AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import { literaryCirclePeriodKey } from './literaryCircle.js';

export const AFFILIATE_TIER_PERIOD_COLLECTION = 'affiliate_tier_periods';
export const MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS = 400;
export const MAX_TIER_PERIOD_SALES = 2_000;
export const MAX_TIER_PERIOD_BYTES = 700_000;
const MAX_AWARDED_MILESTONES = 1_024;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const VERIFIED = new Set(['PENDING', 'APPROVED', 'PAID']);

export class AffiliateTierPeriodReviewError extends Error {
  constructor() {
    super('Monthly affiliate qualification evidence needs writer review. No commission or wallet changes were committed.');
    this.name = 'AffiliateTierPeriodReviewError';
  }
}
function review(): never { throw new AffiliateTierPeriodReviewError(); }
function canonicalTime(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time > 0 && new Date(time).toISOString() === value;
}
function commissionId(checkout: string): string {
  return `com_tx_${crypto.createHash('sha256').update(checkout).digest('hex').slice(0, 40)}`;
}

interface PeriodMember { id: string; checkoutRequestId: string; createdAt: string }
export interface AffiliateTierPeriod {
  schemaVersion: 1;
  affiliateId: string;
  periodKey: string;
  revision: number;
  evidenceComplete: true;
  members: PeriodMember[];
  awardedMilestones: string[];
}
export interface TierPeriodMutation { ref: DocumentReference; period: AffiliateTierPeriod }

export function affiliateTierPeriodDocumentId(affiliateId: string, periodKey: string): string {
  if (!SAFE_ID.test(affiliateId) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) review();
  return `atp1_${crypto.createHash('sha256').update(JSON.stringify([affiliateId, periodKey])).digest('hex')}`;
}

/** Nairobi has no DST. Query the UTC range corresponding to its calendar month. */
export function affiliateTierPeriodBounds(periodKey: string): { start: string; end: string } {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodKey)) review();
  const [year, month] = periodKey.split('-').map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1) - 3 * 3_600_000).toISOString(),
    end: new Date(Date.UTC(year, month, 1) - 3 * 3_600_000).toISOString() };
}

function assertPeriod(period: AffiliateTierPeriod, affiliateId: string, periodKey: string): void {
  if (!period || period.schemaVersion !== 1 || period.affiliateId !== affiliateId || period.periodKey !== periodKey
    || period.evidenceComplete !== true || !Number.isSafeInteger(period.revision) || period.revision < 1 || period.revision >= 1_000_000_000
    || !Array.isArray(period.members) || period.members.length > MAX_TIER_PERIOD_SALES
    || !Array.isArray(period.awardedMilestones) || period.awardedMilestones.length > MAX_AWARDED_MILESTONES
    || Object.keys(period).some(key => !['schemaVersion', 'affiliateId', 'periodKey', 'revision', 'evidenceComplete', 'members', 'awardedMilestones'].includes(key))
    || new Set(period.awardedMilestones).size !== period.awardedMilestones.length
    || period.awardedMilestones.some(key => typeof key !== 'string' || !/^\d{1,7}:[a-z0-9][a-z0-9_-]{0,63}$/.test(key))) review();
  const ids = new Set<string>();
  const checkouts = new Set<string>();
  for (const member of period.members) {
    if (!member || typeof member.checkoutRequestId !== 'string' || !SAFE_ID.test(member.checkoutRequestId)
      || member.id !== commissionId(member.checkoutRequestId) || !canonicalTime(member.createdAt)
      || literaryCirclePeriodKey(member.createdAt) !== periodKey || ids.has(member.id) || checkouts.has(member.checkoutRequestId)
      || Object.keys(member).some(key => !['id', 'checkoutRequestId', 'createdAt'].includes(key))) review();
    ids.add(member.id); checkouts.add(member.checkoutRequestId);
  }
  if (Buffer.byteLength(JSON.stringify(period), 'utf8') > MAX_TIER_PERIOD_BYTES) review();
}

export function countAffiliateTierPeriodSales(period: AffiliateTierPeriod, qualificationEffectiveFrom?: string, asOf?: string): number {
  assertPeriod(period, period.affiliateId, period.periodKey);
  if (qualificationEffectiveFrom !== undefined && !canonicalTime(qualificationEffectiveFrom)) review();
  if (asOf !== undefined && !canonicalTime(asOf)) review();
  const start = qualificationEffectiveFrom ? Date.parse(qualificationEffectiveFrom) : -Infinity;
  const end = asOf ? Date.parse(asOf) : Infinity;
  return period.members.filter(member => Date.parse(member.createdAt) >= start && Date.parse(member.createdAt) <= end).length;
}

function matchesPayment(commission: AffiliateSaleCommission, payment: PaymentTransaction, affiliate: AffiliateAccount): boolean {
  const selectedTime = [payment.confirmedAt, payment.settledAt, payment.completedAt, payment.createdAt]
    .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  const receipt = payment.mpesaReceiptNumber || payment.bankReference || `CHECKOUT-${payment.checkoutRequestId || payment.id}`;
  return typeof commission.checkoutRequestId === 'string' && SAFE_ID.test(commission.checkoutRequestId)
    && commission.id === commissionId(commission.checkoutRequestId)
    && commission.affiliateId === affiliate.id && commission.affiliateCode?.trim().toUpperCase() === affiliate.affiliateCode.trim().toUpperCase()
    && canonicalTime(commission.createdAt) && selectedTime === commission.createdAt
    && ['CONFIRMED', 'SUCCESS', 'PAID'].includes(payment.status) && ['PURCHASE', 'TIP'].includes(payment.type)
    && ['mpesa', 'bank'].includes(payment.paymentMethod || '')
    && (payment.paymentMethod || 'mpesa') === commission.paymentMethod
    && payment.checkoutRequestId === commission.checkoutRequestId && payment.id === commission.transactionId
    && payment.articleId === commission.articleId && payment.amount === commission.saleAmountKes
    && payment.affiliateCode?.trim().toUpperCase() === affiliate.affiliateCode.trim().toUpperCase()
    && ['piece', 'bundle', 'subscription'].includes(payment.purchaseKind || 'piece')
    && (payment.purchaseKind || 'piece') === (commission.purchaseKind || 'piece')
    && (payment.purchaseKind !== 'subscription' || typeof payment.subscriptionPlanId === 'string' && SAFE_ID.test(payment.subscriptionPlanId)
      && payment.subscriptionPlanId === commission.subscriptionPlanId
      && typeof payment.subscriptionRenewal === 'boolean' && payment.subscriptionRenewal === commission.subscriptionRenewal)
    && typeof receipt === 'string' && receipt.length > 0 && receipt.length <= 256 && receipt === commission.receiptNumber
    && typeof commission.saleAmountKes === 'number' && Number.isFinite(commission.saleAmountKes)
    && commission.saleAmountKes > 0 && commission.saleAmountKes <= 1_000_000
    && typeof commission.commissionAmountKes === 'number' && Number.isFinite(commission.commissionAmountKes)
    && commission.commissionAmountKes >= 0 && commission.commissionAmountKes <= commission.saleAmountKes
    && typeof commission.commissionRate === 'number' && Number.isFinite(commission.commissionRate)
    && commission.commissionRate >= 0 && commission.commissionRate <= 100;
}

/** Reads only. Caller commits the returned document with the sale, after all reads. */
export async function readAffiliateTierPeriodForSale(input: {
  db: Firestore; transaction: Transaction; affiliate: AffiliateAccount; transactionAt: string;
  /** Bootstrap only when an explicitly approved automatic tier rate needs it. */
  initialize: boolean;
}): Promise<TierPeriodMutation | undefined> {
  if (!canonicalTime(input.transactionAt)) review();
  const periodKey = literaryCirclePeriodKey(input.transactionAt);
  const ref = input.db.collection(AFFILIATE_TIER_PERIOD_COLLECTION).doc(affiliateTierPeriodDocumentId(input.affiliate.id, periodKey));
  const snapshot = await input.transaction.get(ref);
  if (snapshot.exists) {
    const period = snapshot.data() as AffiliateTierPeriod;
    assertPeriod(period, input.affiliate.id, periodKey);
    return { ref, period };
  }
  if (!input.initialize) return undefined;
  const bounds = affiliateTierPeriodBounds(periodKey);
  const query = input.db.collection('affiliate_commissions').where('affiliateId', '==', input.affiliate.id)
    .where('createdAt', '>=', bounds.start).where('createdAt', '<', bounds.end)
    .limit(MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS + 1);
  const history = await input.transaction.get(query);
  if (history.docs.length > MAX_TIER_PERIOD_BOOTSTRAP_COMMISSIONS) review();
  const period: AffiliateTierPeriod = { schemaVersion: 1, affiliateId: input.affiliate.id, periodKey,
    revision: 1, evidenceComplete: true, members: [], awardedMilestones: [] };
  for (const document of history.docs) {
    const commission = document.data() as AffiliateSaleCommission;
    if (commission.id !== document.id || !canonicalTime(commission.createdAt)
      || literaryCirclePeriodKey(commission.createdAt) !== periodKey
      || !['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'].includes(commission.status)) review();
    // Recognition is permanent even when a later refund removes qualification.
    const milestone = commission.literaryCircleTierTransition;
    if (milestone?.periodKey === periodKey) {
      const key = `${milestone.policyVersion}:${milestone.toTierId}`;
      if (!period.awardedMilestones.includes(key)) period.awardedMilestones.push(key);
    }
    // Reversed, rejected and flagged records never contribute to qualification.
    if (!VERIFIED.has(commission.status) || commission.fraudFlag?.flagged) continue;
    if (typeof commission.checkoutRequestId !== 'string' || !SAFE_ID.test(commission.checkoutRequestId)) review();
    const paymentSnapshot = await input.transaction.get(input.db.collection('transactions').doc(commission.checkoutRequestId));
    const payment = paymentSnapshot.data() as PaymentTransaction;
    if (!paymentSnapshot.exists || !matchesPayment(commission, payment, input.affiliate)) review();
    if (payment.type !== 'PURCHASE') continue;
    period.members.push({ id: commission.id, checkoutRequestId: commission.checkoutRequestId, createdAt: commission.createdAt });
  }
  period.members.sort((a, b) => a.id.localeCompare(b.id));
  assertPeriod(period, input.affiliate.id, periodKey);
  return { ref, period };
}

export async function validateAffiliateTierPeriodPayment(input: {
  db: Firestore; transaction: Transaction; affiliate: AffiliateAccount; commission: AffiliateSaleCommission;
  paymentType: PaymentTransaction['type'];
}): Promise<boolean> {
  const checkout = input.commission.checkoutRequestId;
  if (typeof checkout !== 'string' || !SAFE_ID.test(checkout)) review();
  const snapshot = await input.transaction.get(input.db.collection('transactions').doc(checkout));
  const payment = snapshot.data() as PaymentTransaction;
  if (!snapshot.exists || payment.type !== input.paymentType || !matchesPayment(input.commission, payment, input.affiliate)) review();
  return payment.type === 'PURCHASE';
}

export function appendAffiliateTierPeriodSale(mutation: TierPeriodMutation, commission: AffiliateSaleCommission): AffiliateTierPeriod {
  const period = structuredClone(mutation.period);
  if (!commission.checkoutRequestId || commission.affiliateId !== period.affiliateId
    || literaryCirclePeriodKey(commission.createdAt) !== period.periodKey
    || period.members.some(member => member.id === commission.id || member.checkoutRequestId === commission.checkoutRequestId)) review();
  period.members.push({ id: commission.id, checkoutRequestId: commission.checkoutRequestId, createdAt: commission.createdAt });
  period.members.sort((a, b) => a.id.localeCompare(b.id));
  const milestone = commission.literaryCircleTierTransition;
  if (milestone) {
    const key = `${milestone.policyVersion}:${milestone.toTierId}`;
    if (period.awardedMilestones.includes(key)) review();
    period.awardedMilestones.push(key);
  }
  period.revision += 1;
  assertPeriod(period, period.affiliateId, period.periodKey);
  return period;
}

/** Missing summaries stay missing; a later bootstrap sees the reversed row. */
export async function readAffiliateTierPeriodReversal(input: {
  db: Firestore; transaction: Transaction; commission: AffiliateSaleCommission;
}): Promise<TierPeriodMutation | undefined> {
  if (!canonicalTime(input.commission.createdAt)) return undefined;
  const periodKey = literaryCirclePeriodKey(input.commission.createdAt);
  const ref = input.db.collection(AFFILIATE_TIER_PERIOD_COLLECTION).doc(affiliateTierPeriodDocumentId(input.commission.affiliateId, periodKey));
  const snapshot = await input.transaction.get(ref);
  if (!snapshot.exists) return undefined;
  const period = snapshot.data() as AffiliateTierPeriod;
  assertPeriod(period, input.commission.affiliateId, periodKey);
  const member = period.members.find(item => item.id === input.commission.id);
  if (!member) return undefined;
  if (member.checkoutRequestId !== input.commission.checkoutRequestId || member.createdAt !== input.commission.createdAt) review();
  const next = { ...period, revision: period.revision + 1, members: period.members.filter(item => item.id !== member.id) };
  assertPeriod(next, next.affiliateId, next.periodKey);
  return { ref, period: next };
}

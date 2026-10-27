import crypto from 'crypto';
import type { Firestore, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { getFirestoreClientTarget } from './db.js';
import { firestoreSnapshotReadTimeMillis } from './affiliateClickLedger.js';

/** Separate, additive accounting. These functions never issue a provider refund,
 * rewrite a commission/payout/payment, or change a reader entitlement. */
export const AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS = Object.freeze({
  entries: 'affiliate_financial_adjustments',
  summaries: 'affiliate_financial_adjustment_summaries',
  claims: 'affiliate_financial_adjustment_claims',
  audits: 'affiliate_audit',
});
export const AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS = Object.freeze({ payouts: 1_000, overview: 500, amountKes: 1_000_000 });
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HASH = /^[a-f0-9]{64}$/;
const ENTRY_ID = /^afa1_[a-f0-9]{64}$/;
const MAX_REVISION = 1_000_000_000;

export class AffiliateFinancialAdjustmentError extends Error {
  constructor(message: string, readonly statusCode = 400, readonly code = 'AFFILIATE_ADJUSTMENT_INVALID') {
    super(message); this.name = 'AffiliateFinancialAdjustmentError';
  }
}
function invalid(message: string): never { throw new AffiliateFinancialAdjustmentError(message); }
function review(message = 'Financial evidence needs writer reconciliation; no history was changed.'): never {
  throw new AffiliateFinancialAdjustmentError(message, 409, 'AFFILIATE_ADJUSTMENT_REVIEW_REQUIRED');
}
function conflict(): never {
  throw new AffiliateFinancialAdjustmentError('Financial adjustment changed. Refresh and review before submitting again.', 409, 'AFFILIATE_ADJUSTMENT_CONFLICT');
}
function unavailable(): never {
  throw new AffiliateFinancialAdjustmentError('Financial adjustment records are unavailable. No local fallback or provider operation was used.', 503, 'AFFILIATE_ADJUSTMENT_UNAVAILABLE');
}
function object(value: unknown): value is Record<string, any> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}
function hash(value: unknown): string { return crypto.createHash('sha256').update(canonical(value)).digest('hex'); }
function text(value: unknown, label: string, maximum = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)) invalid(`${label} must be non-empty plain text.`);
  return value;
}
function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !ID.test(value)) invalid(`A valid ${label} is required.`);
  return value;
}
function revision(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= MAX_REVISION) review('Financial adjustment revision needs review.');
  return Number(value);
}
/** All stored cost/refund arithmetic is integer cents. Existing commission
 * wallets use whole KES; their cumulative proportional debit is rounded ONCE. */
function minor(value: unknown, allowZero = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (allowZero ? 0 : 0.01) || value > AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.amountKes) invalid('Amount must be a finite KES value with at most two decimal places.');
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents / 100 !== value) invalid('Amount must have at most two decimal places.');
  return cents;
}
function storedMinor(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000) review();
  return Number(value);
}
function integerKes(value: unknown, optional = false): number {
  if (value === undefined && optional) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000_000) review();
  return Number(value);
}
function iso(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }

export interface AffiliateFinancialAdjustmentContext {
  db: Firestore;
  expectedProjectId: string;
  expectedDatabaseId: string;
  /** Trusted authenticated writer identity; never accept this from the body. */
  actor: string;
  /** Internal test dependency only; HTTP callers must not choose the clock. */
  clock?: () => Date;
}
function guard(context: AffiliateFinancialAdjustmentContext): string {
  const target = getFirestoreClientTarget(context.db);
  if (!/^[a-z][a-z0-9-]{4,29}[a-z0-9]$/.test(context.expectedProjectId)
    || context.expectedDatabaseId !== '(default)' || !target
    || target.projectId !== context.expectedProjectId || target.firestoreDatabaseId !== context.expectedDatabaseId
    || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIREBASE_DATABASE_EMULATOR_HOST) {
    throw new AffiliateFinancialAdjustmentError('The financial service is not bound to the reviewed database.', 503, 'AFFILIATE_ADJUSTMENT_TARGET_MISMATCH');
  }
  text(context.actor, 'Authenticated writer', 200);
  const now = (context.clock || (() => new Date()))();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) unavailable();
  return now.toISOString();
}

export type AffiliateFinancialAdjustmentKind = 'refund' | 'refund_correction' | 'direct_cost' | 'cost_correction';
type EntryKind = AffiliateFinancialAdjustmentKind;
export interface AffiliateFinancialAdjustmentCommonRequest {
  expectedRevision: number; idempotencyKey: string; confirmationReference: string; currency: 'KES'; confirmedByWriter: true;
}
type CommonRequest = AffiliateFinancialAdjustmentCommonRequest;
export interface AffiliateRefundAdjustmentRequest extends CommonRequest {
  commissionId: string; refundedAmountKes: number; reason: 'refund' | 'chargeback';
}
export interface AffiliateDirectCostRequest extends CommonRequest {
  transactionId: string; amountKes: number; category: 'payment_fee' | 'other';
}
export interface AffiliateFinancialAdjustmentCorrectionRequest extends CommonRequest { entryId: string }
function common(body: unknown, fields: string[]): CommonRequest & Record<string, any> {
  const keys = ['expectedRevision', 'idempotencyKey', 'confirmationReference', 'currency', 'confirmedByWriter', ...fields];
  if (!object(body) || Object.keys(body).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(body, key))) invalid('Submit the explicit reviewed financial adjustment fields only.');
  if (body.confirmedByWriter !== true || body.currency !== 'KES') invalid('An explicit writer confirmation in KES is required.');
  if (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(body.idempotencyKey)) invalid('A fresh stable idempotency key is required.');
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision >= MAX_REVISION) invalid('An explicit current revision is required.');
  const confirmationReference = text(body.confirmationReference, 'External confirmation reference', 128).toUpperCase();
  if (confirmationReference.length < 4) invalid('Enter the actual external confirmation reference.');
  return { ...body, confirmationReference } as CommonRequest & Record<string, any>;
}

interface WalletState { schemaVersion: 1; kind: 'affiliate'; affiliateId: string; revision: number; walletDeltaKes: number; refundedMinor: number; adjustmentCount: number }
interface RefundState { schemaVersion: 1; kind: 'commission'; commissionId: string; affiliateId: string; transactionId: string; checkoutRequestId: string; refundedMinor: number; debitKes: number; revision: number }
interface CostState { schemaVersion: 1; kind: 'transaction'; transactionId: string; checkoutRequestId: string; knownCostsMinor: number; revision: number; costCount: number }
export interface AffiliateAdjustmentWalletSummary {
  revision: number; walletDeltaKes: number; refundAmountKes: number; adjustmentCount: number;
  negativeBalancePolicy: 'offset_future_available_balance';
}
export interface AffiliateDirectCostSummary { revision: number; knownDirectCostsKes: number; costCount: number }
export interface AffiliateFinancialAdjustmentOverview {
  currency: 'KES'; asOf: string; recordedRefundAmountKes: number; refundedPurchaseKes: number; commissionClawbackKes: number;
  walletDeltas: Array<{ affiliateId: string; walletDeltaKes: number }>;
  purchaseAdjustments: Array<{ transactionId: string; refundedPurchaseKes: number; commissionClawbackKes: number }>;
  directCosts: Array<{ transactionId: string; knownDirectCostsKes: number }>;
  entries: Array<{ entryId: string; kind: EntryKind; transactionId: string; affiliateId?: string; commissionId?: string;
    amountKes: number; walletDeltaKes: number; createdAt: string; summaryRevision: number; supersedesEntryId?: string;
    reason?: 'refund' | 'chargeback'; category?: 'payment_fee' | 'other' }>;
  costCoverage: 'known_recorded_costs_only'; netProfitClaimed: false;
  directCostScope: 'unavailable_for_affiliate_filter' | 'all_recorded_transactions';
  providerOperationPerformed: false; accessPermissionsChanged: false;
}

/** Safe immutable-evidence projection. The caller owns the snapshot boundary. */
export interface AffiliateRefundQualificationEvidence { commissionId: string; refundedPurchaseKes: number }
function walletState(value: unknown, affiliateId: string): WalletState {
  if (value === undefined) return { schemaVersion: 1, kind: 'affiliate', affiliateId, revision: 0, walletDeltaKes: 0, refundedMinor: 0, adjustmentCount: 0 };
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'affiliate' || value.affiliateId !== affiliateId
    || !Number.isSafeInteger(value.walletDeltaKes) || value.walletDeltaKes > 0 || value.walletDeltaKes < -1_000_000_000_000) review();
  revision(value.revision); storedMinorAggregate(value.refundedMinor); revision(value.adjustmentCount);
  return value as WalletState;
}
function storedMinorAggregate(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_000_000) review();
  return Number(value);
}
function costState(value: unknown, transactionId: string, checkoutRequestId: string): CostState {
  if (value === undefined) return { schemaVersion: 1, kind: 'transaction', transactionId, checkoutRequestId, knownCostsMinor: 0, revision: 0, costCount: 0 };
  if (!object(value) || value.schemaVersion !== 1 || value.kind !== 'transaction' || value.transactionId !== transactionId || value.checkoutRequestId !== checkoutRequestId) review();
  revision(value.revision); storedMinor(value.knownCostsMinor); revision(value.costCount);
  return value as CostState;
}
function walletProjection(state: WalletState): AffiliateAdjustmentWalletSummary {
  return { revision: state.revision, walletDeltaKes: state.walletDeltaKes, refundAmountKes: state.refundedMinor / 100,
    adjustmentCount: state.adjustmentCount, negativeBalancePolicy: 'offset_future_available_balance' };
}
function costProjection(state: CostState): AffiliateDirectCostSummary {
  return { revision: state.revision, knownDirectCostsKes: state.knownCostsMinor / 100, costCount: state.costCount };
}
function walletId(affiliateId: string): string { return `affiliate_${hash(affiliateId)}`; }
function sourceId(commissionId: string): string { return `commission_${hash(commissionId)}`; }
function costId(transactionId: string): string { return `transaction_${hash(transactionId)}`; }
async function readDoc(context: AffiliateFinancialAdjustmentContext, collection: string, id: string, transaction?: Transaction) {
  const ref = context.db.collection(collection).doc(id);
  return transaction ? transaction.get(ref) : ref.get();
}
export async function readAffiliateAdjustmentWallet(context: AffiliateFinancialAdjustmentContext, affiliateId: string, transaction?: Transaction): Promise<AffiliateAdjustmentWalletSummary> {
  guard(context); identifier(affiliateId, 'affiliate identifier');
  try {
    const snapshot = await readDoc(context, AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS.summaries, walletId(affiliateId), transaction);
    return walletProjection(walletState(snapshot.exists ? snapshot.data() : undefined, affiliateId));
  } catch (error) { if (error instanceof AffiliateFinancialAdjustmentError) throw error; return unavailable(); }
}
export async function readAffiliateDirectCostSummary(context: AffiliateFinancialAdjustmentContext, transactionId: string, transaction?: Transaction): Promise<AffiliateDirectCostSummary> {
  guard(context); identifier(transactionId, 'transaction identifier');
  try {
    const snapshot = await readDoc(context, AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS.summaries, costId(transactionId), transaction);
    if (!snapshot.exists) return { revision: 0, knownDirectCostsKes: 0, costCount: 0 };
    const value = snapshot.data()!;
    return costProjection(costState(value, transactionId, identifier(value.checkoutRequestId, 'checkout identifier')));
  } catch (error) { if (error instanceof AffiliateFinancialAdjustmentError) throw error; return unavailable(); }
}
/** Apply inside every payout request AND confirmation transaction. Existing
 * reservations are never netted away. Negative effective balances are debt,
 * not permission to withdraw or silently clamp the durable original account. */
export function projectAffiliateAdjustedAvailableBalance(baselineAvailableKes: number, summary: AffiliateAdjustmentWalletSummary) {
  const baseline = integerKes(baselineAvailableKes);
  if (!Number.isSafeInteger(summary.walletDeltaKes) || summary.walletDeltaKes > 0 || summary.walletDeltaKes < -1_000_000_000_000) review();
  const effective = baseline + summary.walletDeltaKes;
  if (!Number.isSafeInteger(effective)) review();
  return { availableBalanceKes: Math.max(0, effective), adjustmentDebtKes: Math.max(0, -effective), walletAdjustmentKes: summary.walletDeltaKes };
}

interface Entry {
  schemaVersion: 1; id: string; kind: EntryKind; requestSha256: string; transactionId: string; checkoutRequestId: string;
  affiliateId?: string; commissionId?: string; sourceSha256: string; currency: 'KES'; amountMinor: number; walletDeltaKes: number;
  reason?: 'refund' | 'chargeback'; category?: 'payment_fee' | 'other'; supersedesEntryId?: string;
  confirmationReference: string; confirmationMethod: 'writer_confirmed'; createdAt: string; createdBy: string;
  summaryRevision: number;
}
function entry(value: unknown, id: string): Entry {
  if (!object(value) || !ENTRY_ID.test(id) || value.schemaVersion !== 1 || value.id !== id
    || !['refund', 'refund_correction', 'direct_cost', 'cost_correction'].includes(value.kind)
    || !HASH.test(value.requestSha256) || !HASH.test(value.sourceSha256) || value.currency !== 'KES'
    || !ID.test(value.transactionId) || !ID.test(value.checkoutRequestId)
    || !Number.isSafeInteger(value.amountMinor) || !value.amountMinor || Math.abs(value.amountMinor) > 100_000_000
    || !Number.isSafeInteger(value.walletDeltaKes) || Math.abs(value.walletDeltaKes) > 1_000_000
    || value.confirmationMethod !== 'writer_confirmed' || !iso(value.createdAt)
    || typeof value.createdBy !== 'string' || !value.createdBy || typeof value.confirmationReference !== 'string'
    || value.confirmationReference.length < 4 || value.confirmationReference.length > 128) review();
  revision(value.summaryRevision);
  if ((value.kind.endsWith('correction') ? value.amountMinor >= 0 : value.amountMinor <= 0)
    || value.kind === 'refund' && value.walletDeltaKes > 0 || value.kind === 'refund_correction' && value.walletDeltaKes < 0
    || !value.kind.startsWith('refund') && value.walletDeltaKes !== 0) review();
  if (value.kind.startsWith('refund') && (!ID.test(value.affiliateId) || !ID.test(value.commissionId))) review();
  if (value.kind.endsWith('correction') && !ENTRY_ID.test(value.supersedesEntryId)) review();
  return value as Entry;
}
function settledPayment(value: unknown, documentId: string, now: string): Record<string, any> {
  if (!object(value) || !ID.test(value.id) || !ID.test(value.checkoutRequestId) || value.checkoutRequestId !== documentId
    || value.type !== 'PURCHASE' || !['CONFIRMED', 'SUCCESS', 'PAID'].includes(value.status) || value.isSeed === true
    || !['mpesa', 'bank'].includes(value.paymentMethod) || (value.currency ?? 'KES') !== 'KES'
    || !ID.test(value.articleId)) review('A uniquely settled KES purchase is required.');
  minor(value.amount);
  const settledAt = value.confirmedAt || value.settledAt || value.completedAt;
  const receipt = value.paymentMethod === 'mpesa' ? value.mpesaReceiptNumber : value.bankReference;
  if (!iso(settledAt) || settledAt > now || typeof receipt !== 'string' || !receipt.trim() || receipt.length > 256) review('Durable payment settlement and receipt evidence is required.');
  return value;
}
async function findPayment(context: AffiliateFinancialAdjustmentContext, transaction: Transaction, transactionId: string, now: string) {
  const snapshot = await transaction.get(context.db.collection('transactions').where('id', '==', transactionId).limit(2));
  if (snapshot.docs.length !== 1) review('The payment identity is missing or duplicated; no adjustment was recorded.');
  const document = snapshot.docs[0]; const payment = settledPayment(document.data(), document.id, now);
  if (payment.id !== transactionId) review();
  return payment;
}
function paymentEvidence(payment: Record<string, any>) {
  return { transactionId: payment.id, checkoutRequestId: payment.checkoutRequestId, articleId: payment.articleId,
    amountMinor: minor(payment.amount), currency: 'KES', paymentMethod: payment.paymentMethod,
    receiptSha256: hash(payment.paymentMethod === 'mpesa' ? payment.mpesaReceiptNumber : payment.bankReference),
    settledAt: payment.confirmedAt || payment.settledAt || payment.completedAt };
}
async function refundSource(context: AffiliateFinancialAdjustmentContext, transaction: Transaction, commissionId: string, now: string) {
  const snapshot = await transaction.get(context.db.collection('affiliate_commissions').doc(commissionId));
  const commission = snapshot.data();
  if (!snapshot.exists || !object(commission) || (commission.id !== undefined && commission.id !== commissionId)
    || !ID.test(commission.affiliateId) || !ID.test(commission.transactionId) || !ID.test(commission.checkoutRequestId)
    || !ID.test(commission.articleId) || !['APPROVED', 'PAID'].includes(commission.status)
    || (commission.currency ?? 'KES') !== 'KES' || !['mpesa', 'bank'].includes(commission.paymentMethod)) review('A paid or part-paid commission with exact durable payment evidence is required.');
  const commissionKes = integerKes(commission.commissionAmountKes);
  if (!commissionKes || commissionKes > 1_000_000) review();
  const saleMinor = minor(commission.saleAmountKes);
  if (commissionKes * 100 > saleMinor || !iso(commission.createdAt) || commission.createdAt > now) review();
  const paidKes = commission.walletLedgerVersion === 1 ? integerKes(commission.payoutPaidKes, true)
    : commission.status === 'PAID' ? commissionKes : 0;
  if (!paidKes || paidKes > commissionKes || commission.status === 'PAID' && paidKes !== commissionKes) review('Unpaid commissions use the existing reversal workflow.');
  if (integerKes(commission.payoutReservedKes, true) || commission.reservedPayoutId) review('Cancel the active payout reservation before recording a refund adjustment.');
  const [paymentSnapshot, affiliateSnapshot, paidPayouts, matchingCommissions] = await Promise.all([
    transaction.get(context.db.collection('transactions').doc(commission.checkoutRequestId)),
    transaction.get(context.db.collection('affiliates').doc(commission.affiliateId)),
    transaction.get(context.db.collection('affiliate_payouts').where('affiliateId', '==', commission.affiliateId).limit(AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.payouts + 1)),
    transaction.get(context.db.collection('affiliate_commissions').where('transactionId', '==', commission.transactionId).limit(2)),
  ]);
  if (matchingCommissions.docs.length !== 1 || matchingCommissions.docs[0].id !== commissionId) review('Duplicate transaction commissions require reconciliation before any adjustment.');
  const payment = settledPayment(paymentSnapshot.data(), commission.checkoutRequestId, now);
  if (payment.id !== commission.transactionId || payment.articleId !== commission.articleId || minor(payment.amount) !== saleMinor
    || payment.paymentMethod !== commission.paymentMethod || payment.saleChannel === 'DIRECT'
    || typeof payment.affiliateCode !== 'string' || typeof commission.affiliateCode !== 'string'
    || payment.affiliateCode.trim().toUpperCase() !== commission.affiliateCode.trim().toUpperCase()
    || (payment.paymentMethod === 'mpesa' ? payment.mpesaReceiptNumber : payment.bankReference) !== commission.receiptNumber) review('Commission and settled payment evidence do not match.');
  const affiliate = affiliateSnapshot.data();
  if (!affiliateSnapshot.exists || !object(affiliate) || affiliate.id !== undefined && affiliate.id !== commission.affiliateId
    || affiliate.activePayoutId || integerKes(affiliate.balanceReservedKes, true)
    || affiliate.affiliateCode !== commission.affiliateCode) review('Review or cancel existing wallet reservations before adjusting paid earnings.');
  integerKes(affiliate.balanceAvailableKes); integerKes(affiliate.balancePendingKes);
  if (paidPayouts.docs.length > AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.payouts) review('Payout proof exceeds the bounded review limit.');
  let provenPaidKes = 0;
  const receipts = new Set<string>();
  for (const document of paidPayouts.docs) {
    const payout = document.data();
    if (!Array.isArray(payout.commissionIds) || !payout.commissionIds.includes(commissionId)) continue;
    if (['PENDING', 'APPROVED', 'PROCESSING'].includes(payout.status)) review('Cancel the active payout before adjusting this commission.');
    if (payout.status !== 'PAID') continue;
    if (payout.id !== undefined && payout.id !== document.id || payout.affiliateId !== commission.affiliateId
      || typeof payout.paymentReference !== 'string' || payout.paymentReference.trim().length < 4) review('Paid payout confirmation evidence needs reconciliation.');
    const receipt = payout.paymentReference.trim().toUpperCase();
    if (receipts.has(receipt)) review('Duplicate payout confirmation references need reconciliation.');
    receipts.add(receipt);
    let allocated: number;
    if (payout.walletLedgerVersion === 1 && Array.isArray(payout.allocations)) {
      if (payout.allocations.length !== payout.commissionIds.length || new Set(payout.commissionIds).size !== payout.commissionIds.length
        || payout.allocations.some((allocation: any, index: number) => !object(allocation) || allocation.commissionId !== payout.commissionIds[index])
        || payout.allocations.reduce((total: number, allocation: any) => total + integerKes(allocation.amountKes), 0) !== integerKes(payout.amountKes)) review();
      const matching = payout.allocations.filter((allocation: any) => allocation?.commissionId === commissionId);
      if (matching.length !== 1) review();
      allocated = integerKes(matching[0].amountKes);
    } else if (payout.commissionIds.length === 1) allocated = integerKes(payout.amountKes);
    else review('Legacy multi-commission payouts require explicit reconciliation; history was preserved.');
    provenPaidKes += allocated;
  }
  if (provenPaidKes !== paidKes) review('Confirmed payout allocations do not match this commission’s paid amount.');
  return { commission, payment, affiliateId: commission.affiliateId as string, saleMinor, commissionKes,
    sourceSha256: hash({ ...paymentEvidence(payment), commissionId, affiliateId: commission.affiliateId, commissionKes, paidKes }) };
}

export interface AffiliateFinancialAdjustmentResult {
  status: 'recorded' | 'already_recorded'; entryId: string; kind: EntryKind; transactionId: string;
  affiliateId?: string; wallet?: AffiliateAdjustmentWalletSummary; directCosts?: AffiliateDirectCostSummary;
  providerOperationPerformed: false; accessPermissionsChanged: false;
}
function result(record: Entry, replay: boolean, wallet?: WalletState, costs?: CostState): AffiliateFinancialAdjustmentResult {
  return { status: replay ? 'already_recorded' : 'recorded', entryId: record.id, kind: record.kind, transactionId: record.transactionId,
    ...(record.affiliateId ? { affiliateId: record.affiliateId } : {}), ...(wallet ? { wallet: walletProjection(wallet) } : {}),
    ...(costs ? { directCosts: costProjection(costs) } : {}), providerOperationPerformed: false, accessPermissionsChanged: false };
}
function recordWrites(context: AffiliateFinancialAdjustmentContext, transaction: Transaction, record: Entry, referenceClaimId: string, supersededId?: string) {
  const collections = AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS;
  transaction.create(context.db.collection(collections.entries).doc(record.id), record);
  transaction.create(context.db.collection(collections.claims).doc(referenceClaimId), { schemaVersion: 1, kind: 'confirmation_reference', entryId: record.id, createdAt: record.createdAt });
  if (supersededId) transaction.create(context.db.collection(collections.claims).doc(`correction_${supersededId}`), { schemaVersion: 1, kind: 'correction', entryId: record.id, supersededEntryId: supersededId, createdAt: record.createdAt });
  transaction.create(context.db.collection(collections.audits).doc(`aud_${record.id}`), {
    id: `aud_${record.id}`, timestamp: record.createdAt, actor: context.actor,
    action: 'affiliate_financial_adjustment_recorded', targetType: 'commission', targetId: record.commissionId || record.transactionId,
    summary: `Recorded immutable ${record.kind.replace(/_/g, ' ')}; historical earnings, payments and access were preserved.`,
    newValue: { schemaVersion: 1, entryId: record.id, kind: record.kind, transactionId: record.transactionId,
      amountKes: record.amountMinor / 100, walletDeltaKes: record.walletDeltaKes, sourceSha256: record.sourceSha256,
      confirmationReferenceSha256: hash(record.confirmationReference), summaryRevision: record.summaryRevision },
  });
}
async function mutate(context: AffiliateFinancialAdjustmentContext, body: unknown, kind: EntryKind): Promise<AffiliateFinancialAdjustmentResult> {
  const now = guard(context);
  const correction = kind.endsWith('correction'); const refund = kind.startsWith('refund');
  const request = common(body, correction ? ['entryId'] : refund ? ['commissionId', 'refundedAmountKes', 'reason'] : ['transactionId', 'amountKes', 'category']);
  if (correction) { if (!ENTRY_ID.test(request.entryId)) invalid('A valid original adjustment entry is required.'); }
  else if (refund) { identifier(request.commissionId, 'commission identifier'); minor(request.refundedAmountKes); if (!['refund', 'chargeback'].includes(request.reason)) invalid('Choose refund or chargeback.'); }
  else { identifier(request.transactionId, 'transaction identifier'); minor(request.amountKes); if (!['payment_fee', 'other'].includes(request.category)) invalid('Choose payment_fee or other.'); }
  // Freeze normalized input before asynchronous work; HTTP object mutation must
  // not change the envelope between review, claim and commit.
  const input = structuredClone(request);
  const requestSha256 = hash({ kind, request: input });
  const id = `afa1_${hash(['affiliate-financial-adjustment:v1', kind, input.idempotencyKey])}`;
  const referenceClaimId = `reference_${hash(['financial_confirmation:v1', input.confirmationReference])}`;
  const collections = AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS;
  try {
    return await context.db.runTransaction(async transaction => {
      const [existing, referenceClaim, originalSnapshot, correctionClaim] = await Promise.all([
        transaction.get(context.db.collection(collections.entries).doc(id)),
        transaction.get(context.db.collection(collections.claims).doc(referenceClaimId)),
        correction ? transaction.get(context.db.collection(collections.entries).doc(input.entryId)) : Promise.resolve(null),
        correction ? transaction.get(context.db.collection(collections.claims).doc(`correction_${input.entryId}`)) : Promise.resolve(null),
      ]);
      if (existing.exists) {
        const previous = entry(existing.data(), id);
        if (previous.kind !== kind || previous.requestSha256 !== requestSha256 || referenceClaim.data()?.entryId !== id) conflict();
        if (refund) {
          const snapshot = await transaction.get(context.db.collection(collections.summaries).doc(walletId(previous.affiliateId!)));
          if (!snapshot.exists || Number(snapshot.data()?.revision) < previous.summaryRevision) review();
          return result(previous, true, walletState(snapshot.data(), previous.affiliateId!));
        }
        const snapshot = await transaction.get(context.db.collection(collections.summaries).doc(costId(previous.transactionId)));
        if (!snapshot.exists || Number(snapshot.data()?.revision) < previous.summaryRevision) review();
        return result(previous, true, undefined, costState(snapshot.data(), previous.transactionId, previous.checkoutRequestId));
      }
      if (referenceClaim.exists || correctionClaim?.exists) conflict();
      const original = correction && originalSnapshot?.exists ? entry(originalSnapshot.data(), input.entryId) : undefined;
      if (correction && (!original || original.kind !== (refund ? 'refund' : 'direct_cost'))) review('Only an uncorrected original entry can be compensated.');
      if (refund) {
        const source = await refundSource(context, transaction, original?.commissionId || input.commissionId, now);
        if (original && (original.affiliateId !== source.affiliateId || original.transactionId !== source.payment.id)) review();
        const walletRef = context.db.collection(collections.summaries).doc(walletId(source.affiliateId));
        const sourceRef = context.db.collection(collections.summaries).doc(sourceId(original?.commissionId || input.commissionId));
        const [walletSnapshot, sourceSnapshot] = await Promise.all([transaction.get(walletRef), transaction.get(sourceRef)]);
        const wallet = walletState(walletSnapshot.exists ? walletSnapshot.data() : undefined, source.affiliateId);
        if (wallet.revision !== input.expectedRevision) conflict();
        const commissionId = original?.commissionId || input.commissionId;
        const previous = sourceSnapshot.exists ? sourceSnapshot.data() : { schemaVersion: 1, kind: 'commission', commissionId,
          affiliateId: source.affiliateId, transactionId: source.payment.id, checkoutRequestId: source.payment.checkoutRequestId, refundedMinor: 0, debitKes: 0, revision: 0 };
        if (!object(previous) || previous.schemaVersion !== 1 || previous.kind !== 'commission' || previous.commissionId !== commissionId
          || previous.affiliateId !== source.affiliateId || previous.transactionId !== source.payment.id || previous.checkoutRequestId !== source.payment.checkoutRequestId) review();
        revision(previous.revision); storedMinor(previous.refundedMinor); integerKes(previous.debitKes);
        const amountMinor = original ? -original.amountMinor : minor(input.refundedAmountKes);
        const refundedMinor = previous.refundedMinor + amountMinor;
        if (refundedMinor < 0 || refundedMinor > source.saleMinor) review('Cumulative confirmed refunds cannot exceed the original paid purchase.');
        const debitKes = Math.round(source.commissionKes * refundedMinor / source.saleMinor);
        const expectedPreviousDebit = Math.round(source.commissionKes * previous.refundedMinor / source.saleMinor);
        if (previous.debitKes !== expectedPreviousDebit) review();
        const walletDeltaKes = previous.debitKes - debitKes;
        const nextWallet: WalletState = { ...wallet, revision: wallet.revision + 1, walletDeltaKes: wallet.walletDeltaKes + walletDeltaKes,
          refundedMinor: wallet.refundedMinor + amountMinor, adjustmentCount: wallet.adjustmentCount + 1 };
        walletState(nextWallet, source.affiliateId);
        const nextSource: RefundState = { ...previous, revision: previous.revision + 1, refundedMinor, debitKes } as RefundState;
        revision(nextSource.revision);
        const record: Entry = { schemaVersion: 1, id, kind, requestSha256, affiliateId: source.affiliateId, commissionId,
          transactionId: source.payment.id, checkoutRequestId: source.payment.checkoutRequestId, sourceSha256: source.sourceSha256,
          currency: 'KES', amountMinor, walletDeltaKes, reason: original?.reason || input.reason,
          ...(original ? { supersedesEntryId: original.id } : {}), confirmationReference: input.confirmationReference,
          confirmationMethod: 'writer_confirmed', createdAt: now, createdBy: context.actor, summaryRevision: nextWallet.revision };
        transaction.set(walletRef, nextWallet, { merge: false }); transaction.set(sourceRef, nextSource, { merge: false });
        recordWrites(context, transaction, record, referenceClaimId, original?.id);
        return result(record, false, nextWallet);
      }
      const payment = await findPayment(context, transaction, original?.transactionId || input.transactionId, now);
      const summaryRef = context.db.collection(collections.summaries).doc(costId(payment.id));
      const snapshot = await transaction.get(summaryRef);
      const previous = costState(snapshot.exists ? snapshot.data() : undefined, payment.id, payment.checkoutRequestId);
      if (previous.revision !== input.expectedRevision) conflict();
      const amountMinor = original ? -original.amountMinor : minor(input.amountKes);
      const knownCostsMinor = previous.knownCostsMinor + amountMinor;
      if (knownCostsMinor < 0 || knownCostsMinor > minor(payment.amount)) review('Known direct costs must remain between zero and the settled purchase amount.');
      const next: CostState = { ...previous, revision: previous.revision + 1, knownCostsMinor, costCount: previous.costCount + 1 };
      costState(next, payment.id, payment.checkoutRequestId);
      const record: Entry = { schemaVersion: 1, id, kind, requestSha256, transactionId: payment.id, checkoutRequestId: payment.checkoutRequestId,
        sourceSha256: hash(paymentEvidence(payment)), currency: 'KES', amountMinor, walletDeltaKes: 0,
        category: original?.category || input.category, ...(original ? { supersedesEntryId: original.id } : {}),
        confirmationReference: input.confirmationReference, confirmationMethod: 'writer_confirmed', createdAt: now, createdBy: context.actor, summaryRevision: next.revision };
      transaction.set(summaryRef, next, { merge: false }); recordWrites(context, transaction, record, referenceClaimId, original?.id);
      return result(record, false, undefined, next);
    });
  } catch (error) { if (error instanceof AffiliateFinancialAdjustmentError) throw error; return unavailable(); }
}
export function createAffiliateRefundAdjustment(context: AffiliateFinancialAdjustmentContext, body: unknown) { return mutate(context, body, 'refund'); }
export function reverseAffiliateRefundAdjustment(context: AffiliateFinancialAdjustmentContext, body: unknown) { return mutate(context, body, 'refund_correction'); }
export function recordAffiliateDirectCost(context: AffiliateFinancialAdjustmentContext, body: unknown) { return mutate(context, body, 'direct_cost'); }
export function reverseAffiliateDirectCost(context: AffiliateFinancialAdjustmentContext, body: unknown) { return mutate(context, body, 'cost_correction'); }

/** No buyer identities, receipt values, writer identities or raw references. */
function projectOverview(snapshot: QuerySnapshot, affiliateId?: string): AffiliateFinancialAdjustmentOverview {
    const readTimeMs = firestoreSnapshotReadTimeMillis(snapshot);
    if (readTimeMs === null) unavailable();
    if (snapshot.docs.length > AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.overview) review('Adjustment history exceeds the bounded view; a paginated report is required.');
    const entries = snapshot.docs.map(document => entry(document.data(), document.id));
    const wallets = new Map<string, number>(); const costs = new Map<string, number>();
    const purchaseAdjustments = new Map<string, { refundedMinor: number; clawbackKes: number }>(); let refundsMinor = 0;
    for (const record of entries) {
      if (record.kind.startsWith('refund')) {
        wallets.set(record.affiliateId!, (wallets.get(record.affiliateId!) || 0) + record.walletDeltaKes); refundsMinor += record.amountMinor;
        const previous = purchaseAdjustments.get(record.transactionId) || { refundedMinor: 0, clawbackKes: 0 };
        purchaseAdjustments.set(record.transactionId, { refundedMinor: previous.refundedMinor + record.amountMinor, clawbackKes: previous.clawbackKes - record.walletDeltaKes });
      }
      else costs.set(record.transactionId, (costs.get(record.transactionId) || 0) + record.amountMinor);
    }
    if ([...wallets.values()].some(value => !Number.isSafeInteger(value) || value > 0)
      || [...costs.values()].some(value => !Number.isSafeInteger(value) || value < 0)
      || [...purchaseAdjustments.values()].some(value => !Number.isSafeInteger(value.refundedMinor) || value.refundedMinor < 0
        || !Number.isSafeInteger(value.clawbackKes) || value.clawbackKes < 0)
      || !Number.isSafeInteger(refundsMinor) || refundsMinor < 0) review();
    return { currency: 'KES' as const, asOf: new Date(readTimeMs).toISOString(), recordedRefundAmountKes: refundsMinor / 100,
      refundedPurchaseKes: refundsMinor / 100, commissionClawbackKes: -[...wallets.values()].reduce((total, value) => total + value, 0),
      walletDeltas: [...wallets].map(([affiliateId, walletDeltaKes]) => ({ affiliateId, walletDeltaKes })),
      purchaseAdjustments: [...purchaseAdjustments].map(([transactionId, value]) => ({ transactionId,
        refundedPurchaseKes: value.refundedMinor / 100, commissionClawbackKes: value.clawbackKes })),
      directCosts: [...costs].map(([transactionId, minorKes]) => ({ transactionId, knownDirectCostsKes: minorKes / 100 })),
      entries: entries.map(record => ({ entryId: record.id, kind: record.kind, transactionId: record.transactionId,
        ...(record.affiliateId ? { affiliateId: record.affiliateId } : {}), ...(record.commissionId ? { commissionId: record.commissionId } : {}),
        amountKes: record.amountMinor / 100, walletDeltaKes: record.walletDeltaKes, createdAt: record.createdAt,
        summaryRevision: record.summaryRevision, ...(record.supersedesEntryId ? { supersedesEntryId: record.supersedesEntryId } : {}),
        ...(record.reason ? { reason: record.reason } : {}), ...(record.category ? { category: record.category } : {}) })),
      costCoverage: 'known_recorded_costs_only' as const, netProfitClaimed: false as const,
      directCostScope: affiliateId ? 'unavailable_for_affiliate_filter' as const : 'all_recorded_transactions' as const,
      providerOperationPerformed: false as const, accessPermissionsChanged: false as const };
}

/** Caller-owned transaction supports the same read-time boundary as wallets,
 * commissions and analytics. This helper has no writes or local fallback. */
export async function readAffiliateFinancialAdjustmentOverview(context: AffiliateFinancialAdjustmentContext,
  transaction: Transaction, options: { affiliateId?: string } = {}): Promise<AffiliateFinancialAdjustmentOverview> {
  guard(context);
  if (options.affiliateId !== undefined) identifier(options.affiliateId, 'affiliate identifier');
  try {
    let query = context.db.collection(AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS.entries).limit(AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.overview + 1);
    if (options.affiliateId) query = query.where('affiliateId', '==', options.affiliateId);
    return projectOverview(await transaction.get(query), options.affiliateId);
  } catch (error) { if (error instanceof AffiliateFinancialAdjustmentError) throw error; return unavailable(); }
}

/** Bounded writer-only accounting view. */
export async function getAffiliateFinancialAdjustmentOverview(context: AffiliateFinancialAdjustmentContext,
  options: { affiliateId?: string } = {}): Promise<AffiliateFinancialAdjustmentOverview> {
  guard(context);
  try {
    return await context.db.runTransaction(transaction => readAffiliateFinancialAdjustmentOverview(context, transaction, options), { readOnly: true });
  } catch (error) { if (error instanceof AffiliateFinancialAdjustmentError) throw error; return unavailable(); }
}

/** Refund evidence changes prospective qualification, never the stored period,
 * earned commission, founding recognition or awarded milestones. */
export async function readAffiliateRefundQualificationEvidence(context: AffiliateFinancialAdjustmentContext,
  transaction: Transaction, affiliateId: string, asOf?: string): Promise<AffiliateRefundQualificationEvidence[]> {
  guard(context); identifier(affiliateId, 'affiliate identifier');
  if (asOf !== undefined && !iso(asOf)) invalid('A canonical server-selected qualification time is required.');
  const snapshot = await transaction.get(context.db.collection(AFFILIATE_FINANCIAL_ADJUSTMENT_COLLECTIONS.entries)
    .where('affiliateId', '==', affiliateId).limit(AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.overview + 1));
  if (snapshot.docs.length > AFFILIATE_FINANCIAL_ADJUSTMENT_LIMITS.overview) review('Adjustment history exceeds the qualification review bound.');
  const refunds = new Map<string, number>();
  for (const document of snapshot.docs) {
    const record = entry(document.data(), document.id);
    if (!record.kind.startsWith('refund')) continue;
    // Delayed settlement must retain the rate that its actual sale time earned.
    if (asOf && record.createdAt > asOf) continue;
    if (record.affiliateId !== affiliateId || !record.commissionId) review();
    refunds.set(record.commissionId, (refunds.get(record.commissionId) || 0) + record.amountMinor);
  }
  if ([...refunds.values()].some(value => !Number.isSafeInteger(value) || value < 0)) review();
  return [...refunds].map(([commissionId, amountMinor]) => ({ commissionId, refundedPurchaseKes: amountMinor / 100 }));
}

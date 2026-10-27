import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';
import {
  getDb,
  setFirestoreDoc,
  updateFirestoreDoc,
  getFirestoreDoc,
  deleteFirestoreDoc,
  getAllFirestoreDocs,
  resolveFirestoreTargetConfig
} from './db.js';
import {
  AffiliateAccount,
  AffiliatePublicProfile,
  AffiliateSaleCommission, 
  AffiliateClickEvent, 
  AffiliatePayoutRequest, 
  AffiliateCampaign, 
  AffiliateSettings, 
  AffiliateAuditLogEntry, 
  AffiliateDashboardStats,
  AdminAffiliatesSummary,
  AffiliateAnalyticsFilters,
  AffiliateAnalyticsReport,
  AffiliateStatus,
  CommissionStatus,
  PayoutStatus,
  PaymentTransaction,
  AffiliateSession,
  AffiliateLiteraryCircleMembership,
  LiteraryCircleComplimentaryAccessStatus,
  LiteraryCircleOnboardingStatus,
  LiteraryCircleSettings
} from '../types.js';
import { buildAffiliateAnalyticsReport, resolveAffiliateAnalyticsWindow } from './affiliateAnalytics.js';
import {
  affiliateFinancialTotals,
  readAffiliateFinancialSnapshot,
  type AffiliateFinancialSnapshot,
} from './affiliateFinancialRead.js';
import {
  readAffiliateAdjustmentWallet,
  readAffiliateRefundQualificationEvidence,
  projectAffiliateAdjustedAvailableBalance,
  type AffiliateAdjustmentWalletSummary,
  type AffiliateFinancialAdjustmentContext,
  type AffiliateFinancialAdjustmentOverview,
} from './affiliateFinancialAdjustments.js';
import {
  readDurableAffiliateClickWindow,
  type DurableAffiliateClickWindowResult,
} from './affiliateClickAnalyticsStore.js';
import {
  createDurableAffiliateClickDedupeIdentity,
  deriveAffiliateClickAnalyticsKeyFingerprint,
  firestoreSnapshotReadTimeMillis,
  normalizeDurableAffiliateClickEventV2,
  sanitizeAffiliateClickReferrerOrigin,
  type DurableAffiliateClickEventV2,
} from './affiliateClickLedger.js';
import { isCurrentAffiliatePasswordHash } from './affiliateCredentials.js';
import { AffiliateLoginIdentityUnavailableError, readAffiliateLoginIdentity } from './affiliateLoginIdentity.js';
import { prepareCommittedAffiliateNotification } from './affiliateNotificationEvents.js';
import { buildLiteraryCircleTierTransition } from './literaryCircleTierTransition.js';
import {
  appendAffiliateTierPeriodSale,
  countAffiliateTierPeriodSales,
  readAffiliateTierPeriodForSale,
  readAffiliateTierPeriodReversal,
  validateAffiliateTierPeriodPayment,
} from './affiliateTierPeriods.js';
import { campaignNotificationAuditId, literaryCircleNotificationAuditId } from './affiliateNotificationAudit.js';
import {
  buildCommittedAffiliateBuyerAnalyticsEvidence,
  MAX_AFFILIATE_BUYER_HISTORY,
  projectStoredAffiliateBuyerAnalytics,
  resolveAffiliateBuyerAnalyticsRuntime,
  withoutAffiliateBuyerAnalytics,
} from './affiliateBuyerAnalytics.js';
import { resolveOrderId, toAffiliateSaleCommission } from './salesLedger.js';
import { readConsumedAffiliateAttributionClaimInTransaction } from './affiliateAttributionClaimStore.js';
import { buildCommittedAffiliateConversionEvidence, normalizeAffiliateConversionSourceClick,
  projectAffiliateConversionCohort } from './affiliateConversionCohort.js';
import {
  AFFILIATE_SESSION_MAX_AGE_MS,
  AFFILIATE_SESSION_STORAGE_VERSION,
  createAffiliateSessionVersion,
  createSignedAffiliateSessionToken,
  getAffiliateSessionDocumentId,
  isAffiliateSessionDocumentId,
  isValidSignedAffiliateSessionToken,
  normalizeAffiliateSessionRecord,
  resolveAffiliateSessionVersion
} from './affiliateSessionSecurity.js';
import {
  buildLiteraryCircleDashboardSummary,
  buildLiteraryCirclePerformancePeriods,
  countVerifiedSalesForPeriod,
  createLiteraryCircleCommissionPolicySnapshot,
  createLiteraryCircleMembership,
  DEFAULT_LITERARY_CIRCLE_SETTINGS,
  isAffiliateComplimentaryAccessActive,
  isLiteraryCircleCommissionPolicyChange,
  isVerifiedAffiliateCommission,
  LITERARY_CIRCLE_ONBOARDING_STEPS,
  LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
  LiteraryCircleValidationError,
  literaryCirclePeriodKey,
  normalizeLiteraryCircleSettings,
  resolveAffiliateCommissionRate,
  resolveLiteraryCircleTier,
  resolveLiteraryCircleSettingsForTransaction,
  shouldApplyLiteraryCircleCommissionPolicy,
  validateLiteraryCircleSettings
} from './literaryCircle.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AFFILIATES_FILE = path.join(DATA_DIR, 'affiliates.json');
const COMMISSIONS_FILE = path.join(DATA_DIR, 'affiliate_commissions.json');
const CLICKS_FILE = path.join(DATA_DIR, 'affiliate_clicks.json');
const PAYOUTS_FILE = path.join(DATA_DIR, 'affiliate_payouts.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'affiliate_campaigns.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'affiliate_settings.json');
const LITERARY_CIRCLE_SETTINGS_FILE = path.join(DATA_DIR, 'affiliate_literary_circle.json');
const AUDIT_FILE = path.join(DATA_DIR, 'affiliate_audit.json');
const AFFILIATE_SESSIONS_FILE = path.join(DATA_DIR, 'affiliate_sessions.v2.json');

const DEFAULT_AFFILIATE_SETTINGS: AffiliateSettings = {
  defaultCommissionRate: 15,
  minPayoutThresholdKes: 1000,
  defaultAttributionDays: 30,
  allowTipsCommission: false,
  autoApproveCommissions: true,
  autoApproveDelayHours: 0,
  enablePublicLeaderboard: false,
  allowSelfRegistration: true,
  pieceCommissionOverrides: {}
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTRIBUTION_DAYS = 90;
export const MAX_WALLET_PAYOUT_COMMISSIONS = 400;
const ACTIVE_WALLET_PAYOUT_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING'] as const;

function financialAdjustmentContext(db = getDb()): AffiliateFinancialAdjustmentContext {
  const pins = resolveFirestoreTargetConfig();
  return { db, expectedProjectId: pins.projectId, expectedDatabaseId: pins.firestoreDatabaseId, actor: 'Server financial read' };
}

function refundQualifiedCommissions(commissions: AffiliateSaleCommission[], adjustments?: AffiliateFinancialAdjustmentOverview) {
  if (!adjustments) return commissions;
  const refunded = new Map(adjustments.purchaseAdjustments.map(row => [row.transactionId, Math.round(row.refundedPurchaseKes * 100)]));
  return commissions.filter(commission => {
    const amount = refunded.get(commission.transactionId) || 0;
    return amount === 0 || amount < Math.round(commission.saleAmountKes * 100);
  });
}

function adjustmentWalletFor(snapshot: AffiliateFinancialSnapshot | undefined, affiliateId: string): AffiliateAdjustmentWalletSummary {
  return snapshot?.adjustmentWallets?.[affiliateId] || { revision: 0, walletDeltaKes: 0, refundAmountKes: 0,
    adjustmentCount: 0, negativeBalancePolicy: 'offset_future_available_balance' };
}

export class AffiliateWalletValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'AffiliateWalletValidationError'; }
}

function walletReview(message = 'Historical wallet records need writer review before this action.'): never {
  throw new AffiliateWalletValidationError(message);
}

function walletCommitFailure(error: unknown): never {
  if (error instanceof AffiliateWalletValidationError) throw error;
  throw new AffiliateWalletValidationError('Wallet changes could not be committed. No local fallback was used; please retry safely.');
}

function walletIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function walletMoney(value: unknown, optional = false): number {
  if (optional && value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) walletReview();
  return value;
}

function walletNextRevision(value: unknown): number {
  const revision = value === undefined ? 0 : value;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= 1_000_000_000) walletReview();
  return revision + 1;
}

function readWalletAccount(data: AffiliateAccount | undefined, id: string): AffiliateAccount {
  if (!data) throw new AffiliateWalletValidationError('Affiliate not found.');
  if ((data.id !== undefined && data.id !== id) || !walletIdentifier(id)
    || (data.walletLedgerVersion !== undefined && data.walletLedgerVersion !== 1)
    || (data.activePayoutId != null && !walletIdentifier(data.activePayoutId))) walletReview();
  walletMoney(data.balanceAvailableKes); walletMoney(data.balancePendingKes);
  walletMoney(data.totalCommissionPaidKes); walletMoney(data.totalCommissionEarnedKes);
  const reserved = walletMoney(data.balanceReservedKes, true);
  walletMoney(data.totalCommissionReversedKes, true);
  if ((reserved > 0) !== Boolean(data.activePayoutId) || (reserved > 0 && data.walletLedgerVersion !== 1)) walletReview('Wallet reservation evidence needs writer reconciliation.');
  walletNextRevision(data.walletRevision);
  return { ...data, id };
}

function readWalletCommission(data: AffiliateSaleCommission | undefined, id: string, affiliateId: string): AffiliateSaleCommission {
  if (!data || (data.id !== undefined && data.id !== id) || data.affiliateId !== affiliateId
    || !walletIdentifier(id) || !walletIdentifier(affiliateId)
    || typeof data.createdAt !== 'string' || !Number.isFinite(Date.parse(data.createdAt))
    || (data.walletLedgerVersion !== undefined && data.walletLedgerVersion !== 1)) walletReview();
  const amount = walletMoney(data.commissionAmountKes);
  const paid = walletMoney(data.payoutPaidKes, true);
  const reserved = walletMoney(data.payoutReservedKes, true);
  walletNextRevision(data.walletRevision);
  if (paid + reserved > amount || (reserved > 0) !== Boolean(data.reservedPayoutId)
    || (data.reservedPayoutId != null && !walletIdentifier(data.reservedPayoutId))
    || (data.status !== 'PAID' && data.payoutId)
    || (data.walletLedgerVersion !== 1 && (paid > 0 || reserved > 0))
    || (amount > 0 && paid === amount && data.status !== 'PAID')) walletReview();
  return { ...data, id };
}

function walletAudit(actor: string, action: string, targetType: 'commission' | 'payout', targetId: string,
  previous: unknown, next: unknown): AffiliateAuditLogEntry {
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 200 || /[\u0000-\u001f\u007f]/.test(actor)) {
    throw new AffiliateWalletValidationError('A valid wallet administrator or account actor is required.');
  }
  return { id: `aud_wallet_${crypto.randomBytes(16).toString('hex')}`, timestamp: new Date().toISOString(),
    actor, action, targetType, targetId, summary: `Committed ${action.replace(/_/g, ' ')}.`,
    ...(previous ? { previousValue: sanitizeAuditValue(previous) } : {}), newValue: sanitizeAuditValue(next) };
}

function publishWalletCommit(input: { affiliate?: AffiliateAccount; commissions?: AffiliateSaleCommission[]; payout?: AffiliatePayoutRequest }) {
  if (input.affiliate) {
    const current = cachedAffiliates.find(row => row.id === input.affiliate!.id);
    if (!current || (current.walletRevision || 0) <= (input.affiliate.walletRevision || 0)) {
      cacheFreshAffiliateRecord(input.affiliate.id, input.affiliate);
    }
  }
  for (const commission of input.commissions || []) {
    const index = cachedCommissions.findIndex(row => row.id === commission.id);
    if (index < 0) cachedCommissions.unshift(commission);
    else if ((cachedCommissions[index].walletRevision || 0) <= (commission.walletRevision || 0)) cachedCommissions[index] = commission;
  }
  if (input.commissions?.length) writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
  if (input.payout) {
    const payout = input.payout;
    const index = cachedPayouts.findIndex(row => row.id === payout.id);
    if (index < 0) cachedPayouts.unshift(payout);
    else if ((cachedPayouts[index].walletRevision || 0) <= (payout.walletRevision || 0)) cachedPayouts[index] = payout;
    writeJsonFileSync(PAYOUTS_FILE, cachedPayouts);
  }
}

export interface LiteraryCircleMembershipPatch {
  complimentaryAccessStatus?: LiteraryCircleComplimentaryAccessStatus;
  complimentaryAccessReason?: string;
  manualTierId?: string | null;
  /** Founding recognition is intentionally additive and can never be removed. */
  foundingMember?: true;
}

export interface LiteraryCircleOnboardingPatch {
  completedStepId?: string;
  status?: LiteraryCircleOnboardingStatus;
}

function finiteNumberInRange(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function normalizeAttributionDays(value: unknown, fallback = DEFAULT_AFFILIATE_SETTINGS.defaultAttributionDays): number {
  return Math.round(finiteNumberInRange(value, fallback, 1, MAX_ATTRIBUTION_DAYS));
}

function normalizeAffiliateSettings(value: unknown): AffiliateSettings {
  const settings = value && typeof value === 'object'
    ? value as Partial<AffiliateSettings>
    : {};
  const pieceCommissionOverrides = Object.fromEntries(
    Object.entries(settings.pieceCommissionOverrides || {}).flatMap(([articleId, rate]) => {
      const normalizedRate = Number(rate);
      return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(articleId) &&
        Number.isFinite(normalizedRate) && normalizedRate > 0 && normalizedRate <= 100
        ? [[articleId, normalizedRate]]
        : [];
    })
  );
  return {
    defaultCommissionRate: finiteNumberInRange(
      settings.defaultCommissionRate,
      DEFAULT_AFFILIATE_SETTINGS.defaultCommissionRate,
      0.01,
      100
    ),
    minPayoutThresholdKes: finiteNumberInRange(
      settings.minPayoutThresholdKes,
      DEFAULT_AFFILIATE_SETTINGS.minPayoutThresholdKes,
      1,
      10_000_000
    ),
    defaultAttributionDays: normalizeAttributionDays(settings.defaultAttributionDays),
    allowTipsCommission: typeof settings.allowTipsCommission === 'boolean'
      ? settings.allowTipsCommission
      : DEFAULT_AFFILIATE_SETTINGS.allowTipsCommission,
    autoApproveCommissions: typeof settings.autoApproveCommissions === 'boolean'
      ? settings.autoApproveCommissions
      : DEFAULT_AFFILIATE_SETTINGS.autoApproveCommissions,
    autoApproveDelayHours: finiteNumberInRange(
      settings.autoApproveDelayHours,
      DEFAULT_AFFILIATE_SETTINGS.autoApproveDelayHours,
      0,
      24 * 365
    ),
    enablePublicLeaderboard: typeof settings.enablePublicLeaderboard === 'boolean'
      ? settings.enablePublicLeaderboard
      : DEFAULT_AFFILIATE_SETTINGS.enablePublicLeaderboard,
    allowSelfRegistration: typeof settings.allowSelfRegistration === 'boolean'
      ? settings.allowSelfRegistration
      : DEFAULT_AFFILIATE_SETTINGS.allowSelfRegistration,
    pieceCommissionOverrides
  };
}

export class AffiliateSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AffiliateSettingsValidationError';
  }
}

export class AffiliateCampaignValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AffiliateCampaignValidationError';
  }
}

export class AffiliateCampaignConflictError extends Error {
  readonly statusCode = 409;
  constructor(message = 'This campaign changed since it was opened. Reload the current campaign before saving again.') {
    super(message);
    this.name = 'AffiliateCampaignConflictError';
  }
}

const SAFE_CAMPAIGN_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;
const SAFE_CAMPAIGN_CODE = /^[A-Z0-9][A-Z0-9_]{0,63}$/;
const MAX_FRESH_AFFILIATE_CAMPAIGNS = 500;

function campaignText(value: unknown, label: string, maximum: number, required = false): string {
  if (typeof value !== 'string' || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
    || value.trim().length > maximum || (required && !value.trim())) {
    throw new AffiliateCampaignValidationError(`${label} is invalid.`);
  }
  return value.trim();
}

function campaignTime(value: unknown, label: string): string {
  const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(milliseconds) || !/^(?:\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)$/.test(String(value))
    || (typeof value === 'string' && value.length === 10 && new Date(milliseconds).toISOString().slice(0, 10) !== value)
    || (typeof value === 'string' && value.length > 10 && new Date(milliseconds).toISOString() !== value)) {
    throw new AffiliateCampaignValidationError(`${label} must be a valid date or UTC timestamp.`);
  }
  return new Date(milliseconds).toISOString();
}

function campaignRevision(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) >= Number.MAX_SAFE_INTEGER) {
    throw new AffiliateCampaignConflictError();
  }
  return value as number;
}

export class LiteraryCircleSettingsConflictError extends Error {
  constructor() {
    super('Literary Circle settings changed since this editor was opened. Reload the latest settings before saving again.');
    this.name = 'LiteraryCircleSettingsConflictError';
  }
}

export type AffiliateClickLedgerMode = 'off' | 'shadow' | 'required';

export interface AffiliateClickRegistrationOptions {
  durableMode?: AffiliateClickLedgerMode;
  visitorKey?: string;
}

export class AffiliateClickLedgerUnavailableError extends Error {
  constructor() {
    super('Durable referral tracking is temporarily unavailable.');
    this.name = 'AffiliateClickLedgerUnavailableError';
  }
}

function validateAffiliateSettingsPatch(patch: Partial<AffiliateSettings>): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AffiliateSettingsValidationError('Affiliate settings must be provided as an object.');
  }
  const validateNumber = (
    key: keyof AffiliateSettings,
    label: string,
    minimum: number,
    maximum: number,
    integer = false
  ) => {
    if (patch[key] === undefined) return;
    const value = Number(patch[key]);
    if (
      !Number.isFinite(value)
      || value < minimum
      || value > maximum
      || (integer && !Number.isSafeInteger(value))
    ) {
      throw new AffiliateSettingsValidationError(
        `${label} must be ${integer ? 'a whole number ' : ''}between ${minimum} and ${maximum}.`
      );
    }
  };
  validateNumber('defaultCommissionRate', 'Default commission rate', 0.01, 100);
  validateNumber('minPayoutThresholdKes', 'Minimum payout threshold', 1, 10_000_000, true);
  validateNumber('defaultAttributionDays', 'Attribution window', 1, MAX_ATTRIBUTION_DAYS, true);
  validateNumber('autoApproveDelayHours', 'Auto-approve delay', 0, 24 * 365);
}

function isCampaignValidAttribution(
  campaign: AffiliateCampaign,
  articleId: string | undefined,
  attributedAtMs: number
): boolean {
  const startMs = Date.parse(campaign.startDate);
  const endMs = Date.parse(campaign.endDate);
  return campaign.isActive === true &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    startMs <= attributedAtMs &&
    attributedAtMs <= endMs &&
    (!articleId || !campaign.eligiblePieceIds?.length || campaign.eligiblePieceIds.includes(articleId));
}

function transactionHasValidAffiliateAttribution(transaction: PaymentTransaction): boolean {
  if (transaction.affiliateAttributionVersion !== undefined && transaction.affiliateAttributionVersion !== 2) {
    return false;
  }
  if (transaction.affiliateAttributionClaimId && transaction.affiliateAttributionVersion !== 2) {
    return false;
  }
  if (transaction.affiliateAttributionVersion === 2 && (
    typeof transaction.affiliateAttributionClaimId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(transaction.affiliateAttributionClaimId) ||
    typeof transaction.affiliateCode !== 'string' ||
    (transaction.paymentMethod !== 'mpesa' && transaction.paymentMethod !== 'bank')
  )) {
    return false;
  }
  const hasIssuedAt = typeof transaction.affiliateAttributionAt === 'string';
  const hasExpiresAt = typeof transaction.affiliateAttributionExpiresAt === 'string';
  // Historical confirmed transactions predate signed attribution metadata.
  if (!hasIssuedAt && !hasExpiresAt) return true;
  if (!hasIssuedAt || !hasExpiresAt) return false;

  const issuedAt = Date.parse(transaction.affiliateAttributionAt!);
  const expiresAt = Date.parse(transaction.affiliateAttributionExpiresAt!);
  const checkoutAt = Date.parse(transaction.createdAt);
  return Number.isFinite(issuedAt) &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(checkoutAt) &&
    expiresAt > issuedAt &&
    expiresAt - issuedAt <= MAX_ATTRIBUTION_DAYS * DAY_MS &&
    checkoutAt >= issuedAt - 30 * 1000 &&
    checkoutAt <= expiresAt;
}

function calculateCommissionRateFromRecords(
  affiliate: AffiliateAccount,
  articleId: string,
  settings: AffiliateSettings,
  campaign?: AffiliateCampaign,
  literaryCircleSettings?: LiteraryCircleSettings,
  monthlyVerifiedSales = 0,
  transactionAt = new Date().toISOString()
): number {
  return resolveAffiliateCommissionRate({
    affiliate,
    articleId,
    affiliateSettings: settings,
    campaign,
    literaryCircleSettings,
    monthlyVerifiedSales,
    transactionAt
  }).rate;
}

// In-Memory state
let cachedAffiliates: AffiliateAccount[] = [];
let cachedCommissions: AffiliateSaleCommission[] = [];
let cachedClicks: AffiliateClickEvent[] = [];
let cachedPayouts: AffiliatePayoutRequest[] = [];
let cachedCampaigns: AffiliateCampaign[] = [];
let cachedSettings: AffiliateSettings = normalizeAffiliateSettings(undefined);
let cachedLiteraryCircleSettings: LiteraryCircleSettings = normalizeLiteraryCircleSettings(
  DEFAULT_LITERARY_CIRCLE_SETTINGS
);
let cachedAuditLogs: AffiliateAuditLogEntry[] = [];
let cachedSessions: Map<string, AffiliateSession> = new Map();
let cachedSessionVerifiedAt: Map<string, number> = new Map();
let sessionLookupPromises: Map<string, Promise<AffiliateAccount | null>> = new Map();
let missingSessions: Map<string, number> = new Map();
let affiliateSessionInvalidationEpochs: Map<string, number> = new Map();
let affiliateDirectoryReady = false;

const AFFILIATE_SESSION_CACHE_TTL_MS = 60 * 1000;
const MISSING_AFFILIATE_SESSION_CACHE_TTL_MS = 30 * 1000;
const MAX_MISSING_AFFILIATE_SESSION_CACHE_ENTRIES = 1000;

function writeJsonFileSync(filePath: string, data: any) {
  if (process.env.VERCEL) return;
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const newContent = JSON.stringify(data, null, 2);
    if (fs.existsSync(filePath)) {
      try {
        const currentContent = fs.readFileSync(filePath, 'utf-8');
        if (currentContent === newContent) {
          return; // Skip redundant disk write
        }
      } catch {}
    }
    const tempFile = `${filePath}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, newContent, 'utf-8');
    fs.renameSync(tempFile, filePath);
  } catch (err) {
    console.error(`[AffiliateStore] Error writing to ${filePath}:`, err);
  }
}

function publishLiteraryCircleSettingsSnapshot(value: unknown): LiteraryCircleSettings {
  const next = normalizeLiteraryCircleSettings(value);
  const currentRevision = cachedLiteraryCircleSettings.revision || 0;
  const nextRevision = next.revision || 0;
  if (nextRevision >= currentRevision) {
    cachedLiteraryCircleSettings = next;
    writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
  }
  return normalizeLiteraryCircleSettings(cachedLiteraryCircleSettings);
}

/** Project committed campaign snapshots only; never write these projections back
 * to Firestore. Financial counters currently grow only through positive atomic
 * increments, independently of the writer-owned configuration revision. */
export function publishCommittedAffiliateCampaignSnapshot(value: AffiliateCampaign): AffiliateCampaign {
  const index = cachedCampaigns.findIndex(campaign => campaign.id === value.id);
  const current = index >= 0 ? cachedCampaigns[index] : undefined;
  const revision = (campaign: AffiliateCampaign) => Number.isSafeInteger(campaign.revision) && Number(campaign.revision) >= 0 ? Number(campaign.revision) : 0;
  const newer = current && (revision(current) > revision(value)
    || (revision(current) === revision(value) && Date.parse(current.updatedAt || '') > Date.parse(value.updatedAt || '')))
    ? current : value;
  const projected = structuredClone(newer);
  if (current) {
    for (const field of ['clicksCount', 'salesCount', 'revenueKes', 'commissionsKes'] as const) {
      const left = current[field];
      const right = value[field];
      if (typeof left === 'number' && Number.isFinite(left) && left >= 0
        && typeof right === 'number' && Number.isFinite(right) && right >= 0) projected[field] = Math.max(left, right);
    }
  }
  if (index >= 0) cachedCampaigns[index] = projected;
  else cachedCampaigns.unshift(projected);
  writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
  return structuredClone(projected);
}

export function sanitizeAffiliateForResponse(affiliate: AffiliateAccount): AffiliatePublicProfile {
  const {
    passwordHash: _passwordHash,
    sessionVersion: _sessionVersion,
    ...safeAffiliate
  } = affiliate;
  return safeAffiliate;
}

function sanitizeAuditValue(value: any): any {
  if (Array.isArray(value)) return value.map(sanitizeAuditValue);
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(password|secret|token|sessionVersion|affiliateBuyerAnalytics|affiliateConversionEvidence|sourceClick)/i.test(key))
      .map(([key, nestedValue]) => [key, sanitizeAuditValue(nestedValue)])
  );
}

function persistAffiliateSessionCache() {
  // Keys are one-way identifiers. Cookie tokens are never stored on disk.
  writeJsonFileSync(AFFILIATE_SESSIONS_FILE, Object.fromEntries(cachedSessions));
}

function rememberMissingAffiliateSession(documentId: string, now = Date.now()) {
  if (missingSessions.size >= MAX_MISSING_AFFILIATE_SESSION_CACHE_ENTRIES) {
    missingSessions.clear();
  }
  missingSessions.set(documentId, now + MISSING_AFFILIATE_SESSION_CACHE_TTL_MS);
}

function forgetCachedAffiliateSession(documentId: string, rememberMissing = false): void {
  cachedSessions.delete(documentId);
  cachedSessionVerifiedAt.delete(documentId);
  if (rememberMissing) rememberMissingAffiliateSession(documentId);
}

function forgetCachedAffiliateSessionsForAffiliate(affiliateId: string): number {
  affiliateSessionInvalidationEpochs.set(
    affiliateId,
    (affiliateSessionInvalidationEpochs.get(affiliateId) || 0) + 1
  );
  let invalidated = 0;
  for (const [documentId, session] of cachedSessions) {
    if (session.affiliateId !== affiliateId) continue;
    forgetCachedAffiliateSession(documentId, true);
    invalidated++;
  }
  if (invalidated > 0) persistAffiliateSessionCache();
  return invalidated;
}

function cacheFreshAffiliateRecord(id: string, fresh: AffiliateAccount | null): AffiliateAccount | undefined {
  const index = cachedAffiliates.findIndex(affiliate => affiliate.id === id);
  if (!fresh) {
    if (index >= 0) {
      cachedAffiliates.splice(index, 1);
      writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    }
    return undefined;
  }

  const refreshed: AffiliateAccount = { ...fresh, id };
  if (index >= 0 && (cachedAffiliates[index].walletRevision || 0) > (refreshed.walletRevision || 0)) {
    return cachedAffiliates[index];
  }
  if (index >= 0) {
    cachedAffiliates[index] = refreshed;
  } else {
    cachedAffiliates.unshift(refreshed);
  }
  writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
  return refreshed;
}

function financialSnapshotIsOutdated(snapshot: AffiliateFinancialSnapshot): boolean {
  // Compare only against commits already observed locally, never substitute
  // cached balances for database facts or publish a read into mutable caches.
  return [
    [snapshot.affiliates, cachedAffiliates],
    [snapshot.commissions, cachedCommissions],
    [snapshot.payouts, cachedPayouts],
  ].some(([freshRows, knownRows]) => freshRows.some(row => {
    const known = knownRows.find(candidate => candidate.id === row.id);
    return (known?.walletRevision || 0) > (row.walletRevision || 0);
  }));
}

function financialCircleSettings(snapshot: AffiliateFinancialSnapshot): LiteraryCircleSettings {
  return normalizeLiteraryCircleSettings(snapshot.literaryCircleSettings || {
    ...DEFAULT_LITERARY_CIRCLE_SETTINGS, enabled: false,
    community: { ...DEFAULT_LITERARY_CIRCLE_SETTINGS.community, enabled: false },
  });
}

type AffiliateProfileRecord = AffiliateAccount & { profileRevision?: number };

export class AffiliateProfileValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) { super(message); this.name = 'AffiliateProfileValidationError'; }
}

function affiliateProfileCommitFailure(error: unknown): never {
  if (error instanceof AffiliateProfileValidationError || error instanceof AffiliateWalletValidationError) throw error;
  const failure = new Error('Affiliate profile changes could not be committed. Please retry.');
  Object.assign(failure, { statusCode: 503 });
  throw failure;
}

function validateAffiliateProfileTarget(id: string, actor: string) {
  if (!walletIdentifier(id)) throw new AffiliateProfileValidationError('A valid affiliate identifier is required.');
  if (typeof actor !== 'string' || !actor.trim() || actor.length > 200 || /[\u0000-\u001f\u007f]/.test(actor)) {
    throw new AffiliateProfileValidationError('A valid profile-change actor is required.');
  }
}

function profileText(value: unknown, label: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value)
    || (!allowEmpty && !value.trim())) throw new AffiliateProfileValidationError(`${label} is invalid.`);
  return value.trim();
}

function validateAffiliateProfilePatch(patch: Partial<AffiliateAccount>): Partial<AffiliateAccount> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    throw new AffiliateProfileValidationError('Affiliate profile changes must be an object.');
  }
  if (Object.keys(patch).some(key => /^(balance|total|wallet|activePayout|payoutPaid|payoutReserved|reservedPayout)/i.test(key))) {
    throw new AffiliateWalletValidationError('Wallet balances and financial records cannot be changed through profile edits. Use the audited wallet workflow.');
  }
  // Credentials, reserved identities, approval and membership fields remain
  // outside this API, including when older clients submit their full model.
  const safe: Partial<AffiliateAccount> = {};
  if (patch.name !== undefined) safe.name = profileText(patch.name, 'Affiliate name', 120, false);
  if (patch.phone !== undefined) safe.phone = profileText(patch.phone, 'Affiliate phone', 40);
  if (patch.notes !== undefined) safe.notes = profileText(patch.notes, 'Affiliate notes', 2_000);
  if (patch.customCommissionRate !== undefined) {
    if (patch.customCommissionRate !== null && (typeof patch.customCommissionRate !== 'number'
      || !Number.isFinite(patch.customCommissionRate) || patch.customCommissionRate <= 0 || patch.customCommissionRate > 100)) {
      throw new AffiliateProfileValidationError('Custom commission must be greater than zero and at most 100, or null to inherit the programme rate.');
    }
    safe.customCommissionRate = patch.customCommissionRate;
  }
  if (patch.attributionDays !== undefined) {
    if (patch.attributionDays !== null && (!Number.isSafeInteger(patch.attributionDays)
      || patch.attributionDays < 1 || patch.attributionDays > MAX_ATTRIBUTION_DAYS)) {
      throw new AffiliateProfileValidationError('Attribution days must be between 1 and 90, or null to inherit the programme window.');
    }
    safe.attributionDays = patch.attributionDays;
  }
  if (patch.payoutMethod !== undefined) {
    if (!['mpesa', 'bank', 'paypal'].includes(patch.payoutMethod)) throw new AffiliateProfileValidationError('Payout method is invalid.');
    safe.payoutMethod = patch.payoutMethod;
  }
  if (patch.payoutDetails !== undefined) {
    const details = patch.payoutDetails;
    if (!details || typeof details !== 'object' || Array.isArray(details)) throw new AffiliateProfileValidationError('Payout details must be an object.');
    const allowed = new Set(['mpesaPhone', 'mpesaName', 'bankName', 'bankAccountNumber', 'bankAccountName', 'bankBranch', 'bankSwiftCode', 'paypalEmail', 'notes']);
    if (Object.keys(details).some(key => !allowed.has(key))) throw new AffiliateProfileValidationError('Payout details contain unsupported fields.');
    safe.payoutDetails = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, profileText(value, `Payout ${key}`, key === 'notes' ? 2_000 : 200)]));
  }
  if (patch.allowedPieceIds !== undefined) {
    if (!Array.isArray(patch.allowedPieceIds) || patch.allowedPieceIds.length > 500
      || patch.allowedPieceIds.some(id => !walletIdentifier(id))) throw new AffiliateProfileValidationError('Allowed pieces must be a bounded list of valid piece identifiers.');
    safe.allowedPieceIds = [...new Set(patch.allowedPieceIds)];
  }
  if (patch.acceptedTerms !== undefined) {
    if (typeof patch.acceptedTerms !== 'boolean') throw new AffiliateProfileValidationError('Terms acceptance must be a boolean.');
    safe.acceptedTerms = patch.acceptedTerms;
  }
  if (patch.termsVersion !== undefined) safe.termsVersion = profileText(patch.termsVersion, 'Terms version', 80, false);
  for (const field of ['termsAcceptedAt', 'lastLoginAt'] as const) {
    if (patch[field] === undefined) continue;
    const value = patch[field];
    if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))
      || Date.parse(value) > Date.now() + 5 * 60_000) throw new AffiliateProfileValidationError(`${field} must be a valid current or past timestamp.`);
    safe[field] = new Date(value).toISOString();
  }
  return safe;
}

function nextAffiliateProfileRevision(record: AffiliateProfileRecord): number {
  const revision = record.profileRevision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER) {
    throw new AffiliateProfileValidationError('Affiliate profile history requires writer review.');
  }
  return revision + 1;
}

function readAffiliateProfileRecord(data: unknown, id: string): AffiliateProfileRecord {
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || ((data as AffiliateAccount).id !== undefined && (data as AffiliateAccount).id !== id)) {
    throw new AffiliateProfileValidationError('Affiliate profile requires writer review.');
  }
  const record = { ...data, id } as AffiliateProfileRecord;
  nextAffiliateProfileRevision(record);
  return record;
}

function affiliateProfileAudit(actor: string, action: string, previous: AffiliateProfileRecord,
  next: AffiliateProfileRecord, fields: string[]): AffiliateAuditLogEntry {
  const selected = (record: AffiliateProfileRecord) => Object.fromEntries(fields
    .filter(field => Object.prototype.hasOwnProperty.call(record, field))
    .map(field => [field, record[field as keyof AffiliateProfileRecord]]));
  return {
    id: `aud_profile_${crypto.randomBytes(16).toString('hex')}`, timestamp: next.updatedAt,
    actor, action, targetType: 'affiliate', targetId: next.id,
    summary: action === 'affiliate_archived'
      ? 'Suspended affiliate account and referral activity; identity and all historical records preserved.'
      : 'Committed affiliate profile/settings changes.',
    previousValue: sanitizeAuditValue(selected(previous)), newValue: sanitizeAuditValue(selected(next))
  };
}

function publishAffiliateProfileCommit(saved: AffiliateProfileRecord, sessionVersionAtStart: string | undefined): AffiliateAccount {
  const index = cachedAffiliates.findIndex(row => row.id === saved.id);
  const current = cachedAffiliates[index] as AffiliateProfileRecord | undefined;
  if (current && (current.profileRevision || 0) > (saved.profileRevision || 0)) return current;
  const published = { ...saved };
  if (current) {
    // A wallet or session operation may have committed while this profile
    // response was in flight. Do not publish an older non-profile snapshot.
    if ((current.walletRevision || 0) > (saved.walletRevision || 0)) {
      for (const field of ['walletLedgerVersion', 'walletRevision', 'balanceAvailableKes', 'balancePendingKes',
        'balanceReservedKes', 'activePayoutId', 'totalCommissionEarnedKes', 'totalCommissionPaidKes',
        'totalCommissionReversedKes'] as const) {
        if (current[field] !== undefined) Object.assign(published, { [field]: current[field] });
        else Reflect.deleteProperty(published, field);
      }
    }
    for (const field of ['totalClicks', 'uniqueVisitors', 'totalSalesCount', 'totalRevenueKes'] as const) {
      if (Number.isFinite(current[field]) && current[field] > (published[field] || 0)) published[field] = current[field];
    }
    for (const field of ['lastLoginAt', 'lastActivityAt', 'lastReferralAt', 'lastVerifiedSaleAt', 'lastDashboardAt'] as const) {
      if (Date.parse(current[field] || '') > (Date.parse(published[field] || '') || 0)) published[field] = current[field];
    }
    if (current.sessionVersion !== sessionVersionAtStart) {
      for (const field of ['sessionVersion', 'passwordHash', 'status', 'linksDisabled'] as const) {
        if (current[field] !== undefined) Object.assign(published, { [field]: current[field] });
        else Reflect.deleteProperty(published, field);
      }
    }
  }
  if (index >= 0) cachedAffiliates[index] = published;
  else cachedAffiliates.unshift(published);
  writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
  return published;
}

export const affiliateStore = {
  async init() {
    if (!process.env.VERCEL && !fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    cachedSessions.clear();
    cachedSessionVerifiedAt.clear();
    sessionLookupPromises.clear();
    missingSessions.clear();
    affiliateSessionInvalidationEpochs.clear();
    affiliateDirectoryReady = false;
    cachedLiteraryCircleSettings = normalizeLiteraryCircleSettings(DEFAULT_LITERARY_CIRCLE_SETTINGS);

    // Start independent Firestore reads together. These collections do not
    // depend on one another, and awaiting them serially adds several network
    // round trips to every cold serverless instance.
    type StartupRead<T> =
      | { ok: true; value: T }
      | { ok: false; error: unknown };
    const captureStartupRead = <T>(promise: Promise<T>): Promise<StartupRead<T>> =>
      promise.then(
        value => ({ ok: true, value }),
        error => ({ ok: false, error })
      );
    const useStartupRead = async <T>(pending: Promise<StartupRead<T>>): Promise<T> => {
      const result = await pending;
      if (result.ok === false) throw result.error;
      return result.value;
    };
    const startupReads = {
      settings: captureStartupRead(getFirestoreDoc<AffiliateSettings>('site_configs', 'affiliate_settings')),
      literaryCircleSettings: captureStartupRead(
        getFirestoreDoc<LiteraryCircleSettings>('site_configs', LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID)
      ),
      affiliates: captureStartupRead(getAllFirestoreDocs<AffiliateAccount>('affiliates')),
      commissions: captureStartupRead(getAllFirestoreDocs<AffiliateSaleCommission>('affiliate_commissions')),
      payouts: captureStartupRead(getAllFirestoreDocs<AffiliatePayoutRequest>('affiliate_payouts')),
      campaigns: captureStartupRead(getAllFirestoreDocs<AffiliateCampaign>('affiliate_campaigns')),
      audit: captureStartupRead(getAllFirestoreDocs<AffiliateAuditLogEntry>('affiliate_audit'))
    };

    // 1. Load Settings from Firestore / JSON
    try {
      const fsSettings = await useStartupRead(startupReads.settings);
      if (fsSettings) {
        cachedSettings = normalizeAffiliateSettings({ ...cachedSettings, ...fsSettings });
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
      } else if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        cachedSettings = normalizeAffiliateSettings({ ...cachedSettings, ...JSON.parse(raw) });
      } else {
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
      }
    } catch {
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    }

    // Literary Circle policy is stored separately from legacy commission
    // settings so enabling the programme cannot rewrite an established rate.
    try {
      const persistedCircleSettings = await useStartupRead(startupReads.literaryCircleSettings);
      if (persistedCircleSettings) {
        cachedLiteraryCircleSettings = normalizeLiteraryCircleSettings(persistedCircleSettings);
        writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
      } else if (fs.existsSync(LITERARY_CIRCLE_SETTINGS_FILE)) {
        const raw = fs.readFileSync(LITERARY_CIRCLE_SETTINGS_FILE, 'utf-8');
        cachedLiteraryCircleSettings = normalizeLiteraryCircleSettings(JSON.parse(raw));
      } else {
        writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
      }
    } catch (error) {
      console.warn('[AffiliateStore] Error loading Literary Circle settings:', error);
      writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
    }

    // 2. Load Affiliates from Firestore / JSON
    try {
      const fsAffiliates = await useStartupRead(startupReads.affiliates);
      if (fsAffiliates && fsAffiliates.length > 0) {
        cachedAffiliates = fsAffiliates.map(a => ({
          ...a,
          acceptedTerms: a.acceptedTerms !== undefined ? a.acceptedTerms : true
        }));
        writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
      } else if (fs.existsSync(AFFILIATES_FILE)) {
        const raw = fs.readFileSync(AFFILIATES_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          cachedAffiliates = parsed.map(a => ({
            ...a,
            acceptedTerms: a.acceptedTerms !== undefined ? a.acceptedTerms : true
          }));
          // Display-only local fallback. Cloud recovery requires an explicitly
          // reviewed backup restore, never startup upload of a stale snapshot.
        }
      } else {
        cachedAffiliates = [];
        writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
      }
      affiliateDirectoryReady = true;
    } catch (e) {
      console.warn('[AffiliateStore] Error loading affiliates:', e);
    }

    // 3. Load Commissions from Firestore / JSON
    try {
      const fsCommissions = await useStartupRead(startupReads.commissions);
      if (fsCommissions && fsCommissions.length > 0) {
        cachedCommissions = fsCommissions;
        writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
      } else if (fs.existsSync(COMMISSIONS_FILE)) {
        const raw = fs.readFileSync(COMMISSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedCommissions = Array.isArray(parsed) ? parsed : [];
        // Never resurrect financial records from a local display snapshot.
      } else {
        cachedCommissions = [];
        writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
      }
    } catch {
      cachedCommissions = [];
    }

    // 4. Load Payouts from Firestore / JSON
    try {
      const fsPayouts = await useStartupRead(startupReads.payouts);
      if (fsPayouts && fsPayouts.length > 0) {
        cachedPayouts = fsPayouts;
        writeJsonFileSync(PAYOUTS_FILE, cachedPayouts);
      } else if (fs.existsSync(PAYOUTS_FILE)) {
        const raw = fs.readFileSync(PAYOUTS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedPayouts = Array.isArray(parsed) ? parsed : [];
        // Never resurrect payout records from a local display snapshot.
      } else {
        cachedPayouts = [];
        writeJsonFileSync(PAYOUTS_FILE, cachedPayouts);
      }
    } catch {
      cachedPayouts = [];
    }

    // 5. Load Campaigns from Firestore / JSON
    try {
      const fsCampaigns = await useStartupRead(startupReads.campaigns);
      if (fsCampaigns && fsCampaigns.length > 0) {
        cachedCampaigns = fsCampaigns;
        writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
      } else if (fs.existsSync(CAMPAIGNS_FILE)) {
        const raw = fs.readFileSync(CAMPAIGNS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedCampaigns = Array.isArray(parsed) ? parsed : [];
        // Local snapshots are display projections, not authority to resurrect
        // or overwrite campaigns. Restoring cloud data requires a reviewed
        // backup/migration, never an automatic startup write.
      } else {
        cachedCampaigns = [];
        writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
      }
    } catch {
      cachedCampaigns = [];
    }

    // 6. Load Audit Logs from Firestore / JSON
    try {
      const fsAudit = await useStartupRead(startupReads.audit);
      if (fsAudit && fsAudit.length > 0) {
        cachedAuditLogs = fsAudit;
        writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
      } else if (fs.existsSync(AUDIT_FILE)) {
        const raw = fs.readFileSync(AUDIT_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedAuditLogs = Array.isArray(parsed) ? parsed : [];
        // Audit/receipt claims must originate from committed transactions.
        // A local snapshot is not authority to create immutable cloud evidence.
      } else {
        cachedAuditLogs = [];
        writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
      }
    } catch {
      cachedAuditLogs = [];
    }

    // 7. Load Clicks
    if (fs.existsSync(CLICKS_FILE)) {
      try {
        const raw = fs.readFileSync(CLICKS_FILE, 'utf-8');
        cachedClicks = JSON.parse(raw);
      } catch {
        cachedClicks = [];
      }
    }

    // 8. Load only v2 hashed session records for local development. Former
    // raw-token affiliate sessions are deliberately not imported: production
    // never persisted them, so one honest re-authentication is required.
    if (!process.env.VERCEL && fs.existsSync(AFFILIATE_SESSIONS_FILE)) {
      try {
        const raw = fs.readFileSync(AFFILIATE_SESSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        let removedInvalidRecord = false;
        if (parsed && typeof parsed === 'object') {
          for (const [documentId, value] of Object.entries(parsed)) {
            const session = normalizeAffiliateSessionRecord(value);
            if (isAffiliateSessionDocumentId(documentId) && session && session.expiresAt > Date.now()) {
              cachedSessions.set(documentId, session);
              cachedSessionVerifiedAt.set(documentId, 0);
            } else {
              removedInvalidRecord = true;
            }
          }
        }
        if (removedInvalidRecord) persistAffiliateSessionCache();
      } catch (error) {
        console.warn('[Affiliate Auth] Error loading local v2 affiliate sessions:', error);
      }
    }
  },

  // SETTINGS
  getSettings(): AffiliateSettings {
    return { ...cachedSettings };
  },

  async getSettingsFresh(): Promise<AffiliateSettings> {
    const persisted = await getFirestoreDoc<AffiliateSettings>('site_configs', 'affiliate_settings');
    if (persisted) {
      cachedSettings = normalizeAffiliateSettings(persisted);
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    }
    return { ...cachedSettings };
  },

  async saveSettings(patch: Partial<AffiliateSettings>, actor = 'Admin'): Promise<AffiliateSettings> {
    validateAffiliateSettingsPatch(patch);
    const prev = { ...cachedSettings };
    const next = normalizeAffiliateSettings({
      ...cachedSettings,
      ...patch,
      pieceCommissionOverrides: patch.pieceCommissionOverrides !== undefined
        ? patch.pieceCommissionOverrides
        : (cachedSettings.pieceCommissionOverrides || {})
    });
    // Do not acknowledge or publish an in-memory value until the source of
    // truth has committed. This prevents a cold instance from immediately
    // restoring the previous threshold after a reported successful save.
    await setFirestoreDoc('site_configs', 'affiliate_settings', next);
    cachedSettings = next;
    writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    this.recordAudit(actor, 'settings_updated', 'settings', 'Updated affiliate global configuration', undefined, prev, cachedSettings);
    return { ...cachedSettings };
  },

  getLiteraryCircleSettings(): LiteraryCircleSettings {
    return normalizeLiteraryCircleSettings(cachedLiteraryCircleSettings);
  },

  async getLiteraryCircleSettingsFresh(): Promise<LiteraryCircleSettings> {
    const persisted = await getFirestoreDoc<LiteraryCircleSettings>(
      'site_configs',
      LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID
    );
    if (persisted) {
      // A read that started before a successful writer transaction can finish
      // afterward. Never let that older snapshot regress the process cache or
      // briefly republish content that the writer has just removed.
      publishLiteraryCircleSettingsSnapshot(persisted);
    } else {
      // A deleted policy document must fail closed instead of reviving a
      // previously cached entitlement configuration on a warm instance.
      cachedLiteraryCircleSettings = normalizeLiteraryCircleSettings({
        ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
        enabled: false,
        community: {
          ...DEFAULT_LITERARY_CIRCLE_SETTINGS.community,
          enabled: false
        }
      });
      writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
    }
    return normalizeLiteraryCircleSettings(cachedLiteraryCircleSettings);
  },

  async saveLiteraryCircleSettings(
    value: LiteraryCircleSettings,
    actor = 'Admin',
    expectedRevision = value.revision
  ): Promise<LiteraryCircleSettings> {
    const validated = validateLiteraryCircleSettings(value);
    const preserveExistingCommunityPosts = !Object.prototype.hasOwnProperty.call(
      value.community,
      'posts'
    );
    const preserveExistingOnboarding = !Object.prototype.hasOwnProperty.call(value, 'onboardingContent');
    const now = new Date().toISOString();
    const requestedRevision = Number.isSafeInteger(expectedRevision) && Number(expectedRevision) >= 0
      ? Number(expectedRevision)
      : 0;
    const settingsDb = getDb();
    const settingsReference = settingsDb
      .collection('site_configs')
      .doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID);
    const persisted = await settingsDb.runTransaction(async firestoreTransaction => {
      const snapshot = await firestoreTransaction.get(settingsReference);
      const previous = normalizeLiteraryCircleSettings(
        snapshot.exists
          ? snapshot.data()
          : {
              ...DEFAULT_LITERARY_CIRCLE_SETTINGS,
              enabled: false,
              community: {
                ...DEFAULT_LITERARY_CIRCLE_SETTINGS.community,
                enabled: false
              }
            }
      );
      const currentRevision = previous.revision || 0;
      if (currentRevision !== requestedRevision) {
        throw new LiteraryCircleSettingsConflictError();
      }

      // Clients released before the private bulletin did not send `posts`.
      // Preserve the durable list for those otherwise-valid saves instead of
      // treating an omitted, newly-added field as an instruction to erase it.
      const requested = normalizeLiteraryCircleSettings({
        ...validated,
        ...(preserveExistingOnboarding ? { onboardingContent: previous.onboardingContent } : {}),
        ...(preserveExistingCommunityPosts ? {
          community: {
            ...validated.community,
            posts: previous.community.posts || []
          }
        } : {})
      });

      const policyChanged = isLiteraryCircleCommissionPolicyChange(previous, requested);
      const policyVersion = policyChanged
        ? previous.commissionPolicy.version + 1
        : previous.commissionPolicy.version;
      const isConfirmedPolicyLifecycleChange = policyChanged && (
        previous.commissionPolicy.status === 'active'
        || requested.commissionPolicy.status === 'active'
      );
      let effectiveAt = requested.commissionPolicy.effectiveAt;
      if (isConfirmedPolicyLifecycleChange && requested.commissionPolicy.status === 'draft') {
        effectiveAt = now;
      }
      if (isConfirmedPolicyLifecycleChange && requested.commissionPolicy.status === 'active') {
        const effectiveTime = Date.parse(effectiveAt || '');
        if (!Number.isFinite(effectiveTime) || effectiveTime < Date.parse(now) - 5 * 60_000) {
          throw new LiteraryCircleValidationError(
            'Choose a current or future effective date for this commission-policy change.'
          );
        }
      }
      const nextPolicySettings = normalizeLiteraryCircleSettings({
        ...requested,
        revision: currentRevision + 1,
        commissionPolicy: {
          ...requested.commissionPolicy,
          version: policyVersion,
          ...(effectiveAt ? { effectiveAt } : {})
        },
        updatedAt: now,
        updatedBy: actor
      });
      const policyHistory = [...(previous.commissionPolicyHistory || [])];
      const appendSnapshot = (snapshotValue: ReturnType<typeof createLiteraryCircleCommissionPolicySnapshot>) => {
        const existingIndex = policyHistory.findIndex(entry => entry.version === snapshotValue.version);
        if (existingIndex >= 0) policyHistory[existingIndex] = snapshotValue;
        else policyHistory.push(snapshotValue);
      };
      if (isConfirmedPolicyLifecycleChange) {
        if (
          previous.commissionPolicy.status === 'active'
          && previous.commissionPolicy.effectiveAt
          && !policyHistory.some(snapshotValue => snapshotValue.version === previous.commissionPolicy.version)
        ) {
          appendSnapshot(createLiteraryCircleCommissionPolicySnapshot(previous, {
            effectiveAt: previous.commissionPolicy.effectiveAt,
            confirmedAt: previous.updatedAt || previous.commissionPolicy.effectiveAt,
            confirmedBy: previous.updatedBy || 'System'
          }));
        }
        appendSnapshot(createLiteraryCircleCommissionPolicySnapshot(nextPolicySettings, {
          effectiveAt: effectiveAt || now,
          confirmedAt: now,
          confirmedBy: actor
        }));
      }
      if (policyHistory.length > 256) {
        throw new LiteraryCircleValidationError(
          'Commission policy history is full. Archive it safely before publishing another financial policy.'
        );
      }
      const next = normalizeLiteraryCircleSettings({
        ...nextPolicySettings,
        commissionPolicyHistory: policyHistory
      });
      const audit: AffiliateAuditLogEntry = {
        id: literaryCircleNotificationAuditId(next.revision || 0), timestamp: now,
        actor, action: 'literary_circle_settings_updated', targetType: 'settings',
        targetId: LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
        summary: 'Updated Literary Circle configuration',
        previousValue: sanitizeAuditValue(previous), newValue: sanitizeAuditValue(next),
      };
      firestoreTransaction.set(settingsReference, next, { merge: false });
      firestoreTransaction.create(settingsDb.collection('affiliate_audit').doc(audit.id), audit);
      return { previous, next, audit };
    }).catch(error => {
      if (error instanceof LiteraryCircleSettingsConflictError || error instanceof LiteraryCircleValidationError) throw error;
      throw new Error('Literary Circle settings could not be committed. Please retry.');
    });

    // Publish the process-local copy only after the atomic source-of-truth
    // write succeeds. A stale editor therefore cannot revive old content.
    const published = publishLiteraryCircleSettingsSnapshot(persisted.next);
    this.rememberCommittedAudit(persisted.audit);
    return published;
  },

  // AFFILIATES CRUD
  getAffiliates(filter?: { status?: string }): AffiliatePublicProfile[] {
    const defaultRate = cachedSettings.defaultCommissionRate || 15;
    let list = cachedAffiliates.map(a => ({
      ...sanitizeAffiliateForResponse(a),
      commissionRate: (a.customCommissionRate !== null && a.customCommissionRate !== undefined && a.customCommissionRate > 0)
        ? a.customCommissionRate
        : defaultRate
    }));
    if (filter?.status) {
      list = list.filter(a => a.status === filter.status);
    }
    return list;
  },

  getAffiliateById(id: string): AffiliateAccount | undefined {
    const aff = cachedAffiliates.find(a => a.id === id);
    if (!aff) return undefined;
    const defaultRate = cachedSettings.defaultCommissionRate || 15;
    return {
      ...aff,
      commissionRate: (aff.customCommissionRate !== null && aff.customCommissionRate !== undefined && aff.customCommissionRate > 0)
        ? aff.customCommissionRate
        : defaultRate
    };
  },

  getAffiliateByCode(code: string): AffiliateAccount | undefined {
    if (!code) return undefined;
    const clean = code.trim().toUpperCase();
    return cachedAffiliates.find(a => a.affiliateCode.toUpperCase() === clean);
  },

  getAffiliateByEmail(email: string): AffiliateAccount | undefined {
    if (!email) return undefined;
    const clean = email.trim().toLowerCase();
    return cachedAffiliates.find(a => a.email.toLowerCase() === clean);
  },

  async getAffiliateForLoginFresh(login: unknown): Promise<AffiliateAccount | undefined> {
    try {
      const value = typeof login === 'string' ? login.trim() : '';
      const field = value.includes('@') ? 'email' : 'affiliateCode';
      const normalized = field === 'email' ? value.toLowerCase() : value.toUpperCase();
      const legacyCandidates = normalized ? cachedAffiliates.filter(account => {
        const identity = account[field];
        return typeof identity === 'string'
          && (field === 'email' ? identity.trim().toLowerCase() : identity.trim().toUpperCase()) === normalized;
      }) : [];
      if (legacyCandidates.length > 1) throw new AffiliateLoginIdentityUnavailableError();
      // Return the transaction's credential, not a cache projection selected by
      // wallet revision. Financial recency cannot authorize a stale password.
      return await readAffiliateLoginIdentity(getDb(), login, legacyCandidates[0]?.id);
    } catch {
      throw new AffiliateLoginIdentityUnavailableError();
    }
  },

  async getAffiliateByIdFresh(id: string): Promise<AffiliateAccount | undefined> {
    if (!id) return undefined;
    const fresh = await getFirestoreDoc<AffiliateAccount>('affiliates', id);
    cacheFreshAffiliateRecord(id, fresh);
    return this.getAffiliateById(id);
  },

  async updateLiteraryCircleMembership(
    id: string,
    patch: LiteraryCircleMembershipPatch,
    actor = 'Admin'
  ): Promise<AffiliateAccount> {
    if (!id) throw new Error('Affiliate id is required.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Literary Circle membership changes must be provided as an object.');
    }
    const allowedAccessStatuses = new Set<LiteraryCircleComplimentaryAccessStatus>([
      'active',
      'suspended',
      'revoked'
    ]);
    if (
      patch.complimentaryAccessStatus !== undefined
      && !allowedAccessStatuses.has(patch.complimentaryAccessStatus)
    ) {
      throw new Error('Literary Circle complimentary access status is invalid.');
    }
    if (patch.complimentaryAccessReason !== undefined && typeof patch.complimentaryAccessReason !== 'string') {
      throw new Error('Literary Circle complimentary access reason must be text.');
    }
    if (
      patch.manualTierId !== undefined
      && patch.manualTierId !== null
      && typeof patch.manualTierId !== 'string'
    ) {
      throw new Error('Literary Circle manual tier must be a stable tier identifier.');
    }

    const db = getDb();
    const persisted = await db.runTransaction(async firestoreTransaction => {
      const affiliateRef = db.collection('affiliates').doc(id);
      const settingsRef = db.collection('site_configs').doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID);
      const [affiliateSnapshot, settingsSnapshot] = await Promise.all([
        firestoreTransaction.get(affiliateRef),
        firestoreTransaction.get(settingsRef)
      ]);
      if (!affiliateSnapshot.exists) throw new Error('Affiliate not found.');

      const settings = normalizeLiteraryCircleSettings(
        settingsSnapshot.exists ? settingsSnapshot.data() : cachedLiteraryCircleSettings
      );
      const previousAffiliate: AffiliateAccount = {
        ...(affiliateSnapshot.data() as AffiliateAccount),
        id
      };
      const now = new Date().toISOString();
      const previousMembership = previousAffiliate.literaryCircle || createLiteraryCircleMembership({
        now: previousAffiliate.createdAt,
        settings,
        foundingMember: false,
        audience: 'existing_upgrade',
        actor
      });
      let nextMembership: AffiliateLiteraryCircleMembership = {
        ...previousMembership,
        complimentaryAccess: { ...previousMembership.complimentaryAccess },
        tier: { ...previousMembership.tier },
        onboarding: {
          ...previousMembership.onboarding,
          completedStepIds: [...previousMembership.onboarding.completedStepIds]
        }
      };

      if (patch.complimentaryAccessStatus !== undefined) {
        const reason = (patch.complimentaryAccessReason || '').trim().slice(0, 500);
        nextMembership = {
          ...nextMembership,
          complimentaryAccess: {
            ...nextMembership.complimentaryAccess,
            status: patch.complimentaryAccessStatus,
            updatedAt: now,
            updatedBy: actor,
            ...(reason ? { reason } : {})
          }
        };
        if (!reason) delete nextMembership.complimentaryAccess.reason;
      }

      if (patch.manualTierId !== undefined) {
        if (patch.manualTierId === null) {
          nextMembership = {
            ...nextMembership,
            tier: {
              id: settings.defaultTierId,
              assignedAt: now,
              source: 'default',
              policyVersion: settings.commissionPolicy.version
            }
          };
        } else {
          const requestedTierId = patch.manualTierId.trim().toLowerCase();
          const requestedTier = settings.tiers.find(tier => tier.enabled && tier.id === requestedTierId);
          if (!requestedTier) throw new Error('Literary Circle tier is unavailable or disabled.');
          nextMembership = {
            ...nextMembership,
            tier: {
              id: requestedTier.id,
              assignedAt: now,
              source: 'manual',
              policyVersion: settings.commissionPolicy.version
            }
          };
        }
      }

      // Recognition is permanent. A false value supplied by an older or
      // untrusted client is a no-op and can never erase a founding badge.
      if (patch.foundingMember === true && !nextMembership.foundingMember) {
        nextMembership = {
          ...nextMembership,
          foundingMember: true,
          foundingRecognizedAt: now
        };
      }

      const updatedAffiliate: AffiliateAccount = {
        ...previousAffiliate,
        literaryCircle: nextMembership,
        updatedAt: now
      };
      firestoreTransaction.update(affiliateRef, {
        literaryCircle: nextMembership,
        updatedAt: now
      });
      return {
        previousAffiliate,
        updatedAffiliate,
        settings
      };
    });

    publishLiteraryCircleSettingsSnapshot(persisted.settings);
    const updated = cacheFreshAffiliateRecord(id, persisted.updatedAffiliate);
    if (!updated) throw new Error('Affiliate not found.');
    this.recordAudit(
      actor,
      'literary_circle_membership_updated',
      'affiliate',
      `Updated Literary Circle membership for ${updated.name} (${updated.affiliateCode})`,
      id,
      persisted.previousAffiliate.literaryCircle,
      updated.literaryCircle
    );
    return this.getAffiliateById(id) || updated;
  },

  async updateLiteraryCircleOnboarding(
    id: string,
    patch: LiteraryCircleOnboardingPatch,
    actor = 'Affiliate'
  ): Promise<AffiliateAccount> {
    if (!id) throw new Error('Affiliate id is required.');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      throw new Error('Literary Circle onboarding changes must be provided as an object.');
    }
    const completedStepId = typeof patch.completedStepId === 'string'
      ? patch.completedStepId.trim()
      : undefined;
    if (
      completedStepId
      && !LITERARY_CIRCLE_ONBOARDING_STEPS.includes(
        completedStepId as typeof LITERARY_CIRCLE_ONBOARDING_STEPS[number]
      )
    ) {
      throw new Error('Literary Circle onboarding step is invalid.');
    }
    const allowedStatuses = new Set<LiteraryCircleOnboardingStatus>([
      'not_started',
      'in_progress',
      'completed',
      'dismissed'
    ]);
    if (patch.status !== undefined && !allowedStatuses.has(patch.status)) {
      throw new Error('Literary Circle onboarding status is invalid.');
    }
    if (!completedStepId && patch.status === undefined) {
      throw new Error('Complete an onboarding step or provide an onboarding status.');
    }

    const db = getDb();
    const persisted = await db.runTransaction(async firestoreTransaction => {
      const affiliateRef = db.collection('affiliates').doc(id);
      const settingsRef = db.collection('site_configs').doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID);
      const [affiliateSnapshot, settingsSnapshot] = await Promise.all([
        firestoreTransaction.get(affiliateRef),
        firestoreTransaction.get(settingsRef)
      ]);
      if (!affiliateSnapshot.exists) throw new Error('Affiliate not found.');

      const settings = normalizeLiteraryCircleSettings(
        settingsSnapshot.exists ? settingsSnapshot.data() : cachedLiteraryCircleSettings
      );
      const previousAffiliate: AffiliateAccount = {
        ...(affiliateSnapshot.data() as AffiliateAccount),
        id
      };
      const now = new Date().toISOString();
      const previousMembership = previousAffiliate.literaryCircle || createLiteraryCircleMembership({
        now: previousAffiliate.createdAt,
        settings,
        foundingMember: false,
        audience: 'existing_upgrade',
        actor
      });
      const completedStepIds = Array.from(new Set([
        ...previousMembership.onboarding.completedStepIds,
        ...(completedStepId ? [completedStepId] : [])
      ]));
      const allStepsComplete = LITERARY_CIRCLE_ONBOARDING_STEPS.every(step => completedStepIds.includes(step));
      const status = patch.status
        || (allStepsComplete ? 'completed' : 'in_progress');
      const onboarding: AffiliateLiteraryCircleMembership['onboarding'] = {
        ...previousMembership.onboarding,
        version: settings.onboardingVersion,
        status,
        completedStepIds,
        welcomeRequired: previousMembership.onboarding.welcomeRequired
          && completedStepId !== 'welcome'
          && status !== 'completed'
          && status !== 'dismissed',
        ...(previousMembership.onboarding.startedAt
          ? { startedAt: previousMembership.onboarding.startedAt }
          : (status !== 'not_started' ? { startedAt: now } : {})),
        ...(status === 'completed'
          ? { completedAt: previousMembership.onboarding.completedAt || now }
          : {})
      };
      if (status !== 'completed') delete onboarding.completedAt;

      const nextMembership: AffiliateLiteraryCircleMembership = {
        ...previousMembership,
        onboarding
      };
      const updatedAffiliate: AffiliateAccount = {
        ...previousAffiliate,
        literaryCircle: nextMembership,
        updatedAt: now
      };
      firestoreTransaction.update(affiliateRef, {
        literaryCircle: nextMembership,
        updatedAt: now
      });
      return {
        previousAffiliate,
        updatedAffiliate,
        settings
      };
    });

    publishLiteraryCircleSettingsSnapshot(persisted.settings);
    const updated = cacheFreshAffiliateRecord(id, persisted.updatedAffiliate);
    if (!updated) throw new Error('Affiliate not found.');
    this.recordAudit(
      actor,
      'literary_circle_onboarding_updated',
      'affiliate',
      `Updated Literary Circle onboarding for ${updated.name} (${updated.affiliateCode})`,
      id,
      persisted.previousAffiliate.literaryCircle?.onboarding,
      updated.literaryCircle?.onboarding
    );
    return this.getAffiliateById(id) || updated;
  },

  async hasComplimentaryCatalogueAccess(
    id: string,
    options: { forceFresh?: boolean } = {}
  ): Promise<boolean> {
    const affiliate = options.forceFresh
      ? await this.getAffiliateByIdFresh(id)
      : this.getAffiliateById(id);
    return cachedLiteraryCircleSettings.enabled && isAffiliateComplimentaryAccessActive(affiliate);
  },

  async createAffiliate(data: Partial<AffiliateAccount>, actor = 'System'): Promise<AffiliateAccount> {
    if (!affiliateDirectoryReady) {
      throw new Error('Affiliate registration is temporarily unavailable. Please retry later.');
    }
    const email = (data.email || '').trim().toLowerCase();
    if (!email) {
      throw new Error("Email address is required.");
    }
    if (this.getAffiliateByEmail(email)) {
      throw new Error(`An affiliate account with email ${email} already exists.`);
    }

    // Generate unique code if not provided
    let affiliateCode = (data.affiliateCode || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!affiliateCode) {
      const namePart = (data.name || 'AFF').trim().toUpperCase().split(/\s+/)[0].replace(/[^A-Z]/g, '').slice(0, 5);
      const randDigits = crypto.randomInt(100, 1000);
      affiliateCode = `${namePart || 'IW'}${randDigits}`;
    }

    // Existing legacy accounts predate the reservation index, so a complete
    // directory load remains part of the duplicate check during migration.
    if (this.getAffiliateByCode(affiliateCode)) {
      throw new Error('That affiliate code is already in use. Choose another code.');
    }

    const id = `aff_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();
    const requestedStatus = data.status || 'active';
    const requestedApprovalAt = typeof data.approvedAt === 'string' && Number.isFinite(Date.parse(data.approvedAt))
      ? new Date(data.approvedAt).toISOString()
      : undefined;
    const requestedApprovalBy = typeof data.approvedBy === 'string' && data.approvedBy.trim()
      ? data.approvedBy.trim().slice(0, 120)
      : undefined;
    const passwordHash = String(data.passwordHash || '').trim();
    if (!isCurrentAffiliatePasswordHash(passwordHash)) {
      throw new Error('A current Argon2id affiliate credential is required.');
    }

    const newAffiliate: AffiliateAccount = {
      id,
      affiliateCode,
      name: (data.name || '').trim(),
      email,
      phone: (data.phone || '').trim(),
      passwordHash,
      status: requestedStatus,
      ...(requestedStatus === 'active' && requestedApprovalAt && requestedApprovalBy
        ? { approvedAt: requestedApprovalAt, approvedBy: requestedApprovalBy }
        : {}),
      customCommissionRate: data.customCommissionRate !== undefined ? data.customCommissionRate : null,
      payoutMethod: data.payoutMethod || 'mpesa',
      payoutDetails: data.payoutDetails || {
        mpesaPhone: data.phone || '',
        mpesaName: data.name || ''
      },
      allowedPieceIds: Array.isArray(data.allowedPieceIds) ? data.allowedPieceIds : [],
      attributionDays: data.attributionDays !== undefined ? data.attributionDays : null,
      totalClicks: 0,
      uniqueVisitors: 0,
      totalSalesCount: 0,
      totalRevenueKes: 0,
      totalCommissionEarnedKes: 0,
      totalCommissionPaidKes: 0,
      balanceAvailableKes: 0,
      balancePendingKes: 0,
      linksDisabled: false,
      notes: data.notes || '',
      acceptedTerms: data.acceptedTerms !== undefined ? data.acceptedTerms : true,
      termsVersion: data.termsVersion || '2026.1',
      termsAcceptedAt: data.termsAcceptedAt || now,
      createdAt: now,
      updatedAt: now,
      literaryCircle: createLiteraryCircleMembership({
        now,
        settings: cachedLiteraryCircleSettings,
        foundingMember: false,
        audience: 'new_affiliate',
        actor
      }),
      sessionVersion: createAffiliateSessionVersion()
    };

    const db = getDb();
    const affiliateRef = db.collection('affiliates').doc(newAffiliate.id);
    const codeReservationRef = db.collection('affiliate_codes').doc(affiliateCode);
    const emailReservationId = crypto.createHash('sha256').update(email).digest('hex');
    const emailReservationRef = db.collection('affiliate_emails').doc(emailReservationId);
    await db.runTransaction(async firestoreTransaction => {
      const [codeReservation, emailReservation] = await Promise.all([
        firestoreTransaction.get(codeReservationRef),
        firestoreTransaction.get(emailReservationRef)
      ]);
      if (codeReservation.exists) {
        throw new Error('That affiliate code is already in use. Choose another code.');
      }
      if (emailReservation.exists) {
        throw new Error('An affiliate account already exists for that email address.');
      }
      firestoreTransaction.set(affiliateRef, newAffiliate, { merge: false });
      firestoreTransaction.set(codeReservationRef, {
        affiliateId: newAffiliate.id,
        affiliateCode,
        reservedAt: now
      }, { merge: false });
      firestoreTransaction.set(emailReservationRef, {
        affiliateId: newAffiliate.id,
        emailHash: emailReservationId,
        reservedAt: now
      }, { merge: false });
    });
    cachedAffiliates.unshift(newAffiliate);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    this.recordAudit(actor, 'affiliate_created', 'affiliate', `Created affiliate ${newAffiliate.name} (${newAffiliate.affiliateCode})`, id, null, newAffiliate);

    if (newAffiliate.status === 'active' && newAffiliate.approvedAt && newAffiliate.approvedBy) {
      await prepareCommittedAffiliateNotification({ db, kind: 'activation', sourceId: newAffiliate.id });
    }

    return newAffiliate;
  },

  async acceptAffiliateTerms(id: string, termsVersion = '2026.1', actor = 'Affiliate'): Promise<AffiliateAccount> {
    return this.updateAffiliate(id, {
      acceptedTerms: true,
      termsVersion,
      termsAcceptedAt: new Date().toISOString()
    }, actor);
  },

  async updateAffiliate(id: string, patch: Partial<AffiliateAccount>, actor = 'Admin'): Promise<AffiliateAccount> {
    validateAffiliateProfileTarget(id, actor);
    const safePatch = validateAffiliateProfilePatch(patch);
    const sessionVersionAtStart = cachedAffiliates.find(row => row.id === id)?.sessionVersion;
    let persisted: { affiliate: AffiliateProfileRecord; audit?: AffiliateAuditLogEntry };
    try {
      const db = getDb();
      const reference = db.collection('affiliates').doc(id);
      persisted = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) throw new AffiliateProfileValidationError('Affiliate not found.');
        const previous = readAffiliateProfileRecord(snapshot.data(), id);
        if (Object.keys(safePatch).length === 0) return { affiliate: previous };
        const persistencePatch: Partial<AffiliateProfileRecord> = {
          ...safePatch,
          ...(safePatch.payoutDetails ? {
            payoutDetails: { ...previous.payoutDetails, ...safePatch.payoutDetails }
          } : {}),
          ...(safePatch.lastLoginAt && Date.parse(previous.lastLoginAt || '') > Date.parse(safePatch.lastLoginAt)
            ? { lastLoginAt: previous.lastLoginAt } : {}),
          profileRevision: nextAffiliateProfileRevision(previous),
          updatedAt: new Date().toISOString()
        };
        const affiliate = { ...previous, ...persistencePatch };
        const audit = affiliateProfileAudit(actor, 'affiliate_updated', previous, affiliate, Object.keys(safePatch));
        // Patch only this allowlist. A fresh wallet, credential, membership or
        // session rotation can never be overwritten by a stale profile form.
        transaction.set(reference, persistencePatch, { merge: true });
        transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
        return { affiliate, audit };
      });
    } catch (error) {
      affiliateProfileCommitFailure(error);
    }
    const published = publishAffiliateProfileCommit(persisted.affiliate, sessionVersionAtStart);
    if (persisted.audit) this.rememberCommittedAudit(persisted.audit);
    return published;
  },

  async updateAffiliateCredential(
    id: string,
    passwordHash: string,
    actor = 'System',
    expectedVerifiedCredential?: { passwordHash: string; sessionVersion?: string },
  ): Promise<AffiliateAccount> {
    if (expectedVerifiedCredential !== undefined) {
      // Login-time migration is a compare-and-swap, not a password reset.
      // Never overwrite a credential or reactivation decision made after the
      // password was verified, including on another warm server instance.
      const changed = () => Object.assign(new Error('Your account changed while signing in. Please sign in again with the current password.'), {
        statusCode: 401, code: 'CREDENTIALS_CHANGED',
      });
      if (!walletIdentifier(id) || !expectedVerifiedCredential
        || typeof expectedVerifiedCredential.passwordHash !== 'string' || !expectedVerifiedCredential.passwordHash
        || (expectedVerifiedCredential.sessionVersion !== undefined && typeof expectedVerifiedCredential.sessionVersion !== 'string')) {
        throw changed();
      }
      if (!isCurrentAffiliatePasswordHash(passwordHash)) {
        throw new Error('A current Argon2id affiliate credential is required.');
      }
      const verifiedPasswordHash = expectedVerifiedCredential.passwordHash;
      const verifiedSessionVersion = expectedVerifiedCredential.sessionVersion;
      const cacheSessionAtStart = cachedAffiliates.find(affiliate => affiliate.id === id)?.sessionVersion;
      const updatedAt = new Date().toISOString();
      const sessionVersion = createAffiliateSessionVersion();
      let committed: { affiliate: AffiliateAccount; audit: AffiliateAuditLogEntry };
      try {
        const db = getDb();
        const reference = db.collection('affiliates').doc(id);
        committed = await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(reference);
          if (!snapshot.exists) throw changed();
          const previous = readAffiliateProfileRecord(snapshot.data(), id);
          if (previous.status !== 'active'
            || previous.passwordHash !== verifiedPasswordHash
            || previous.sessionVersion !== verifiedSessionVersion) {
            throw changed();
          }
          const affiliate: AffiliateAccount = { ...previous, passwordHash, sessionVersion, updatedAt };
          const audit: AffiliateAuditLogEntry = {
            id: `aud_credential_${crypto.randomBytes(16).toString('hex')}`,
            timestamp: updatedAt, actor, action: 'affiliate_credential_updated', targetType: 'affiliate', targetId: id,
            summary: 'Migrated a freshly verified affiliate credential and rotated its sessions.',
            previousValue: { status: previous.status },
            newValue: { status: affiliate.status, credentialFormat: 'argon2id', sessionsRotated: true },
          };
          // Preserve wallet, identity, approval, membership and profile fields.
          // The audit has no credential hashes, salts, or session generations.
          transaction.set(reference, { passwordHash, sessionVersion, updatedAt }, { merge: true });
          transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
          return { affiliate, audit };
        });
      } catch (error) {
        if (error instanceof Error && (error as Error & { code?: string }).code === 'CREDENTIALS_CHANGED') throw error;
        throw Object.assign(new Error('Affiliate credential migration could not be committed. Please retry signing in.'), { statusCode: 503 });
      }
      publishAffiliateProfileCommit(committed.affiliate, cacheSessionAtStart);
      forgetCachedAffiliateSessionsForAffiliate(id);
      this.rememberCommittedAudit(committed.audit);
      // A newer cached wallet/profile is not proof of the verified credential.
      // Session creation must compare this exact committed generation again.
      return committed.affiliate;
    }
    if (!cachedAffiliates.some(affiliate => affiliate.id === id)) {
      throw new Error('Affiliate not found.');
    }
    if (!isCurrentAffiliatePasswordHash(passwordHash)) {
      throw new Error('A current Argon2id affiliate credential is required.');
    }

    const updatedAt = new Date().toISOString();
    const sessionVersion = createAffiliateSessionVersion();

    // Persist before mutating the cache so a quota/network failure cannot be
    // reported as a successful password change on only one warm instance.
    await updateFirestoreDoc('affiliates', id, { passwordHash, sessionVersion, updatedAt });

    const latestIndex = cachedAffiliates.findIndex(affiliate => affiliate.id === id);
    if (latestIndex < 0) {
      throw new Error('Affiliate no longer exists.');
    }
    const updated: AffiliateAccount = {
      ...cachedAffiliates[latestIndex],
      passwordHash,
      sessionVersion,
      updatedAt
    };
    cachedAffiliates[latestIndex] = updated;
    forgetCachedAffiliateSessionsForAffiliate(id);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    this.recordAudit(actor, 'affiliate_credential_updated', 'affiliate', `Updated credential for affiliate ${updated.name} (${updated.affiliateCode})`, id);
    return updated;
  },
  async setAffiliateStatus(id: string, status: AffiliateStatus, actor = 'Admin', reason?: string): Promise<AffiliateAccount> {
    if (!['active', 'suspended', 'pending'].includes(status)) {
      throw new Error('Invalid affiliate status.');
    }
    const index = cachedAffiliates.findIndex(affiliate => affiliate.id === id);
    if (index < 0) {
      throw new Error("Affiliate not found.");
    }
    const prevStatus = cachedAffiliates[index].status;
    const affiliate: AffiliateAccount = {
      ...cachedAffiliates[index],
      status,
      sessionVersion: createAffiliateSessionVersion(),
      updatedAt: new Date().toISOString()
    };
    await updateFirestoreDoc('affiliates', affiliate.id, {
      status,
      sessionVersion: affiliate.sessionVersion,
      updatedAt: affiliate.updatedAt
    });
    cachedAffiliates[index] = affiliate;
    forgetCachedAffiliateSessionsForAffiliate(id);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    this.recordAudit(actor, 'status_change', 'affiliate', `Changed status of ${affiliate.name} from ${prevStatus} to ${status}${reason ? ` (${reason})` : ''}`, id, { status: prevStatus }, { status });
    return affiliate;
  },

  async toggleAffiliateLinks(id: string, disabled: boolean, actor = 'Admin'): Promise<AffiliateAccount> {
    const index = cachedAffiliates.findIndex(affiliate => affiliate.id === id);
    if (index < 0) {
      throw new Error("Affiliate not found.");
    }
    const affiliate: AffiliateAccount = {
      ...cachedAffiliates[index],
      linksDisabled: disabled,
      updatedAt: new Date().toISOString()
    };
    await setFirestoreDoc('affiliates', affiliate.id, {
      linksDisabled: disabled,
      updatedAt: affiliate.updatedAt
    });
    cachedAffiliates[index] = affiliate;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    this.recordAudit(actor, 'links_toggle', 'link', `${disabled ? 'Disabled' : 'Enabled'} referral links for ${affiliate.name} (${affiliate.affiliateCode})`, id, { linksDisabled: !disabled }, { linksDisabled: disabled });
    return affiliate;
  },

  async deleteAffiliate(id: string, actor = 'Admin'): Promise<boolean> {
    validateAffiliateProfileTarget(id, actor);
    const sessionVersionAtStart = cachedAffiliates.find(row => row.id === id)?.sessionVersion;
    let persisted: { affiliate: AffiliateProfileRecord; audit?: AffiliateAuditLogEntry } | null;
    try {
      const db = getDb();
      const reference = db.collection('affiliates').doc(id);
      persisted = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(reference);
        if (!snapshot.exists) return null;
        const previous = readAffiliateProfileRecord(snapshot.data(), id);
        if (previous.status === 'suspended' && previous.linksDisabled === true) return { affiliate: previous };
        // Keep the legacy endpoint compatible, but make removal reversible.
        // No account, referral reservation, sale, wallet or payout is deleted.
        const patch: Partial<AffiliateProfileRecord> = {
          status: 'suspended', linksDisabled: true,
          sessionVersion: createAffiliateSessionVersion(),
          profileRevision: nextAffiliateProfileRevision(previous),
          updatedAt: new Date().toISOString()
        };
        const affiliate = { ...previous, ...patch };
        const audit = affiliateProfileAudit(actor, 'affiliate_archived', previous, affiliate, ['status', 'linksDisabled']);
        transaction.set(reference, patch, { merge: true });
        transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
        return { affiliate, audit };
      });
    } catch (error) {
      affiliateProfileCommitFailure(error);
    }
    if (!persisted) return false;
    publishAffiliateProfileCommit(persisted.affiliate, sessionVersionAtStart);
    forgetCachedAffiliateSessionsForAffiliate(id);
    if (persisted.audit) this.rememberCommittedAudit(persisted.audit);
    return true;
  },

  // CLICKS & FUNNEL TRACKING
  async registerClick(
    code: string,
    articleId?: string,
    campaignCode?: string,
    ipHash?: string,
    userAgent?: string,
    referrer?: string,
    options: AffiliateClickRegistrationOptions = {},
  ): Promise<{
    valid: boolean;
    affiliate?: AffiliateAccount;
    campaign?: AffiliateCampaign;
    attributionMaxAgeMs?: number;
    clickRecorded?: boolean;
    deduplicated?: boolean;
    durable?: boolean;
    /** Internal redirect-cookie binding only; never serialize in an API response. */
    sourceClick?: { sourceClickEventId: string; sourceClickKeySha256: string; sourceClickAt: string };
  }> {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) {
      return { valid: false };
    }

    const durableMode: AffiliateClickLedgerMode = options.durableMode === 'shadow'
      || options.durableMode === 'required'
      ? options.durableMode
      : 'off';
    const dedicatedSecret = typeof process.env.AFFILIATE_CLICK_ANALYTICS_SECRET === 'string'
      && process.env.AFFILIATE_CLICK_ANALYTICS_SECRET.trim().length >= 32
      ? process.env.AFFILIATE_CLICK_ANALYTICS_SECRET.trim()
      : null;
    const visitorKey = typeof options.visitorKey === 'string' ? options.visitorKey.trim() : '';
    const keyFingerprint = deriveAffiliateClickAnalyticsKeyFingerprint(dedicatedSecret);
    const durableRequested = durableMode !== 'off';
    if (durableMode === 'required' && (!dedicatedSecret || !keyFingerprint || !visitorKey)) {
      throw new AffiliateClickLedgerUnavailableError();
    }

    const localNowMs = Date.now();
    const retentionCutoff = localNowMs - 90 * 24 * 60 * 60 * 1000;
    const retainedClicks = cachedClicks.filter(click => {
      const timestamp = new Date(click.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= retentionCutoff;
    });

    const legacyDuplicate = retainedClicks.some(click =>
      click.affiliateCode.toUpperCase() === cleanCode &&
      click.articleId === articleId &&
      click.campaignCode === campaignCode &&
      click.ipHash === ipHash &&
      localNowMs - new Date(click.timestamp).getTime() < 30 * 60 * 1000
    );
    const legacyNow = new Date(localNowMs).toISOString();
    const legacyUniqueVisitor = !retainedClicks.some(click =>
      click.affiliateCode.toUpperCase() === cleanCode && click.ipHash === ipHash
    );
    const db = getDb();

    const persisted = await db.runTransaction(async firestoreTransaction => {
      const affiliateQuery = db.collection('affiliates')
        .where('affiliateCode', '==', cleanCode)
        .limit(2);
      const affiliateQuerySnapshot = await firestoreTransaction.get(affiliateQuery) as any;
      const affiliateDocuments = affiliateQuerySnapshot.docs || [];
      if (affiliateDocuments.length > 1) {
        throw new Error('Affiliate code ownership is temporarily unavailable.');
      }
      const affiliateSnapshot = affiliateDocuments[0];
      if (!affiliateSnapshot) {
        return { valid: false, affiliateId: undefined, freshAffiliate: undefined };
      }
      const affiliateReference = affiliateSnapshot.ref;

      if (!affiliateSnapshot.exists) {
        return {
          valid: false,
          affiliateId: undefined,
          freshAffiliate: undefined
        };
      }

      const freshAffiliate: AffiliateAccount = {
        ...(affiliateSnapshot.data() as AffiliateAccount),
        id: affiliateSnapshot.id || affiliateReference.id
      };
      if (
        freshAffiliate.affiliateCode?.trim().toUpperCase() !== cleanCode ||
        freshAffiliate.status !== 'active' ||
        freshAffiliate.linksDisabled
      ) {
        return {
          valid: false,
          affiliateId: freshAffiliate.id,
          freshAffiliate
        };
      }

      const transactionReadTimeMs = firestoreSnapshotReadTimeMillis(affiliateQuerySnapshot)
        ?? firestoreSnapshotReadTimeMillis(affiliateSnapshot);
      if (durableMode === 'required' && transactionReadTimeMs === null) {
        throw new AffiliateClickLedgerUnavailableError();
      }
      const authoritativeNowMs = durableRequested && transactionReadTimeMs !== null
        ? transactionReadTimeMs
        : localNowMs;
      const authoritativeNow = new Date(authoritativeNowMs).toISOString();

      let freshCampaign: AffiliateCampaign | undefined;
      let campaignReference: any;
      if (campaignCode) {
        const campaignQuery = db.collection('affiliate_campaigns')
          .where('code', '==', campaignCode.trim().toUpperCase())
          .limit(2);
        const campaignQuerySnapshot = await firestoreTransaction.get(campaignQuery) as any;
        const campaignDocuments = campaignQuerySnapshot.docs || [];
        const campaignSnapshot = campaignDocuments.length === 1 ? campaignDocuments[0] : undefined;
        campaignReference = campaignSnapshot?.ref;
        if (campaignSnapshot?.exists) {
          const candidate: AffiliateCampaign = {
            ...(campaignSnapshot.data() as AffiliateCampaign),
            id: campaignSnapshot.id || campaignReference.id
          };
          if (
            candidate.code?.trim().toUpperCase() === campaignCode?.trim().toUpperCase() &&
            isCampaignValidAttribution(candidate, articleId, authoritativeNowMs)
          ) {
            freshCampaign = candidate;
          }
        }
      }

      const settingsRef = db.collection('site_configs').doc('affiliate_settings');
      const settingsSnapshot = await firestoreTransaction.get(settingsRef) as any;
      const freshSettings = normalizeAffiliateSettings(
        settingsSnapshot.exists ? settingsSnapshot.data() : undefined
      );
      const attributionDays = normalizeAttributionDays(
        freshCampaign?.attributionDays ?? freshAffiliate.attributionDays,
        freshSettings.defaultAttributionDays
      );

      let durableEvent: DurableAffiliateClickEventV2 | undefined;
      let durableEventReference: any;
      let durableEventExists = false;
      if (durableRequested && dedicatedSecret && visitorKey && transactionReadTimeMs !== null) {
        const dedupeIdentity = createDurableAffiliateClickDedupeIdentity({
          affiliateCode: freshAffiliate.affiliateCode,
          articleId,
          campaignCode: freshCampaign?.code,
          visitorKey,
          occurredAtMs: transactionReadTimeMs,
          signingSecret: dedicatedSecret,
        });
        const candidateEvent = dedupeIdentity
          ? normalizeDurableAffiliateClickEventV2({
              schemaVersion: 2,
              id: dedupeIdentity.documentId,
              keyFingerprint,
              affiliateCode: freshAffiliate.affiliateCode,
              affiliateId: freshAffiliate.id,
              articleId,
              campaignCode: freshCampaign?.code,
              visitorKey,
              referrerOrigin: sanitizeAffiliateClickReferrerOrigin(referrer),
              timestamp: authoritativeNow,
              dedupeWindowStartedAt: dedupeIdentity.dedupeWindowStartedAt,
            })
          : null;
        if (candidateEvent) {
          durableEvent = candidateEvent;
          durableEventReference = db.collection('affiliate_clicks').doc(candidateEvent.id);
          const durableEventSnapshot = await firestoreTransaction.get(durableEventReference) as any;
          durableEventExists = durableEventSnapshot.exists === true;
          if (durableMode === 'required' && durableEventExists) {
            const storedEvent = normalizeDurableAffiliateClickEventV2(durableEventSnapshot.data());
            if (!storedEvent || durableEventSnapshot.id !== candidateEvent.id || storedEvent.id !== candidateEvent.id
              || storedEvent.keyFingerprint !== candidateEvent.keyFingerprint
              || storedEvent.affiliateId !== candidateEvent.affiliateId || storedEvent.affiliateCode !== candidateEvent.affiliateCode
              || storedEvent.visitorKey !== candidateEvent.visitorKey || storedEvent.articleId !== candidateEvent.articleId
              || storedEvent.campaignCode !== candidateEvent.campaignCode
              || storedEvent.dedupeWindowStartedAt !== candidateEvent.dedupeWindowStartedAt
              || Date.parse(storedEvent.timestamp) > authoritativeNowMs
              || createDurableAffiliateClickDedupeIdentity({ affiliateCode: storedEvent.affiliateCode,
                articleId: storedEvent.articleId, campaignCode: storedEvent.campaignCode, visitorKey: storedEvent.visitorKey!,
                occurredAtMs: Date.parse(storedEvent.timestamp), signingSecret: dedicatedSecret })?.documentId !== storedEvent.id) {
              throw new AffiliateClickLedgerUnavailableError();
            }
            durableEvent = storedEvent;
          }
        } else if (durableMode === 'required') {
          throw new AffiliateClickLedgerUnavailableError();
        }
      }
      if (durableMode === 'required' && !durableEvent) {
        throw new AffiliateClickLedgerUnavailableError();
      }

      // Shadow mode is a behavior-preserving dual write: the existing rolling
      // legacy decision remains authoritative for counters and the response.
      // Required mode cuts over to deterministic fixed-window event existence.
      const duplicate = durableMode === 'required'
        ? durableEventExists
        : legacyDuplicate;
      if (durableEvent && durableEventReference && !durableEventExists) {
        firestoreTransaction.set(durableEventReference, durableEvent);
      }
      if (!duplicate) {
        firestoreTransaction.set(affiliateReference, {
          totalClicks: FieldValue.increment(1),
          // A process-local cache cannot prove a globally unique durable
          // visitor. Preserve the legacy approximate counter only while
          // legacy semantics are authoritative (off/shadow); bounded v2
          // analytics derives unique visitors from pseudonymous event keys.
          ...(durableMode !== 'required' && legacyUniqueVisitor
            ? { uniqueVisitors: FieldValue.increment(1) }
            : {}),
          lastActivityAt: authoritativeNow
        }, { merge: true });
        if (freshCampaign && campaignReference) {
          firestoreTransaction.set(campaignReference, {
            clicksCount: FieldValue.increment(1)
          }, { merge: true });
        }
      }

      return {
        valid: true,
        duplicate,
        durable: Boolean(durableEvent),
        durableEvent,
        affiliateId: freshAffiliate.id,
        freshAffiliate: duplicate
          ? freshAffiliate
          : {
              ...freshAffiliate,
              totalClicks: (Number(freshAffiliate.totalClicks) || 0) + 1,
              uniqueVisitors: (Number(freshAffiliate.uniqueVisitors) || 0)
                + (durableMode !== 'required' && legacyUniqueVisitor ? 1 : 0),
              lastActivityAt: authoritativeNow
            },
        freshCampaign: freshCampaign
          ? duplicate
            ? freshCampaign
            : {
                ...freshCampaign,
                clicksCount: (Number(freshCampaign.clicksCount) || 0) + 1
              }
          : undefined,
        freshSettings,
        attributionMaxAgeMs: attributionDays * DAY_MS
      };
    });

    if (!persisted.valid || !persisted.freshAffiliate) {
      if (persisted.affiliateId) {
        cacheFreshAffiliateRecord(persisted.affiliateId, persisted.freshAffiliate || null);
      }
      return { valid: false };
    }

    let affiliate = persisted.freshAffiliate;
    try {
      affiliate = cacheFreshAffiliateRecord(persisted.freshAffiliate.id, persisted.freshAffiliate)
        || persisted.freshAffiliate;
      if (persisted.freshSettings) {
        cachedSettings = persisted.freshSettings;
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
      }
    } catch (error) {
      // Firestore is authoritative after the transaction commits. A local
      // projection failure must not turn a committed click into a retriable
      // request that could mint a different visitor identity.
      console.warn('[Affiliate Click] Local cache projection failed after commit:', error);
    }
    if (persisted.duplicate) {
      return {
        valid: true,
        affiliate,
        campaign: persisted.freshCampaign,
        attributionMaxAgeMs: persisted.attributionMaxAgeMs,
        clickRecorded: false,
        deduplicated: true,
        durable: persisted.durable,
        ...(durableMode === 'required' && persisted.durableEvent ? { sourceClick: {
          sourceClickEventId: persisted.durableEvent.id, sourceClickKeySha256: persisted.durableEvent.keyFingerprint,
          sourceClickAt: persisted.durableEvent.timestamp,
        } } : {}),
      };
    }

    try {
      // Shadow mode must retain the legacy local event shape because its
      // rolling dedupe and unique-visitor decisions still depend on ipHash.
      // Required mode may project the privacy-minimised durable event instead.
      const clickEvent: AffiliateClickEvent = durableMode === 'required' && persisted.durableEvent
        ? persisted.durableEvent
        : {
            id: `clk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
            affiliateCode: affiliate.affiliateCode,
            affiliateId: affiliate.id,
            articleId,
            campaignCode: persisted.freshCampaign?.code,
            ipHash,
            userAgent: (userAgent || '').substring(0, 150),
            referrer: (referrer || '').substring(0, 200),
            timestamp: legacyNow
          };
      cachedClicks = [...retainedClicks, clickEvent].slice(-5000);
      writeJsonFileSync(CLICKS_FILE, cachedClicks);

      if (persisted.freshCampaign) {
        publishCommittedAffiliateCampaignSnapshot(persisted.freshCampaign);
      }
    } catch (error) {
      console.warn('[Affiliate Click] Local event projection failed after commit:', error);
    }

    console.log(`[Referral Click] Affiliate: ${affiliate.affiliateCode}, Article: ${articleId || 'all'}, Campaign: ${campaignCode || 'none'}`);
    return {
      valid: true,
      affiliate,
      campaign: persisted.freshCampaign,
      attributionMaxAgeMs: persisted.attributionMaxAgeMs,
      clickRecorded: true,
      deduplicated: false,
      durable: persisted.durable,
      ...(durableMode === 'required' && persisted.durableEvent ? { sourceClick: {
        sourceClickEventId: persisted.durableEvent.id, sourceClickKeySha256: persisted.durableEvent.keyFingerprint,
        sourceClickAt: persisted.durableEvent.timestamp,
      } } : {}),
    };
  },

  // RECONCILIATION OF PREVIOUS CONFIRMED TRANSACTIONS
  async reconcileTransactions(transactions: PaymentTransaction[]): Promise<number> {
    if (!Array.isArray(transactions) || transactions.length === 0) return 0;
    let reconciledCount = 0;
    for (const tx of transactions) {
      const isConfirmed = tx.status === 'CONFIRMED' || tx.status === 'SUCCESS' || tx.status === 'PAID';
      if (isConfirmed && tx.affiliateCode) {
        try {
          const comm = await this.recordAffiliateSale(tx, tx.affiliateCode, tx.campaignCode);
          if (comm) {
            reconciledCount++;
          }
        } catch (err) {
          console.warn('[AffiliateStore] Error during startup transaction reconciliation:', err);
        }
      }
    }
    if (reconciledCount > 0) {
      console.log(`[AffiliateStore] Reconciled ${reconciledCount} confirmed affiliate transaction(s) on startup.`);
    }
    return reconciledCount;
  },

  // COMMISSION CALCULATION & SALES RECORDING
  calculateCommissionRate(affiliate: AffiliateAccount, articleId: string, campaignCode?: string): number {
    const campaign = campaignCode
      ? cachedCampaigns.find(c => c.code.toUpperCase() === campaignCode.toUpperCase())
      : undefined;
    const now = new Date().toISOString();
    const monthlyVerifiedSales = countVerifiedSalesForPeriod(
      cachedCommissions.filter(commission => commission.affiliateId === affiliate.id),
      literaryCirclePeriodKey(now),
      cachedLiteraryCircleSettings.qualificationEffectiveFrom
    );
    return calculateCommissionRateFromRecords(
      affiliate,
      articleId,
      cachedSettings,
      campaign,
      cachedLiteraryCircleSettings,
      monthlyVerifiedSales,
      now
    );
  },

  async recordAffiliateSale(tx: PaymentTransaction, affiliateRefCode?: string, campaignCode?: string): Promise<AffiliateSaleCommission | null> {
    if (!affiliateRefCode) return null;
    const cleanAffiliateCode = affiliateRefCode.trim().toUpperCase();
    if (!cleanAffiliateCode) return null;
    if (tx.affiliateCode?.trim().toUpperCase() !== cleanAffiliateCode) return null;
    const canonicalCampaignCode = tx.campaignCode?.trim();
    if (
      campaignCode !== undefined &&
      campaignCode.trim().toUpperCase() !== (canonicalCampaignCode || '').toUpperCase()
    ) return null;
    if (!['CONFIRMED', 'SUCCESS', 'PAID'].includes(tx.status)) return null;
    const hasSourceClick = tx.sourceClickEventId !== undefined || tx.sourceClickKeySha256 !== undefined || tx.sourceClickAt !== undefined;
    if (hasSourceClick && (tx.affiliateAttributionVersion !== 2 || !normalizeAffiliateConversionSourceClick(tx))) return null;
    if (!transactionHasValidAffiliateAttribution(tx)) return null;
    const saleAmountKes = Number(tx.amount);
    if (!Number.isFinite(saleAmountKes) || saleAmountKes <= 0 || saleAmountKes > 1_000_000) return null;
    if (tx.purchaseKind === 'subscription' && typeof tx.subscriptionRenewal !== 'boolean') return null;
    const attributedAtMs = tx.affiliateAttributionAt
      ? Date.parse(tx.affiliateAttributionAt)
      : Date.parse(tx.createdAt);
    const now = new Date().toISOString();
    const transactionAt = [tx.confirmedAt, tx.settledAt, tx.completedAt, tx.createdAt]
      .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (!transactionAt) return null;
    const commissionId = `com_tx_${crypto.createHash('sha256')
      .update(tx.checkoutRequestId || tx.id)
      .digest('hex')
      .slice(0, 40)}`;
    const db = getDb();
    const commissionRef = db.collection('affiliate_commissions').doc(commissionId);
    const buyerAnalyticsRuntime = resolveAffiliateBuyerAnalyticsRuntime();

    const persisted = await db.runTransaction(async firestoreTransaction => {
      const existingSnapshot = await firestoreTransaction.get(commissionRef);
      if (existingSnapshot.exists) {
        return {
          created: false,
          commission: existingSnapshot.data() as AffiliateSaleCommission,
          affiliateId: undefined,
          freshAffiliate: undefined,
          freshCampaign: undefined,
          freshSettings: undefined
        };
      }

      let conversionClaim: Record<string, unknown> | null = null;
      let conversionClick: unknown;
      const conversionSource = normalizeAffiliateConversionSourceClick(tx);
      if (tx.affiliateAttributionVersion === 2) {
        const issuedAt = Date.parse(tx.affiliateAttributionAt || '');
        const expiresAt = Date.parse(tx.affiliateAttributionExpiresAt || '');
        conversionClaim = await readConsumedAffiliateAttributionClaimInTransaction(
          firestoreTransaction,
          db,
          tx.affiliateAttributionClaimId || '',
          {
            checkoutRequestId: tx.checkoutRequestId,
            checkoutArticleId: tx.articleId,
            affiliateCode: tx.affiliateCode || '',
            campaignCode: tx.campaignCode,
            channel: tx.paymentMethod === 'bank' ? 'bank' : 'mpesa',
            issuedAt,
            expiresAt,
            ...(conversionSource || {}),
          }
        );
        if (!conversionClaim) {
          return {
            created: false,
            commission: null,
            affiliateId: undefined,
            freshAffiliate: undefined,
            freshCampaign: undefined,
            freshSettings: undefined
          };
        }
        // New signed-session sources only. Historical/replayed commissions are
        // returned above and never enriched or modified by an analytics read.
        if (conversionSource && String(process.env.AFFILIATE_CLICK_LEDGER_MODE || '').trim().toLowerCase() === 'required'
          && typeof process.env.AFFILIATE_CLICK_ANALYTICS_SECRET === 'string'
          && process.env.AFFILIATE_CLICK_ANALYTICS_SECRET.trim().length >= 32) {
          const sourceSnapshot = await firestoreTransaction.get(db.collection('affiliate_clicks').doc(conversionSource.sourceClickEventId));
          const sourceValue = sourceSnapshot.exists ? sourceSnapshot.data() : undefined;
          if (sourceSnapshot.id === conversionSource.sourceClickEventId && sourceValue?.id === sourceSnapshot.id) {
            conversionClick = sourceValue;
          }
        }
      }

      const affiliateQuery = db.collection('affiliates')
        .where('affiliateCode', '==', cleanAffiliateCode)
        .limit(2);
      const affiliateQuerySnapshot = await firestoreTransaction.get(affiliateQuery) as any;
      const affiliateDocuments = affiliateQuerySnapshot.docs || [];
      if (affiliateDocuments.length > 1) {
        throw new Error('Affiliate code ownership requires administrator reconciliation.');
      }
      const affiliateSnapshot = affiliateDocuments[0];
      if (!affiliateSnapshot) {
        return {
          created: false,
          commission: null,
          affiliateId: undefined,
          freshAffiliate: undefined,
          freshCampaign: undefined,
          freshSettings: undefined
        };
      }
      const affiliateRef = affiliateSnapshot.ref;

      if (!affiliateSnapshot.exists) {
        return {
          created: false,
          commission: null,
          affiliateId: undefined,
          freshAffiliate: undefined,
          freshCampaign: undefined,
          freshSettings: undefined
        };
      }

      const freshAffiliate: AffiliateAccount = {
        ...(affiliateSnapshot.data() as AffiliateAccount),
        id: affiliateSnapshot.id || affiliateRef.id
      };
      if (
        freshAffiliate.affiliateCode?.trim().toUpperCase() !== cleanAffiliateCode ||
        freshAffiliate.status !== 'active' ||
        freshAffiliate.linksDisabled
      ) {
        return {
          created: false,
          commission: null,
          affiliateId: freshAffiliate.id,
          freshAffiliate,
          freshCampaign: undefined,
          freshSettings: undefined
        };
      }

      const settingsRef = db.collection('site_configs').doc('affiliate_settings');
      const literaryCircleSettingsRef = db.collection('site_configs').doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID);
      const [settingsSnapshot, literaryCircleSettingsSnapshot] = await Promise.all([
        firestoreTransaction.get(settingsRef),
        firestoreTransaction.get(literaryCircleSettingsRef)
      ]);
      const freshSettings = normalizeAffiliateSettings(
        settingsSnapshot.exists ? settingsSnapshot.data() : undefined
      );
      const freshLiteraryCircleSettings = normalizeLiteraryCircleSettings(
        literaryCircleSettingsSnapshot.exists ? literaryCircleSettingsSnapshot.data() : undefined
      );
      const transactionLiteraryCircleSettings = resolveLiteraryCircleSettingsForTransaction(
        freshLiteraryCircleSettings,
        transactionAt
      );

      const isSubscriptionRenewal = tx.purchaseKind === 'subscription' && tx.subscriptionRenewal === true;
      const subscriptionRenewalCommissionEnabled = shouldApplyLiteraryCircleCommissionPolicy(
        freshLiteraryCircleSettings,
        transactionAt
      ) && transactionLiteraryCircleSettings.commissionPolicy.subscriptionRenewalsEligible;
      if (isSubscriptionRenewal && !subscriptionRenewalCommissionEnabled) {
        return {
          created: false,
          commission: null,
          affiliateId: freshAffiliate.id,
          freshAffiliate,
          freshCampaign: undefined,
          freshSettings,
          freshLiteraryCircleSettings
        };
      }

      let freshCampaign: AffiliateCampaign | undefined;
      let campaignRef: any;
      if (canonicalCampaignCode) {
        const campaignQuery = db.collection('affiliate_campaigns')
          .where('code', '==', canonicalCampaignCode.toUpperCase())
          .limit(2);
        const campaignQuerySnapshot = await firestoreTransaction.get(campaignQuery) as any;
        const campaignDocuments = campaignQuerySnapshot.docs || [];
        const campaignSnapshot = campaignDocuments.length === 1 ? campaignDocuments[0] : undefined;
        campaignRef = campaignSnapshot?.ref;
        if (campaignSnapshot?.exists) {
          const candidate: AffiliateCampaign = {
            ...(campaignSnapshot.data() as AffiliateCampaign),
            id: campaignSnapshot.id || campaignRef.id
          };
          if (
            candidate.code?.trim().toUpperCase() === canonicalCampaignCode.toUpperCase() &&
            isCampaignValidAttribution(candidate, tx.articleId, attributedAtMs)
          ) {
            freshCampaign = candidate;
          }
        }
      }

      // These are intentional business-rule denials. Firestore failures reject
      // the transaction instead, allowing callers to distinguish unavailable
      // persistence from an ineligible referral.
      if (tx.type === 'TIP' && !freshSettings.allowTipsCommission) {
        return {
          created: false,
          commission: null,
          affiliateId: freshAffiliate.id,
          freshAffiliate,
          freshCampaign,
          freshSettings
        };
      }
      if (
        tx.purchaseKind !== 'subscription'
        && freshAffiliate.allowedPieceIds?.length
        && !freshAffiliate.allowedPieceIds.includes(tx.articleId)
      ) {
        return {
          created: false,
          commission: null,
          affiliateId: freshAffiliate.id,
          freshAffiliate,
          freshCampaign,
          freshSettings
        };
      }

      let isSelfReferral = false;
      if (tx.phoneNumber && freshAffiliate.phone) {
        const cleanBuyerPhone = tx.phoneNumber.replace(/[^0-9]/g, '').slice(-9);
        const cleanAffPhone = freshAffiliate.phone.replace(/[^0-9]/g, '').slice(-9);
        if (cleanBuyerPhone && cleanAffPhone && cleanBuyerPhone === cleanAffPhone) {
          isSelfReferral = true;
        }
      }
      if (tx.userEmail && freshAffiliate.email) {
        if (tx.userEmail.trim().toLowerCase() === freshAffiliate.email.trim().toLowerCase()) {
          isSelfReferral = true;
        }
      }

      const initialRateResolution = resolveAffiliateCommissionRate({
        affiliate: freshAffiliate,
        articleId: tx.articleId,
        affiliateSettings: freshSettings,
        campaign: freshCampaign,
        literaryCircleSettings: freshLiteraryCircleSettings,
        monthlyVerifiedSales: 0,
        transactionAt
      });
      let monthlyVerifiedSales = 0;
      let tierHistory: AffiliateSaleCommission[] = [];
      let tierHistoryComplete = false;
      const automaticTierRate = !isSelfReferral && initialRateResolution.source === 'literary_circle_tier'
        && freshAffiliate.literaryCircle?.tier.source !== 'manual';
      // Once initialized, every eligible sale (including campaign/manual-rate
      // sales) maintains the same monthly evidence. No lifetime scan is used.
      const tierPeriod = !isSelfReferral ? await readAffiliateTierPeriodForSale({
        db, transaction: firestoreTransaction, affiliate: freshAffiliate, transactionAt, initialize: automaticTierRate,
      }) : undefined;
      let periodPurchase = false;
      let fullyRefundedPeriodMembers = new Set<string>();
      if (tierPeriod) {
        const refundEvidence = await readAffiliateRefundQualificationEvidence(financialAdjustmentContext(db), firestoreTransaction, freshAffiliate.id, transactionAt);
        const periodMemberIds = new Set(tierPeriod.period.members.map(member => member.id));
        for (const adjustment of refundEvidence) {
          if (adjustment.refundedPurchaseKes === 0 || !periodMemberIds.has(adjustment.commissionId)) continue;
          const sourceSnapshot = await firestoreTransaction.get(db.collection('affiliate_commissions').doc(adjustment.commissionId));
          const source = sourceSnapshot.data() as AffiliateSaleCommission | undefined;
          if (!sourceSnapshot.exists || !source || source.affiliateId !== freshAffiliate.id
            || typeof source.saleAmountKes !== 'number' || !Number.isFinite(source.saleAmountKes)
            || source.saleAmountKes <= 0 || adjustment.refundedPurchaseKes > source.saleAmountKes) {
            throw new Error('Monthly affiliate refund qualification evidence needs writer review.');
          }
          if (Math.round(adjustment.refundedPurchaseKes * 100) === Math.round(source.saleAmountKes * 100)) {
            fullyRefundedPeriodMembers.add(adjustment.commissionId);
          }
        }
        periodPurchase = await validateAffiliateTierPeriodPayment({ db, transaction: firestoreTransaction, affiliate: freshAffiliate, paymentType: tx.type,
          commission: { id: commissionId, affiliateId: freshAffiliate.id, affiliateCode: freshAffiliate.affiliateCode,
            checkoutRequestId: tx.checkoutRequestId, transactionId: tx.id, articleId: tx.articleId,
            saleAmountKes, commissionAmountKes: 0, commissionRate: 0, createdAt: transactionAt,
            paymentMethod: tx.paymentMethod || 'mpesa', purchaseKind: tx.purchaseKind || 'piece',
            ...(tx.purchaseKind === 'subscription' ? { subscriptionPlanId: tx.subscriptionPlanId, subscriptionRenewal: tx.subscriptionRenewal } : {}),
            receiptNumber: tx.mpesaReceiptNumber || tx.bankReference || `CHECKOUT-${tx.checkoutRequestId || tx.id}`,
          } as AffiliateSaleCommission,
        });
        const effectiveFrom = transactionLiteraryCircleSettings.qualificationEffectiveFrom;
        // Keep the immutable period and milestone history intact. A temporary
        // projection affects only this sale's prospective rate qualification.
        const qualificationPeriod = { ...tierPeriod.period,
          members: tierPeriod.period.members.filter(member => !fullyRefundedPeriodMembers.has(member.id)) };
        const before = countAffiliateTierPeriodSales(qualificationPeriod, effectiveFrom, transactionAt);
        monthlyVerifiedSales = before + (periodPurchase && (!effectiveFrom || transactionAt >= effectiveFrom) ? 1 : 0);
        const fromTier = resolveLiteraryCircleTier(transactionLiteraryCircleSettings, before);
        const toTier = resolveLiteraryCircleTier(transactionLiteraryCircleSettings, monthlyVerifiedSales);
        const milestoneKey = `${transactionLiteraryCircleSettings.commissionPolicy.version}:${toTier.id}`;
        if (automaticTierRate && periodPurchase && fromTier.id !== toTier.id
          && !tierPeriod.period.awardedMilestones.includes(milestoneKey)) {
          const prior = qualificationPeriod.members.filter(member => member.createdAt <= transactionAt
            && (!effectiveFrom || member.createdAt >= effectiveFrom));
          // Notifications retain their independent <=100 backing-row proof.
          // A larger exact counter still prices correctly without an email.
          if (prior.length <= 100) {
            tierHistory = await Promise.all(prior.map(async member => {
              const snapshot = await firestoreTransaction.get(db.collection('affiliate_commissions').doc(member.id));
              if (!snapshot.exists) throw new Error('Monthly affiliate qualification evidence needs writer review.');
              return { ...(snapshot.data() as AffiliateSaleCommission), id: snapshot.id };
            }));
            tierHistoryComplete = true;
          }
        }
      }
      const rateResolution = resolveAffiliateCommissionRate({
        affiliate: freshAffiliate,
        articleId: tx.articleId,
        affiliateSettings: freshSettings,
        campaign: freshCampaign,
        literaryCircleSettings: transactionLiteraryCircleSettings,
        monthlyVerifiedSales,
        transactionAt
      });
      const commissionRate = rateResolution.rate;
      const commissionAmountKes = Math.round(saleAmountKes * (commissionRate / 100));
      const grossCreatorRevenueKes = saleAmountKes - commissionAmountKes;

      const autoApprove = freshSettings.autoApproveCommissions;
      const status: CommissionStatus = isSelfReferral ? 'REJECTED' : (autoApprove ? 'APPROVED' : 'PENDING');
      const effectiveCommissionAmount = isSelfReferral ? 0 : commissionAmountKes;
      const priorVerifiedSaleAt = Date.parse(freshAffiliate.lastVerifiedSaleAt || '');
      const latestVerifiedSaleAt = Number.isFinite(priorVerifiedSaleAt) && priorVerifiedSaleAt > Date.parse(transactionAt)
        ? new Date(priorVerifiedSaleAt).toISOString()
        : new Date(transactionAt).toISOString();
      const commission: AffiliateSaleCommission = {
        id: commissionId,
        orderId: resolveOrderId(tx),
        affiliateId: freshAffiliate.id,
        affiliateCode: freshAffiliate.affiliateCode,
        affiliateName: freshAffiliate.name,
        transactionId: tx.id,
        checkoutRequestId: tx.checkoutRequestId,
        receiptNumber: tx.mpesaReceiptNumber || tx.bankReference || `CHECKOUT-${tx.checkoutRequestId || tx.id}`,
        articleId: tx.articleId,
        articleTitle: tx.articleTitle || 'Monograph',
        saleAmountKes,
        currency: tx.currency || 'KES',
        originalAmount: tx.originalAmount || saleAmountKes,
        commissionRate: isSelfReferral ? 0 : commissionRate,
        commissionAmountKes: effectiveCommissionAmount,
        grossCreatorRevenueKes: isSelfReferral ? saleAmountKes : grossCreatorRevenueKes,
        paymentMethod: tx.paymentMethod || 'mpesa',
        status,
        campaignCode: freshCampaign?.code,
        purchaseKind: tx.purchaseKind || 'piece',
        ...(tx.subscriptionPlanId ? { subscriptionPlanId: tx.subscriptionPlanId } : {}),
        ...(tx.purchaseKind === 'subscription' ? { subscriptionRenewal: tx.subscriptionRenewal === true } : {}),
        ...(!isSelfReferral ? { commissionRateSource: rateResolution.source } : {}),
        ...(!isSelfReferral && rateResolution.literaryCircleTierId
          ? { literaryCircleTierId: rateResolution.literaryCircleTierId }
          : {}),
        ...(!isSelfReferral && (isSubscriptionRenewal || rateResolution.literaryCirclePolicyVersion)
          ? {
              literaryCirclePolicyVersion: isSubscriptionRenewal
                ? transactionLiteraryCircleSettings.commissionPolicy.version
                : rateResolution.literaryCirclePolicyVersion
            }
          : {}),
        fraudFlag: isSelfReferral ? {
          flagged: true,
          reason: 'Self-referral prohibited: Buyer contact matches affiliate profile.',
          severity: 'high',
          reviewed: true
        } : undefined,
        createdAt: transactionAt,
        approvedAt: (!isSelfReferral && autoApprove) ? now : undefined
      };

      const tierTransition = buildLiteraryCircleTierTransition({
        commission, affiliate: freshAffiliate, settings: transactionLiteraryCircleSettings,
        history: tierHistory, historyComplete: tierHistoryComplete,
        monthlyVerifiedSalesAfter: monthlyVerifiedSales, paymentType: tx.type,
      });
      if (tierTransition) commission.literaryCircleTierTransition = tierTransition;
      const buyerEvidence = buildCommittedAffiliateBuyerAnalyticsEvidence({
        commission, transaction: tx, runtime: buyerAnalyticsRuntime,
      });
      if (buyerEvidence) commission.affiliateBuyerAnalytics = buyerEvidence;
      if (conversionClaim && conversionClick) {
        const conversionEvidence = buildCommittedAffiliateConversionEvidence({
          commission, transaction: tx, clickEvent: conversionClick, claimValue: conversionClaim,
          claimDocumentId: tx.affiliateAttributionClaimId || '', secret: process.env.AFFILIATE_CLICK_ANALYTICS_SECRET,
        });
        if (conversionEvidence) Object.assign(commission, { affiliateConversionEvidence: conversionEvidence });
      }
      if (tierPeriod && periodPurchase) {
        firestoreTransaction.set(tierPeriod.ref, appendAffiliateTierPeriodSale(tierPeriod, commission), { merge: false });
      }
      firestoreTransaction.create(commissionRef, commission);
      const affiliateIncrement: Record<string, unknown> = {
        totalSalesCount: FieldValue.increment(1),
        totalRevenueKes: FieldValue.increment(saleAmountKes),
        walletRevision: FieldValue.increment(1),
        lastActivityAt: now
      };
      if (!isSelfReferral) {
        affiliateIncrement.totalCommissionEarnedKes = FieldValue.increment(effectiveCommissionAmount);
        affiliateIncrement.lastVerifiedSaleAt = latestVerifiedSaleAt;
        if (status === 'APPROVED') {
          affiliateIncrement.balanceAvailableKes = FieldValue.increment(effectiveCommissionAmount);
        } else {
          affiliateIncrement.balancePendingKes = FieldValue.increment(effectiveCommissionAmount);
        }
      }
      firestoreTransaction.set(affiliateRef, affiliateIncrement, { merge: true });
      if (freshCampaign && campaignRef) {
        firestoreTransaction.set(campaignRef, {
          salesCount: FieldValue.increment(1),
          revenueKes: FieldValue.increment(saleAmountKes),
          commissionsKes: FieldValue.increment(effectiveCommissionAmount)
        }, { merge: true });
      }
      return {
        created: true,
        commission,
        affiliateId: freshAffiliate.id,
        freshAffiliate: {
          ...freshAffiliate,
          walletRevision: (Number(freshAffiliate.walletRevision) || 0) + 1,
          totalSalesCount: (Number(freshAffiliate.totalSalesCount) || 0) + 1,
          totalRevenueKes: (Number(freshAffiliate.totalRevenueKes) || 0) + saleAmountKes,
          totalCommissionEarnedKes: (Number(freshAffiliate.totalCommissionEarnedKes) || 0) + (isSelfReferral ? 0 : commissionAmountKes),
          balanceAvailableKes: (Number(freshAffiliate.balanceAvailableKes) || 0) + (!isSelfReferral && status === 'APPROVED' ? commissionAmountKes : 0),
          balancePendingKes: (Number(freshAffiliate.balancePendingKes) || 0) + (!isSelfReferral && status === 'PENDING' ? commissionAmountKes : 0),
          ...(!isSelfReferral ? { lastVerifiedSaleAt: latestVerifiedSaleAt } : {}),
          lastActivityAt: now
        },
        freshCampaign: freshCampaign
          ? {
              ...freshCampaign,
              salesCount: (Number(freshCampaign.salesCount) || 0) + 1,
              revenueKes: (Number(freshCampaign.revenueKes) || 0) + saleAmountKes,
              commissionsKes: (Number(freshCampaign.commissionsKes) || 0) + effectiveCommissionAmount
            }
          : undefined,
        freshSettings,
        freshLiteraryCircleSettings
      };
    });

    if (persisted.commission) {
      await prepareCommittedAffiliateNotification({ db, kind: 'new_commission', sourceId: commissionId });
      if (persisted.commission.literaryCircleTierTransition) {
        await prepareCommittedAffiliateNotification({ db, kind: 'tier_upgrade', sourceId: commissionId });
      }
    }
    if (persisted.freshSettings) {
      cachedSettings = persisted.freshSettings;
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    }
    if ('freshLiteraryCircleSettings' in persisted && persisted.freshLiteraryCircleSettings) {
      publishLiteraryCircleSettingsSnapshot(persisted.freshLiteraryCircleSettings);
    }
    if (persisted.affiliateId) {
      cacheFreshAffiliateRecord(
        persisted.affiliateId,
        persisted.freshAffiliate || null
      );
    }
    if (persisted.freshCampaign) {
      publishCommittedAffiliateCampaignSnapshot(persisted.freshCampaign);
    }

    if (!persisted.commission) {
      return null;
    }
    if (!persisted.created) {
      if (!cachedCommissions.some(item => item.id === persisted.commission.id)) {
        cachedCommissions.unshift(persisted.commission);
        writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
      }
      return persisted.commission;
    }

    const commission = persisted.commission;
    cachedCommissions.unshift(commission);
    writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
    this.recordAudit('System', 'commission_generated', 'commission', `Generated KES ${commission.commissionAmountKes} commission (${commission.commissionRate}%) for ${commission.affiliateName} on piece "${commission.articleTitle}" (Receipt: ${commission.receiptNumber})`, commission.id, null, commission);

    console.log(`[Affiliate Commission Created] Commission ID: ${commission.id}, Affiliate: ${commission.affiliateCode} (${commission.affiliateName}), Article: "${commission.articleTitle}", Sale: KES ${commission.saleAmountKes}, Rate: ${commission.commissionRate}%, Commission Earned: KES ${commission.commissionAmountKes}, Status: ${commission.status}, Tx ID: ${tx.id}, Receipt: ${commission.receiptNumber}`);

    return commission;
  },

  // COMMISSIONS LIST & MANAGEMENT
  getCommissions(filter?: { affiliateId?: string; status?: string; transactionId?: string }): AffiliateSaleCommission[] {
    let list = [...cachedCommissions];
    if (filter?.affiliateId) {
      list = list.filter(c => c.affiliateId === filter.affiliateId);
    }
    if (filter?.status) {
      list = list.filter(c => c.status === filter.status);
    }
    if (filter?.transactionId) {
      list = list.filter(c => c.transactionId === filter.transactionId);
    }
    return list.map(withoutAffiliateBuyerAnalytics);
  },

  async updateCommissionStatus(commissionId: string, status: CommissionStatus, actor = 'Admin', reason?: string): Promise<AffiliateSaleCommission> {
    if (!walletIdentifier(commissionId) || !['PENDING', 'APPROVED', 'PAID', 'REJECTED', 'REVERSED'].includes(status)) {
      throw new AffiliateWalletValidationError('Choose a valid commission and status.');
    }
    if (reason !== undefined && (typeof reason !== 'string' || reason.length > 1_000 || /[\u0000-\u001f\u007f]/.test(reason))) {
      throw new AffiliateWalletValidationError('Commission notes must contain at most 1000 plain-text characters.');
    }
    const db = getDb();
    const committed = await db.runTransaction(async transaction => {
      const commissionRef = db.collection('affiliate_commissions').doc(commissionId);
      const snapshot = await transaction.get(commissionRef);
      if (!snapshot.exists) throw new AffiliateWalletValidationError('Commission record not found.');
      const stored = snapshot.data() as AffiliateSaleCommission;
      const commission = readWalletCommission(stored, commissionId, stored.affiliateId);
      if (commission.status === status) return { commissions: [commission], audit: undefined };
      const permitted = commission.status === 'PENDING' && ['APPROVED', 'REJECTED', 'REVERSED'].includes(status)
        || commission.status === 'APPROVED' && ['REJECTED', 'REVERSED'].includes(status);
      if (!permitted) throw new AffiliateWalletValidationError('This commission transition is not allowed. Paid commissions require a reviewed refund/chargeback adjustment.');
      if (status === 'APPROVED' && commission.fraudFlag?.flagged) walletReview('A flagged commission needs an explicit fraud review before approval.');
      if (walletMoney(commission.payoutReservedKes, true) > 0 || commission.reservedPayoutId) {
        throw new AffiliateWalletValidationError('Cancel the active payout before reversing or rejecting a reserved commission.');
      }
      if (walletMoney(commission.payoutPaidKes, true) > 0 || commission.payoutId) walletReview('Part-paid commissions need writer review before refund or reversal; historical payouts were not changed.');
      const affiliateRef = db.collection('affiliates').doc(commission.affiliateId);
      const accountSnapshot = await transaction.get(affiliateRef);
      const affiliate = readWalletAccount(accountSnapshot.data() as AffiliateAccount | undefined, commission.affiliateId);
      const amount = walletMoney(commission.commissionAmountKes);
      const from = commission.status === 'PENDING' ? 'balancePendingKes' : 'balanceAvailableKes';
      if (affiliate[from] < amount) walletReview('Durable wallet balance does not cover this commission. No amount was clamped or removed; writer review is required.');
      const accountPatch: Partial<AffiliateAccount> = {
        walletLedgerVersion: 1, walletRevision: walletNextRevision(affiliate.walletRevision),
        [from]: affiliate[from] - amount,
        ...(status === 'APPROVED' ? { balanceAvailableKes: walletMoney(affiliate.balanceAvailableKes + amount) }
          : { totalCommissionReversedKes: walletMoney(walletMoney(affiliate.totalCommissionReversedKes, true) + amount) }),
      };
      const now = new Date().toISOString();
      const next: AffiliateSaleCommission = { ...commission, status, walletLedgerVersion: 1,
        walletRevision: walletNextRevision(commission.walletRevision),
        ...(status === 'APPROVED' ? { approvedAt: commission.approvedAt || now }
          : { reversedAt: now, reversalReason: reason?.trim() || 'Reversed or rejected by writer' }),
      };
      const audit = walletAudit(actor, 'commission_status_change', 'commission', commissionId,
        { status: commission.status }, { status, amountKes: amount, reason: reason || null });
      const tierPeriodReversal = status === 'REJECTED' || status === 'REVERSED'
        ? await readAffiliateTierPeriodReversal({ db, transaction, commission }) : undefined;
      if (tierPeriodReversal) transaction.set(tierPeriodReversal.ref, tierPeriodReversal.period, { merge: false });
      transaction.set(commissionRef, next, { merge: false });
      transaction.set(affiliateRef, accountPatch, { merge: true });
      transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
      return { affiliate: { ...affiliate, ...accountPatch }, commissions: [next], audit };
    }).catch(walletCommitFailure);
    publishWalletCommit(committed);
    if (committed.audit) this.rememberCommittedAudit(committed.audit);
    return withoutAffiliateBuyerAnalytics(committed.commissions[0]);
  },

  async reverseCommissionForTransaction(transactionId: string, reason = 'Payment refund or chargeback', actor = 'System'): Promise<boolean> {
    if (!walletIdentifier(transactionId)) throw new AffiliateWalletValidationError('A valid transaction identifier is required.');
    const snapshot = await getDb().collection('affiliate_commissions').where('transactionId', '==', transactionId).limit(2).get();
    if (snapshot.docs.length > 1) walletReview('Duplicate transaction commissions need writer review before reversal.');
    const document = snapshot.docs[0];
    if (!document) return false;
    await this.updateCommissionStatus(document.id, 'REVERSED', actor, reason);
    return true;
  },

  // PAYOUTS MANAGEMENT
  getPayouts(filter?: { affiliateId?: string; status?: string }): AffiliatePayoutRequest[] {
    let list = [...cachedPayouts];
    if (filter?.affiliateId) {
      list = list.filter(p => p.affiliateId === filter.affiliateId);
    }
    if (filter?.status) {
      list = list.filter(p => p.status === filter.status);
    }
    return list;
  },

  async getPayoutsFresh(filter?: { affiliateId?: string; status?: string }): Promise<AffiliatePayoutRequest[]> {
    const snapshot = await readAffiliateFinancialSnapshot({ db: getDb(), affiliateId: filter?.affiliateId,
      isOutdated: financialSnapshotIsOutdated });
    return (snapshot?.payouts || []).filter(payout => !filter?.status || payout.status === filter.status);
  },

  async getCommissionsFresh(filter?: { affiliateId?: string; status?: string }): Promise<AffiliateSaleCommission[]> {
    const snapshot = await readAffiliateFinancialSnapshot({ db: getDb(), affiliateId: filter?.affiliateId,
      isOutdated: financialSnapshotIsOutdated });
    return (snapshot?.commissions || []).filter(commission => !filter?.status || commission.status === filter.status)
      .map(withoutAffiliateBuyerAnalytics);
  },

  async requestPayout(affiliateId: string, requestedAmountKes?: number, notes?: string): Promise<AffiliatePayoutRequest> {
    if (!walletIdentifier(affiliateId)) throw new AffiliateWalletValidationError('Affiliate not found.');
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1_000 || /[\u0000-\u001f\u007f]/.test(notes))) {
      throw new AffiliateWalletValidationError('Payout notes must contain at most 1000 plain-text characters.');
    }
    const db = getDb();
    const payoutId = `payout_${crypto.randomBytes(20).toString('hex')}`;
    const committed = await db.runTransaction(async transaction => {
      const affiliateRef = db.collection('affiliates').doc(affiliateId);
      const [affiliateSnapshot, settingsSnapshot, ...activeSnapshots] = await Promise.all([
        transaction.get(affiliateRef), transaction.get(db.collection('site_configs').doc('affiliate_settings')),
        ...ACTIVE_WALLET_PAYOUT_STATUSES.map(status => transaction.get(db.collection('affiliate_payouts')
          .where('affiliateId', '==', affiliateId).where('status', '==', status).limit(2))),
      ]);
      const affiliate = readWalletAccount(affiliateSnapshot.data() as AffiliateAccount | undefined, affiliateId);
      const activeDocuments = activeSnapshots.flatMap(snapshot => (snapshot as any).docs || []);
      if (activeDocuments.length) {
        if (activeDocuments.length > 1 || activeDocuments.some(document => document.data().walletLedgerVersion !== 1)) {
          walletReview('Existing legacy or duplicate payout requests need writer review before another request.');
        }
        throw new AffiliateWalletValidationError('A payout request is already awaiting processing.');
      }
      if (affiliate.activePayoutId || walletMoney(affiliate.balanceReservedKes, true) !== 0) walletReview('An unmatched payout reservation needs writer review.');
      if (!settingsSnapshot.exists) walletReview('Durable payout settings are unavailable; no payout was reserved.');
      const threshold = walletMoney(settingsSnapshot.data()?.minPayoutThresholdKes);
      if (threshold < 1) walletReview('The durable payout threshold must be reviewed.');
      const originalAvailable = walletMoney(affiliate.balanceAvailableKes);
      const adjustmentWallet = await readAffiliateAdjustmentWallet(financialAdjustmentContext(db), affiliateId, transaction);
      const { availableBalanceKes: available } = projectAffiliateAdjustedAvailableBalance(originalAvailable, adjustmentWallet);
      const amount = requestedAmountKes === undefined ? available : requestedAmountKes;
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new AffiliateWalletValidationError('Payout amount must be a whole Kenyan-shilling amount greater than zero.');
      if (amount < threshold) throw new AffiliateWalletValidationError(`Payout amount must be at least the configured minimum of KES ${threshold.toLocaleString()}.`);
      if (amount > available) throw new AffiliateWalletValidationError(`Payout amount cannot exceed the available balance of KES ${available.toLocaleString()}.`);
      const destination = affiliate.payoutMethod === 'mpesa' ? affiliate.payoutDetails?.mpesaPhone
        : affiliate.payoutMethod === 'bank' ? affiliate.payoutDetails?.bankAccountNumber : affiliate.payoutDetails?.paypalEmail;
      if (!['mpesa', 'bank', 'paypal'].includes(affiliate.payoutMethod) || !affiliate.payoutDetails
        || typeof affiliate.payoutDetails !== 'object' || Array.isArray(affiliate.payoutDetails)
        || typeof destination !== 'string' || !destination.trim() || destination.length > 160
        || /[\u0000-\u001f\u007f]/.test(destination)) walletReview('Review payout destination details before requesting a payout.');
      const commissionSnapshot = await transaction.get(db.collection('affiliate_commissions')
        .where('affiliateId', '==', affiliateId).where('status', '==', 'APPROVED').limit(MAX_WALLET_PAYOUT_COMMISSIONS + 1));
      if (commissionSnapshot.docs.length > MAX_WALLET_PAYOUT_COMMISSIONS) walletReview('More than 400 unpaid commissions need a reviewed staged payout; no records were changed.');
      const eligible = commissionSnapshot.docs.map(document => readWalletCommission(document.data() as AffiliateSaleCommission, document.id, affiliateId))
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
      if (eligible.some(commission => walletMoney(commission.payoutReservedKes, true) > 0 || commission.reservedPayoutId)) walletReview('Existing commission reservations need writer review.');
      let remaining = amount;
      const allocations: NonNullable<AffiliatePayoutRequest['allocations']> = [];
      const commissions: AffiliateSaleCommission[] = [];
      for (const commission of eligible) {
        if (!remaining) break;
        const unpaid = commission.commissionAmountKes - walletMoney(commission.payoutPaidKes, true);
        if (commission.fraudFlag?.flagged || unpaid <= 0) continue;
        const allocated = Math.min(remaining, unpaid);
        allocations.push({ commissionId: commission.id, amountKes: allocated });
        commissions.push({ ...commission, walletLedgerVersion: 1, walletRevision: walletNextRevision(commission.walletRevision),
          payoutPaidKes: walletMoney(commission.payoutPaidKes, true), payoutReservedKes: allocated, reservedPayoutId: payoutId });
        remaining -= allocated;
      }
      if (remaining) walletReview('Verified unpaid commission records do not cover this request; balances were not changed.');
      const now = new Date().toISOString();
      const payout: AffiliatePayoutRequest = { id: payoutId, affiliateId, affiliateCode: affiliate.affiliateCode,
        affiliateName: affiliate.name, amountKes: amount, salesCount: allocations.length,
        commissionIds: allocations.map(row => row.commissionId), allocations,
        payoutMethod: affiliate.payoutMethod, payoutDetails: structuredClone(affiliate.payoutDetails),
        status: 'PENDING', requestedAt: now, notes: notes?.trim() || 'Requested from affiliate portal',
        walletLedgerVersion: 1, walletRevision: 1,
      };
      const patch: Partial<AffiliateAccount> = { walletLedgerVersion: 1, walletRevision: walletNextRevision(affiliate.walletRevision),
        // The overlay stays additive. Deduct this reservation from the original
        // accounting baseline or the next read would apply the clawback twice.
        balanceAvailableKes: originalAvailable - amount, balanceReservedKes: amount, activePayoutId: payoutId };
      const audit = walletAudit(`Affiliate (${affiliate.name})`, 'payout_requested', 'payout', payoutId, null,
        { affiliateId, amountKes: amount, commissionIds: payout.commissionIds, status: payout.status });
      for (const commission of commissions) transaction.set(db.collection('affiliate_commissions').doc(commission.id), commission, { merge: false });
      transaction.set(affiliateRef, patch, { merge: true });
      transaction.create(db.collection('affiliate_payouts').doc(payoutId), payout);
      transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
      return { affiliate: { ...affiliate, ...patch }, commissions, payout, audit };
    }).catch(walletCommitFailure);
    publishWalletCommit(committed);
    this.rememberCommittedAudit(committed.audit);
    return committed.payout;
  },

  async processPayout(payoutId: string, action: 'approve' | 'mark_paid' | 'reject' | 'fail', paymentReference?: string, notes?: string, actor = 'Admin'): Promise<AffiliatePayoutRequest> {
    if (!walletIdentifier(payoutId) || !['approve', 'mark_paid', 'reject', 'fail'].includes(action)) throw new AffiliateWalletValidationError('Choose a valid payout and action.');
    if (notes !== undefined && (typeof notes !== 'string' || notes.length > 1_000 || /[\u0000-\u001f\u007f]/.test(notes))) throw new AffiliateWalletValidationError('Payout notes must contain at most 1000 plain-text characters.');
    const reference = typeof paymentReference === 'string' ? paymentReference.trim().toUpperCase() : '';
    if (action === 'mark_paid' && (reference.length < 4 || reference.length > 128 || /[\u0000-\u001f\u007f]/.test(reference))) {
      throw new AffiliateWalletValidationError('Enter the verified payment receipt/reference before confirming a payout as paid. No payment reference will be generated.');
    }
    const db = getDb();
    const committed = await db.runTransaction(async transaction => {
      const payoutRef = db.collection('affiliate_payouts').doc(payoutId);
      const snapshot = await transaction.get(payoutRef);
      if (!snapshot.exists) throw new AffiliateWalletValidationError('Payout request not found.');
      const payout = { ...(snapshot.data() as AffiliatePayoutRequest), id: payoutId };
      if (snapshot.data()?.id !== undefined && snapshot.data()?.id !== payoutId) walletReview();
      const targetStatus: PayoutStatus = action === 'approve' ? 'APPROVED' : action === 'mark_paid' ? 'PAID' : action === 'reject' ? 'REJECTED' : 'FAILED';
      if (payout.status === targetStatus) {
        if (action === 'mark_paid' && payout.paymentReference?.trim().toUpperCase() !== reference) throw new AffiliateWalletValidationError('This payout was already paid with a different reference; historical payment evidence was not changed.');
        return { payout, audit: undefined };
      }
      if (!ACTIVE_WALLET_PAYOUT_STATUSES.includes(payout.status as typeof ACTIVE_WALLET_PAYOUT_STATUSES[number])) {
        throw new AffiliateWalletValidationError('This payout is already final and cannot change state.');
      }
      if (action === 'approve' && payout.status !== 'PENDING') throw new AffiliateWalletValidationError('Only a pending payout can be approved.');
      if (action === 'mark_paid' && payout.status !== 'APPROVED' && payout.status !== 'PROCESSING') {
        throw new AffiliateWalletValidationError('Approve this payout before confirming its completed payment.');
      }
      if (payout.walletLedgerVersion !== 1 || !walletIdentifier(payout.affiliateId)
        || !Array.isArray(payout.allocations) || !payout.allocations.length
        || payout.allocations.length > MAX_WALLET_PAYOUT_COMMISSIONS || !Array.isArray(payout.commissionIds)
        || payout.commissionIds.length !== payout.allocations.length) walletReview('This legacy payout needs writer reconciliation before processing. No balances or historical records were changed.');
      const allocatedIds = new Set<string>();
      let total = 0;
      for (const [index, allocation] of payout.allocations.entries()) {
        if (!allocation || !walletIdentifier(allocation.commissionId) || allocatedIds.has(allocation.commissionId)
          || allocation.commissionId !== payout.commissionIds[index] || walletMoney(allocation.amountKes) <= 0) walletReview();
        allocatedIds.add(allocation.commissionId); total += allocation.amountKes;
      }
      if (total !== walletMoney(payout.amountKes) || total <= 0 || payout.salesCount !== allocatedIds.size) walletReview();
      walletNextRevision(payout.walletRevision);
      const affiliateRef = db.collection('affiliates').doc(payout.affiliateId);
      const [affiliateSnapshot, ...commissionSnapshots] = await Promise.all([
        transaction.get(affiliateRef), ...payout.allocations.map(allocation => transaction.get(db.collection('affiliate_commissions').doc(allocation.commissionId))),
      ]);
      const affiliate = readWalletAccount(affiliateSnapshot.data() as AffiliateAccount | undefined, payout.affiliateId);
      if (affiliate.walletLedgerVersion !== 1 || affiliate.activePayoutId !== payoutId
        || walletMoney(affiliate.balanceReservedKes, true) !== total) walletReview('Wallet and payout reservations do not match; writer reconciliation is required.');
      const adjustmentWallet = await readAffiliateAdjustmentWallet(financialAdjustmentContext(db), affiliate.id, transaction);
      if (action === 'approve' || action === 'mark_paid') {
        const effective = projectAffiliateAdjustedAvailableBalance(
          walletMoney(affiliate.balanceAvailableKes) + walletMoney(affiliate.balanceReservedKes, true), adjustmentWallet);
        if (effective.availableBalanceKes < total) walletReview('Confirmed financial adjustments reduce the available funds below this payout. Cancel the reservation and review the adjusted balance before paying.');
      }
      const commissions = commissionSnapshots.map((row, index) => {
        const allocation = payout.allocations![index];
        const commission = readWalletCommission(row.data() as AffiliateSaleCommission | undefined, allocation.commissionId, affiliate.id);
        if (commission.walletLedgerVersion !== 1 || commission.status !== 'APPROVED'
          || commission.reservedPayoutId !== payoutId || commission.payoutReservedKes !== allocation.amountKes
          || ((action === 'approve' || action === 'mark_paid') && commission.fraudFlag?.flagged)) walletReview('A linked commission changed or its reservation does not match. No payout was marked paid.');
        return commission;
      });
      if (action === 'mark_paid') {
        // Legacy references were not canonicalized. Bounded transactional
        // inspection catches case/space variants without rewriting history.
        const otherPayments = await transaction.get(db.collection('affiliate_payouts').limit(1_001));
        if (otherPayments.docs.length > 1_000) walletReview('Payout history exceeds the reviewed receipt-check bound; writer reconciliation is required.');
        if (otherPayments.docs.some(document => document.id !== payoutId
          && typeof document.data()?.paymentReference === 'string'
          && document.data()!.paymentReference.trim().toUpperCase() === reference)) {
          throw new AffiliateWalletValidationError('This payment reference is already attached to another payout; review the payment evidence.');
        }
        const receiptAuditId = `aud_payout_receipt_${crypto.createHash('sha256').update(reference).digest('hex')}`;
        const receiptClaim = await transaction.get(db.collection('affiliate_audit').doc(receiptAuditId));
        if (receiptClaim.exists) throw new AffiliateWalletValidationError('This payment reference is already attached to another payout; review the payment evidence.');
      }
      const now = new Date().toISOString();
      const next: AffiliatePayoutRequest = { ...payout, status: targetStatus,
        walletRevision: walletNextRevision(payout.walletRevision), processedAt: now,
        ...(notes?.trim() ? { notes: notes.trim() } : {}),
        ...(action === 'mark_paid' ? { paymentReference: reference, paidAt: now, confirmationMethod: 'writer_confirmed' as const } : {}),
        ...(action === 'reject' ? { rejectedReason: notes?.trim() || 'Declined by writer' } : {}),
      };
      let accountPatch: Partial<AffiliateAccount> | undefined;
      let nextCommissions: AffiliateSaleCommission[] = [];
      if (action !== 'approve') {
        accountPatch = { walletRevision: walletNextRevision(affiliate.walletRevision), balanceReservedKes: 0, activePayoutId: null,
          ...(action === 'mark_paid' ? { totalCommissionPaidKes: walletMoney(affiliate.totalCommissionPaidKes + total) }
            : { balanceAvailableKes: walletMoney(affiliate.balanceAvailableKes + total) }) };
        nextCommissions = commissions.map((commission, index) => {
          const paid = walletMoney(commission.payoutPaidKes, true) + (action === 'mark_paid' ? payout.allocations![index].amountKes : 0);
          return { ...commission, payoutPaidKes: paid, payoutReservedKes: 0, reservedPayoutId: null,
            walletRevision: walletNextRevision(commission.walletRevision),
            ...(paid === commission.commissionAmountKes ? { status: 'PAID' as const, payoutId, paidAt: now } : {}),
          };
        });
      }
      const audit = walletAudit(actor, 'payout_processed', 'payout', payoutId,
        { status: payout.status }, { status: next.status, amountKes: total, paymentReference: action === 'mark_paid' ? reference : null });
      // This create is both the immutable audit and a shared global receipt
      // claim. Concurrent payouts cannot commit the same canonical reference.
      if (action === 'mark_paid') audit.id = `aud_payout_receipt_${crypto.createHash('sha256').update(reference).digest('hex')}`;
      for (const commission of nextCommissions) transaction.set(db.collection('affiliate_commissions').doc(commission.id), commission, { merge: false });
      if (accountPatch) transaction.set(affiliateRef, accountPatch, { merge: true });
      transaction.set(payoutRef, next, { merge: false });
      transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
      return { affiliate: accountPatch ? { ...affiliate, ...accountPatch } : affiliate,
        commissions: nextCommissions, payout: next, audit };
    }).catch(walletCommitFailure);
    publishWalletCommit(committed);
    if (committed.audit) this.rememberCommittedAudit(committed.audit);
    return committed.payout;
  },

  // CAMPAIGNS
  getCampaigns(): AffiliateCampaign[] {
    return [...cachedCampaigns];
  },

  async getCampaignsFresh(): Promise<AffiliateCampaign[]> {
    try {
      const snapshot = await getDb().collection('affiliate_campaigns').limit(MAX_FRESH_AFFILIATE_CAMPAIGNS + 1).get();
      if (snapshot.docs.length > MAX_FRESH_AFFILIATE_CAMPAIGNS) {
        throw new Error('Campaign directory exceeds the reviewed read bound.');
      }
      // Do not publish this read into the warm cache: an older overlapping read
      // must not undo a newer committed save or a financial counter update.
      return snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as AffiliateCampaign);
    } catch {
      throw new Error('Current affiliate campaigns could not be loaded. Please retry.');
    }
  },

  async saveCampaign(data: Partial<AffiliateCampaign>, actor = 'Admin'): Promise<AffiliateCampaign> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new AffiliateCampaignValidationError('Campaign settings must be an object.');
    }
    const allowed = new Set(['id', 'code', 'name', 'description', 'commissionRate', 'attributionDays', 'eligiblePieceIds',
      'startDate', 'endDate', 'isActive', 'revision', 'updatedBy', 'createdAt', 'updatedAt',
      'clicksCount', 'salesCount', 'revenueKes', 'commissionsKes']);
    if (Object.keys(data).some(key => !allowed.has(key))) {
      throw new AffiliateCampaignValidationError('Campaign settings contain unsupported fields.');
    }
    // Copy request values before any await. Financial totals and server-owned
    // timestamps are accepted for older full-record editors but never applied.
    const request = { ...data, ...(Array.isArray(data.eligiblePieceIds) ? { eligiblePieceIds: [...data.eligiblePieceIds] } : {}) };
    const updating = request.id !== undefined;
    if (updating && (typeof request.id !== 'string' || !SAFE_CAMPAIGN_ID.test(request.id))) {
      throw new AffiliateCampaignValidationError('A valid campaign identifier is required.');
    }
    const createCode = updating ? undefined : campaignText(request.code, 'Campaign code', 64, true).toUpperCase();
    if (createCode !== undefined && !SAFE_CAMPAIGN_CODE.test(createCode)) {
      throw new AffiliateCampaignValidationError('Campaign code must contain only letters, numbers and underscores.');
    }
    const now = new Date().toISOString();
    // The same new code always contends on one document, even when both
    // transactions initially observe an empty code query. Existing IDs stay put.
    const id = request.id || `camp_${crypto.createHash('sha256').update(`affiliate-campaign-v1\0${createCode}`).digest('hex').slice(0, 40)}`;
    const safeActor = String(actor || 'Admin').trim().slice(0, 120) || 'Admin';
    try {
      const db = getDb();
      const campaignRef = db.collection('affiliate_campaigns').doc(id);
      const committed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(campaignRef);
        if (updating !== snapshot.exists) {
          throw new AffiliateCampaignConflictError(updating ? 'Campaign not found. Reload the campaign list.' : undefined);
        }
        const previous = snapshot.exists ? snapshot.data() as AffiliateCampaign : undefined;
        if (previous?.id !== undefined && previous.id !== id) throw new AffiliateCampaignConflictError();
        const previousRevision = campaignRevision(previous?.revision);
        if ((request.revision === undefined && previousRevision > 0)
          || (request.revision !== undefined && campaignRevision(request.revision) !== previousRevision)) {
          throw new AffiliateCampaignConflictError();
        }
        const code = campaignText(request.code !== undefined ? request.code : previous?.code ?? '', 'Campaign code', 64, true).toUpperCase();
        if (!SAFE_CAMPAIGN_CODE.test(code)) throw new AffiliateCampaignValidationError('Campaign code must contain only letters, numbers and underscores.');
        if (previous && previous.code !== code) {
          throw new AffiliateCampaignConflictError('An existing campaign code cannot be changed. Create a new campaign for a new referral identity.');
        }
        const duplicateSnapshot = await transaction.get(db.collection('affiliate_campaigns').where('code', '==', code).limit(2));
        if (duplicateSnapshot.docs.some(document => document.id !== id)) {
          throw new AffiliateCampaignConflictError('This campaign code already exists. Reload it before making changes.');
        }
        const name = campaignText(request.name !== undefined ? request.name : previous?.name ?? code, 'Campaign name', 120, true);
        const description = campaignText(request.description !== undefined ? request.description : previous?.description ?? '', 'Campaign description', 2_000);
        const commissionRate = request.commissionRate !== undefined ? request.commissionRate : previous?.commissionRate ?? 20;
        const attributionDays = request.attributionDays !== undefined ? request.attributionDays : previous?.attributionDays ?? 30;
        if (typeof commissionRate !== 'number' || !Number.isFinite(commissionRate) || commissionRate <= 0 || commissionRate > 100) {
          throw new AffiliateCampaignValidationError('Campaign commission must be greater than zero and at most 100 percent.');
        }
        if (!Number.isSafeInteger(attributionDays) || attributionDays < 1 || attributionDays > MAX_ATTRIBUTION_DAYS) {
          throw new AffiliateCampaignValidationError('Campaign attribution must be a whole number from 1 to 90 days.');
        }
        const eligiblePieceIds = request.eligiblePieceIds !== undefined ? request.eligiblePieceIds : previous?.eligiblePieceIds ?? [];
        if (!Array.isArray(eligiblePieceIds) || eligiblePieceIds.length > 200
          || Array.from(eligiblePieceIds).some(pieceId => typeof pieceId !== 'string' || !SAFE_CAMPAIGN_ID.test(pieceId))
          || new Set(eligiblePieceIds).size !== eligiblePieceIds.length) {
          throw new AffiliateCampaignValidationError('Choose at most 200 distinct valid campaign pieces.');
        }
        const isActive = request.isActive !== undefined ? request.isActive : previous?.isActive ?? true;
        if (typeof isActive !== 'boolean') throw new AffiliateCampaignValidationError('Campaign active state must be true or false.');
        const startDate = request.startDate !== undefined ? request.startDate : previous?.startDate ?? now;
        const endDate = request.endDate !== undefined ? request.endDate : previous?.endDate ?? new Date(Date.parse(now) + 30 * DAY_MS).toISOString();
        const startTime = campaignTime(startDate, 'Campaign start');
        const endTime = campaignTime(endDate, 'Campaign end');
        if (Date.parse(endTime) <= Date.parse(startTime)) {
          throw new AffiliateCampaignValidationError('Campaign end must be after its start.');
        }
        const campaign: AffiliateCampaign = {
          ...(previous || { clicksCount: 0, salesCount: 0, revenueKes: 0, commissionsKes: 0, createdAt: now }),
          id, code, name, description, commissionRate, attributionDays, eligiblePieceIds: [...eligiblePieceIds], isActive,
          startDate: previous && (request.startDate === undefined || request.startDate === previous.startDate) ? previous.startDate : startTime,
          endDate: previous && (request.endDate === undefined || request.endDate === previous.endDate) ? previous.endDate : endTime,
          revision: previousRevision + 1, updatedAt: now, updatedBy: safeActor,
        };
        const audit: AffiliateAuditLogEntry = {
          id: campaignNotificationAuditId(id, campaign.revision!), timestamp: now, actor: safeActor, action: 'campaign_saved', targetType: 'campaign', targetId: id,
          summary: `Saved campaign "${name}" (${code}) with ${commissionRate}% commission`,
          ...(previous ? { previousValue: sanitizeAuditValue(previous) } : {}),
          newValue: sanitizeAuditValue(campaign),
        };
        if (previous) transaction.set(campaignRef, campaign, { merge: false });
        else transaction.create(campaignRef, campaign);
        transaction.create(db.collection('affiliate_audit').doc(audit.id), audit);
        return { campaign, audit };
      });
      publishCommittedAffiliateCampaignSnapshot(committed.campaign);
      this.rememberCommittedAudit(committed.audit);
      return structuredClone(committed.campaign);
    } catch (error) {
      if (error instanceof AffiliateCampaignValidationError || error instanceof AffiliateCampaignConflictError) throw error;
      throw new Error('Campaign settings could not be committed. Please retry; no local fallback was used.');
    }
  },

  /** Legacy endpoint name retained for compatibility. Campaigns are now paused
   * reversibly, never erased with their referral identity or financial history. */
  async deleteCampaign(id: string, actor = 'Admin', expectedRevision?: number): Promise<boolean> {
    if (typeof id !== 'string' || !SAFE_CAMPAIGN_ID.test(id)) {
      throw new AffiliateCampaignValidationError('A valid campaign identifier is required.');
    }
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      throw new AffiliateCampaignValidationError('A valid campaign revision is required.');
    }
    const now = new Date().toISOString();
    const auditId = `aud_${crypto.randomBytes(16).toString('hex')}`;
    const safeActor = String(actor || 'Admin').trim().slice(0, 120) || 'Admin';
    try {
      const db = getDb();
      const campaignRef = db.collection('affiliate_campaigns').doc(id);
      const committed = await db.runTransaction(async transaction => {
        const snapshot = await transaction.get(campaignRef);
        if (!snapshot.exists) return null;
        const previous = snapshot.data() as AffiliateCampaign;
        if (previous.id !== undefined && previous.id !== id) throw new AffiliateCampaignConflictError();
        const revision = campaignRevision(previous.revision);
        if ((expectedRevision === undefined && revision > 0)
          || (expectedRevision !== undefined && expectedRevision !== revision)) throw new AffiliateCampaignConflictError();
        if (previous.isActive === false) return { campaign: { ...previous, id }, audit: undefined };
        const campaign: AffiliateCampaign = { ...previous, id, isActive: false, revision: revision + 1, updatedAt: now, updatedBy: safeActor };
        const audit: AffiliateAuditLogEntry = {
          id: auditId, timestamp: now, actor: safeActor, action: 'campaign_archived', targetType: 'campaign', targetId: id,
          summary: `Paused campaign "${previous.name}" (${previous.code}); referral and financial history retained.`,
          previousValue: sanitizeAuditValue(previous), newValue: sanitizeAuditValue(campaign),
        };
        transaction.set(campaignRef, campaign, { merge: false });
        transaction.create(db.collection('affiliate_audit').doc(auditId), audit);
        return { campaign, audit };
      });
      if (!committed) return false;
      publishCommittedAffiliateCampaignSnapshot(committed.campaign);
      if (committed.audit) this.rememberCommittedAudit(committed.audit);
      return true;
    } catch (error) {
      if (error instanceof AffiliateCampaignValidationError || error instanceof AffiliateCampaignConflictError) throw error;
      throw new Error('Campaign pause could not be committed. Please retry; no local fallback was used.');
    }
  },

  // AUDIT LOGS
  rememberCommittedAudit(entry: AffiliateAuditLogEntry): AffiliateAuditLogEntry {
    const safeEntry = sanitizeAuditValue(JSON.parse(JSON.stringify(entry))) as AffiliateAuditLogEntry;
    const existingIndex = cachedAuditLogs.findIndex(candidate => candidate.id === safeEntry.id);
    if (existingIndex >= 0) cachedAuditLogs.splice(existingIndex, 1);
    cachedAuditLogs.unshift(safeEntry);
    if (cachedAuditLogs.length > 1000) {
      cachedAuditLogs = cachedAuditLogs.slice(0, 1000);
    }
    writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
    return safeEntry;
  },

  recordAudit(actor: string, action: string, targetType: any, summary: string, targetId?: string, previousValue?: any, newValue?: any): AffiliateAuditLogEntry {
    const entry: AffiliateAuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: new Date().toISOString(),
      actor,
      action,
      targetType,
      targetId,
      summary,
      previousValue: previousValue ? sanitizeAuditValue(JSON.parse(JSON.stringify(previousValue))) : undefined,
      newValue: newValue ? sanitizeAuditValue(JSON.parse(JSON.stringify(newValue))) : undefined
    };

    this.rememberCommittedAudit(entry);
    setFirestoreDoc('affiliate_audit', entry.id, entry).catch(() => {});
    return entry;
  },

  getAuditLogs(limit = 100): AffiliateAuditLogEntry[] {
    return cachedAuditLogs.slice(0, limit).map(entry => sanitizeAuditValue(entry));
  },

  async getAuditLogsFresh(limit = 100): Promise<AffiliateAuditLogEntry[]> {
    const boundedLimit = Math.min(500, Math.max(1, Number.isFinite(limit) ? Math.floor(limit) : 100));
    const snapshot = await getDb()
      .collection('affiliate_audit')
      .orderBy('timestamp', 'desc')
      .limit(boundedLimit)
      .get();
    const fresh = snapshot.docs.map(document => sanitizeAuditValue({
      ...(document.data() as AffiliateAuditLogEntry),
      id: document.id
    }) as AffiliateAuditLogEntry);
    const freshIds = new Set(fresh.map(entry => entry.id));
    cachedAuditLogs = [
      ...fresh,
      ...cachedAuditLogs.filter(entry => !freshIds.has(entry.id))
    ]
      .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
      .slice(0, 1000);
    writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
    return fresh;
  },

  // STRICTLY PRIVATE AFFILIATE DASHBOARD
  async getAffiliateDashboardFresh(affiliateId: string, publishedPieceIds: readonly string[] = []): Promise<AffiliateDashboardStats | null> {
    const db = getDb();
    const snapshot = await readAffiliateFinancialSnapshot({ db, affiliateId, adjustmentsContext: financialAdjustmentContext(db),
      isOutdated: financialSnapshotIsOutdated });
    return snapshot ? this.getAffiliateDashboard(affiliateId, snapshot, publishedPieceIds) : null;
  },

  getAffiliateDashboard(affiliateId: string, snapshot?: AffiliateFinancialSnapshot, publishedPieceIds: readonly string[] = []): AffiliateDashboardStats | null {
    const affiliate = snapshot ? snapshot.affiliates.find(row => row.id === affiliateId) : this.getAffiliateById(affiliateId);
    if (!affiliate) return null;
    const settings = snapshot ? normalizeAffiliateSettings(snapshot.settings) : cachedSettings;
    const circleSettings = snapshot ? financialCircleSettings(snapshot) : cachedLiteraryCircleSettings;

    // Filter ONLY this affiliate's sales with ANONYMIZED customer info
    const sales = (snapshot?.commissions || cachedCommissions)
      .filter(c => c.affiliateId === affiliate.id)
      .map(toAffiliateSaleCommission);

    const payouts = (snapshot?.payouts || cachedPayouts).filter(p => p.affiliateId === affiliate.id);
    const activeCampaigns = (snapshot?.campaigns || cachedCampaigns).filter(c => c.isActive);

    const totals = affiliateFinancialTotals(sales);
    const qualifiedCommissions = refundQualifiedCommissions(totals.verified, snapshot?.financialAdjustments);
    const adjustmentWallet = adjustmentWalletFor(snapshot, affiliate.id);
    const effectiveWallet = projectAffiliateAdjustedAvailableBalance(walletMoney(affiliate.balanceAvailableKes, true), adjustmentWallet);
    const dashboardAt = new Date().toISOString();
    const dashboardPolicy = resolveLiteraryCircleSettingsForTransaction(
      circleSettings,
      dashboardAt
    );
    const activeRate = calculateCommissionRateFromRecords(
      affiliate,
      '',
      settings,
      undefined,
      dashboardPolicy,
      countVerifiedSalesForPeriod(
        qualifiedCommissions,
        literaryCirclePeriodKey(dashboardAt),
        dashboardPolicy.qualificationEffectiveFrom
      ),
      dashboardAt
    );

    const safeAffiliate = {
      ...sanitizeAffiliateForResponse(affiliate),
      commissionRate: activeRate,
      balanceAvailableKes: effectiveWallet.availableBalanceKes,
      walletAdjustmentKes: effectiveWallet.walletAdjustmentKes,
      adjustmentDebtKes: effectiveWallet.adjustmentDebtKes,
    };
    const originalCircle = buildLiteraryCircleDashboardSummary({ affiliate, commissions: totals.verified,
      settings: circleSettings, publishedPieceIds, now: dashboardAt });
    const qualifiedCircle = buildLiteraryCircleDashboardSummary({ affiliate, commissions: qualifiedCommissions,
      settings: circleSettings, publishedPieceIds, now: dashboardAt });

    return {
      affiliate: safeAffiliate,
      clicks: affiliate.totalClicks || 0,
      uniqueVisitors: affiliate.uniqueVisitors || 0,
      totalPiecesSold: totals.sales,
      totalConfirmedSales: totals.sales,
      totalRevenueGeneratedKes: totals.revenueKes,
      commissionEarnedKes: totals.earnedKes,
      commissionPendingKes: totals.pendingKes,
      commissionApprovedKes: totals.approvedKes,
      commissionPaidKes: totals.paidKes,
      availableBalanceKes: effectiveWallet.availableBalanceKes,
      financialAdjustments: { revision: adjustmentWallet.revision, ...effectiveWallet,
        refundAmountKes: adjustmentWallet.refundAmountKes, adjustmentCount: adjustmentWallet.adjustmentCount,
        negativeBalancePolicy: adjustmentWallet.negativeBalancePolicy, ...(snapshot?.observedThrough ? { asOf: snapshot.observedThrough } : {}) },
      minPayoutThresholdKes: settings.minPayoutThresholdKes || 1000,
      sales,
      payouts,
      campaigns: activeCampaigns,
      settings: {
        defaultCommissionRate: settings.defaultCommissionRate || 15,
        activeCommissionRate: activeRate,
        attributionDays: affiliate.attributionDays || settings.defaultAttributionDays || 30,
        minPayoutThresholdKes: settings.minPayoutThresholdKes || 1000
      },
      literaryCircle: { ...originalCircle, currentTier: qualifiedCircle.currentTier, nextTier: qualifiedCircle.nextTier,
        monthlyVerifiedSales: qualifiedCircle.monthlyVerifiedSales, salesToNextTier: qualifiedCircle.salesToNextTier,
        progressToNextTierPercent: qualifiedCircle.progressToNextTierPercent,
        performancePeriods: originalCircle.performancePeriods?.map(period => {
          const qualification = qualifiedCircle.performancePeriods?.find(row => row.periodKey === period.periodKey);
          return period.isCurrent && qualification ? { ...period, qualifyingSales: qualification.qualifyingSales, qualifiedTier: qualification.qualifiedTier } : period;
        }) }
    };
  },

  // ADMIN OVERVIEW & CONTROL CENTER
  async getAdminAffiliatesSummaryFresh(): Promise<AdminAffiliatesSummary> {
    const db = getDb();
    const snapshot = await readAffiliateFinancialSnapshot({ db, adjustmentsContext: financialAdjustmentContext(db), isOutdated: financialSnapshotIsOutdated });
    if (!snapshot) throw new Error('Current affiliate records are unavailable.');
    return this.getAdminAffiliatesSummary(snapshot);
  },

  getAdminAffiliatesSummary(snapshot?: AffiliateFinancialSnapshot): AdminAffiliatesSummary {
    const settings = snapshot ? normalizeAffiliateSettings(snapshot.settings) : cachedSettings;
    const circleSettings = snapshot ? financialCircleSettings(snapshot) : cachedLiteraryCircleSettings;
    const commissions = snapshot?.commissions || cachedCommissions;
    const totals = affiliateFinancialTotals(commissions);
    const defaultRate = settings.defaultCommissionRate || 15;
    const affiliates = (snapshot?.affiliates || cachedAffiliates).map(a => ({
      ...sanitizeAffiliateForResponse(a),
      ...(() => {
        const wallet = projectAffiliateAdjustedAvailableBalance(walletMoney(a.balanceAvailableKes, true), adjustmentWalletFor(snapshot, a.id));
        return { balanceAvailableKes: wallet.availableBalanceKes, walletAdjustmentKes: wallet.walletAdjustmentKes, adjustmentDebtKes: wallet.adjustmentDebtKes };
      })(),
      commissionRate: (a.customCommissionRate !== null && a.customCommissionRate !== undefined && a.customCommissionRate > 0)
        ? a.customCommissionRate
        : defaultRate
    }));
    const totalAffiliates = affiliates.length;
    const activeAffiliates = affiliates.filter(a => a.status === 'active').length;
    const suspendedAffiliates = affiliates.filter(a => a.status === 'suspended').length;
    const pendingAffiliates = affiliates.filter(a => a.status === 'pending').length;

    const totalAffiliateClicks = affiliates.reduce((sum, a) => sum + (a.totalClicks || 0), 0);
    const totalAffiliateSales = totals.sales;
    const totalRevenueGeneratedKes = totals.revenueKes;
    const totalCommissionsKes = totals.earnedKes;
    const pendingCommissionsKes = totals.pendingKes;
    const approvedCommissionsKes = totals.approvedKes;
    const paidCommissionsKes = totals.paidKes;
    const outstandingBalanceKes = affiliates.reduce((sum, a) => sum + (a.balanceAvailableKes || 0) + (a.balanceReservedKes || 0), 0);

    const flaggedCount = commissions.filter(c => c.fraudFlag?.flagged && !c.fraudFlag.reviewed).length;
    const affiliateIdsWithVerifiedSales = new Set(
      totals.verified
        .map(commission => commission.affiliateId)
    );
    const affiliatesWithLifetimeSales = affiliates.filter(affiliate =>
      affiliateIdsWithVerifiedSales.has(affiliate.id)
    ).length;
    const affiliatesWithoutSales = totalAffiliates - affiliatesWithLifetimeSales;

    // Top performers (strictly admin only)
    const topAffiliates = affiliates
      .map(a => {
        const sales = totals.verified.filter(c => c.affiliateId === a.id);
        const revenue = sales.reduce((sum, s) => sum + s.saleAmountKes, 0);
        const earned = sales.reduce((sum, s) => sum + s.commissionAmountKes, 0);
        return {
          id: a.id,
          name: a.name,
          affiliateCode: a.affiliateCode,
          salesCount: sales.length,
          revenueKes: revenue,
          commissionEarnedKes: earned,
          conversionRate: null
        };
      })
      .sort((a, b) => b.revenueKes - a.revenueKes)
      .slice(0, 10);
    const performanceNow = new Date().toISOString();
    const literaryCirclePerformance = affiliates.map(affiliate => ({
      affiliateId: affiliate.id,
      affiliateCode: affiliate.affiliateCode,
      affiliateName: affiliate.name,
      ...(affiliate.literaryCircle?.tier.source === 'manual'
        ? { manuallyAssignedTierId: affiliate.literaryCircle.tier.id }
        : {}),
      periods: (() => {
        const commissions = totals.verified.filter(commission => commission.affiliateId === affiliate.id);
        const periods = buildLiteraryCirclePerformancePeriods({ commissions, settings: circleSettings, now: performanceNow, periodCount: 6 });
        const qualified = buildLiteraryCirclePerformancePeriods({ commissions: refundQualifiedCommissions(commissions, snapshot?.financialAdjustments),
          settings: circleSettings, now: performanceNow, periodCount: 6 });
        return periods.map(period => {
          const qualification = qualified.find(row => row.periodKey === period.periodKey);
          return period.isCurrent && qualification ? { ...period, qualifyingSales: qualification.qualifyingSales, qualifiedTier: qualification.qualifiedTier } : period;
        });
      })(),
    }));

    return {
      totalAffiliates,
      activeAffiliates,
      suspendedAffiliates,
      pendingAffiliates,
      totalAffiliateClicks,
      totalAffiliateSales,
      totalRevenueGeneratedKes,
      totalCommissionsKes,
      pendingCommissionsKes,
      approvedCommissionsKes,
      paidCommissionsKes,
      outstandingBalanceKes,
      walletAdjustmentKes: affiliates.reduce((sum, affiliate) => sum + affiliate.walletAdjustmentKes, 0),
      adjustmentDebtKes: affiliates.reduce((sum, affiliate) => sum + affiliate.adjustmentDebtKes, 0),
      ...(snapshot?.observedThrough ? { financialAdjustmentsAsOf: snapshot.observedThrough } : {}),
      affiliates,
      recentSales: [...commissions].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 50).map(withoutAffiliateBuyerAnalytics),
      payouts: snapshot?.payouts || cachedPayouts,
      campaigns: snapshot?.campaigns || cachedCampaigns,
      settings,
      auditLogs: snapshot ? snapshot.auditLogs.map(entry => sanitizeAuditValue(entry)) : this.getAuditLogs(50),
      flaggedCount,
      affiliatesWithLifetimeSales,
      affiliatesWithoutSales,
      literaryCircleSettings: normalizeLiteraryCircleSettings(circleSettings),
      literaryCirclePerformance,
      topAffiliates
    };
  },

  async getAdminAffiliateAnalyticsFresh(options: {
    startDate?: string; endDate?: string; filters?: AffiliateAnalyticsFilters; now?: Date;
  } = {}): Promise<AffiliateAnalyticsReport> {
    const db = getDb();
    const snapshot = await readAffiliateFinancialSnapshot({ db, adjustmentsContext: financialAdjustmentContext(db), isOutdated: financialSnapshotIsOutdated });
    if (!snapshot) throw new Error('Current affiliate records are unavailable.');
    return this.getAdminAffiliateAnalytics(options, snapshot);
  },

  async getAdminAffiliateAnalytics(options: {
    startDate?: string;
    endDate?: string;
    filters?: AffiliateAnalyticsFilters;
    now?: Date;
  } = {}, financialSnapshot?: AffiliateFinancialSnapshot): Promise<AffiliateAnalyticsReport> {
    const now = options.now && Number.isFinite(options.now.getTime()) ? options.now : new Date();
    const window = resolveAffiliateAnalyticsWindow({
      startDate: options.startDate,
      endDate: options.endDate,
      now,
    });
    const clickFilterUnsupported = Boolean(
      options.filters?.purchaseKind
      || options.filters?.subscriptionPlanId
      || options.filters?.literaryCircleTierId,
    );
    const configuredMode = String(process.env.AFFILIATE_CLICK_LEDGER_MODE || '').trim().toLowerCase();
    const runtimeMode: AffiliateClickLedgerMode = configuredMode === 'shadow' || configuredMode === 'required'
      ? configuredMode
      : 'off';
    const dedicatedSecretPresent = typeof process.env.AFFILIATE_CLICK_ANALYTICS_SECRET === 'string'
      && process.env.AFFILIATE_CLICK_ANALYTICS_SECRET.trim().length >= 32;
    const keyFingerprint = deriveAffiliateClickAnalyticsKeyFingerprint(
      dedicatedSecretPresent ? process.env.AFFILIATE_CLICK_ANALYTICS_SECRET : undefined,
    );
    const durableClicks: DurableAffiliateClickWindowResult = clickFilterUnsupported
      ? { source: 'unsupported_filter' as const, events: [] }
      : await readDurableAffiliateClickWindow({
          rangeStartsAt: window.startsAt,
          rangeEndsAt: window.endsAt,
          filters: options.filters,
          runtimeMode,
          keyFingerprint,
        });
    const useLegacyClickFallback = durableClicks.source === 'legacy';
    const buyerRuntime = resolveAffiliateBuyerAnalyticsRuntime();
    let analyticsCommissions = financialSnapshot?.commissions || cachedCommissions;
    let buyerProjection = projectStoredAffiliateBuyerAnalytics({
      commissions: [], runtime: buyerRuntime, historyComplete: false,
    });
    let buyerReadReason: 'query_failed' | 'truncated' | undefined;
    if (buyerRuntime.enabled && financialSnapshot) {
      buyerProjection = projectStoredAffiliateBuyerAnalytics({
        commissions: analyticsCommissions, runtime: buyerRuntime, historyComplete: true,
      });
    } else if (buyerRuntime.enabled) {
      try {
        // Read a fresh, bounded all-affiliate history: filtering first would steal acquisition credit.
        const snapshot = await getDb().collection('affiliate_commissions').limit(MAX_AFFILIATE_BUYER_HISTORY + 1).get();
        if (snapshot.docs.length > MAX_AFFILIATE_BUYER_HISTORY) {
          buyerReadReason = 'truncated';
        } else {
          analyticsCommissions = snapshot.docs.map(document => ({
            ...(document.data() as AffiliateSaleCommission), id: document.id,
          }));
          buyerProjection = projectStoredAffiliateBuyerAnalytics({
            commissions: analyticsCommissions, runtime: buyerRuntime, historyComplete: true,
          });
        }
      } catch {
        // Analytics failure must never affect settlement. Do not invent identities from a stale cache.
        buyerReadReason = 'query_failed';
      }
    }
    return buildAffiliateAnalyticsReport({
      affiliates: financialSnapshot?.affiliates || cachedAffiliates,
      commissions: analyticsCommissions,
      financialObservedThrough: financialSnapshot?.observedThrough,
      financialHistoryComplete: Boolean(financialSnapshot?.observedThrough),
      financialAdjustments: financialSnapshot?.financialAdjustments,
      conversionCohort: projectAffiliateConversionCohort({
        events: durableClicks.events,
        commissions: analyticsCommissions,
        secret: runtimeMode === 'required' && dedicatedSecretPresent ? process.env.AFFILIATE_CLICK_ANALYTICS_SECRET : undefined,
        rangeStartsAt: window.startsAt,
        rangeEndsAt: window.endsAt,
        clickObservedThrough: durableClicks.queriedThrough,
        salesObservedThrough: financialSnapshot?.observedThrough,
        completeFrom: durableClicks.activation?.completeFrom,
        clickHistoryComplete: durableClicks.source === 'durable'
          && durableClicks.coverage?.eventCoverage === 'complete'
          && durableClicks.coverage?.uniqueVisitorCoverage === 'complete',
        financialHistoryComplete: Boolean(financialSnapshot?.observedThrough),
        filters: options.filters,
      }),
      ...(!buyerReadReason && buyerProjection.keysByCommissionId
        ? { buyerKeysByCommissionId: buyerProjection.keysByCommissionId } : {}),
      buyerHistoryComplete: !buyerReadReason && buyerProjection.historyComplete,
      buyerHistoryReason: buyerReadReason || buyerProjection.reason,
      clickEvents: clickFilterUnsupported
        ? undefined
        : useLegacyClickFallback
          ? cachedClicks
          : durableClicks.events,
      // The local click ledger is retained for only 90 days and capped, so it
      // must never be represented as complete historical coverage.
      clickHistoryCompleteForWindow: false,
      ...(!useLegacyClickFallback && durableClicks.coverage
        ? { clickCoverageAssessment: durableClicks.coverage }
        : {}),
      ...(!useLegacyClickFallback && durableClicks.queriedThrough
        ? { clickHistoryQueriedThrough: durableClicks.queriedThrough }
        : {}),
      startDate: options.startDate,
      endDate: options.endDate,
      filters: options.filters,
      now,
    });
  },

  // SESSIONS
  async createAffiliateSession(
    authenticatedAffiliate: AffiliateAccount,
    durationMs: number = AFFILIATE_SESSION_MAX_AGE_MS
  ): Promise<string> {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AFFILIATE_SESSION_MAX_AGE_MS) {
      throw new Error('Affiliate session duration is invalid.');
    }
    const expectedSessionVersion = resolveAffiliateSessionVersion(authenticatedAffiliate);
    if (authenticatedAffiliate.status !== 'active' || !expectedSessionVersion) {
      throw new Error('An active affiliate account is required to create a session.');
    }

    const token = createSignedAffiliateSessionToken();
    const documentId = getAffiliateSessionDocumentId(token);
    if (!documentId) throw new Error('Failed to generate a valid affiliate session.');

    const now = Date.now();
    const session: AffiliateSession = {
      storageVersion: AFFILIATE_SESSION_STORAGE_VERSION,
      affiliateId: authenticatedAffiliate.id,
      sessionVersion: expectedSessionVersion,
      createdAt: now,
      expiresAt: now + durationMs
    };

    // Recheck the exact account generation inside the same transaction that
    // writes the session. A concurrent password reset/status change therefore
    // cannot issue a cookie for credentials that were never authenticated.
    const db = getDb();
    await db.runTransaction(async transaction => {
      const affiliateRef = db.collection('affiliates').doc(authenticatedAffiliate.id);
      const currentSnapshot = await transaction.get(affiliateRef);
      if (!currentSnapshot.exists) throw new Error('Affiliate account no longer exists.');
      const currentAffiliate = {
        ...(currentSnapshot.data() as AffiliateAccount),
        id: authenticatedAffiliate.id
      };
      const currentSessionVersion = resolveAffiliateSessionVersion(currentAffiliate);
      if (currentAffiliate.status !== 'active' || currentSessionVersion !== expectedSessionVersion) {
        throw new Error('Affiliate credentials changed before the session could be issued. Please sign in again.');
      }
      transaction.set(db.collection('affiliate_sessions').doc(documentId), session);
    });

    // Persist before issuing the cookie. No raw token is stored in the document
    // identifier, body, process cache key, or local development file.
    cachedSessions.set(documentId, session);
    cachedSessionVerifiedAt.set(documentId, now);
    missingSessions.delete(documentId);
    persistAffiliateSessionCache();
    return token;
  },

  async verifyAffiliateSession(
    token?: string | null,
    options: { forceFresh?: boolean } = {}
  ): Promise<AffiliateAccount | null> {
    // Validate the HMAC before deriving a Firestore path or spending a read.
    if (!isValidSignedAffiliateSessionToken(token)) return null;
    const documentId = getAffiliateSessionDocumentId(token);
    if (!documentId) return null;
    const now = Date.now();

    const missingUntil = missingSessions.get(documentId);
    if (missingUntil && missingUntil > now) return null;
    if (missingUntil) missingSessions.delete(documentId);

    const cached = cachedSessions.get(documentId);
    const verifiedAt = cachedSessionVerifiedAt.get(documentId) || 0;
    if (cached && !options.forceFresh && cached.expiresAt > now && now - verifiedAt < AFFILIATE_SESSION_CACHE_TTL_MS) {
      const affiliate = this.getAffiliateById(cached.affiliateId);
      const currentVersion = affiliate ? resolveAffiliateSessionVersion(affiliate) : null;
      if (affiliate?.status === 'active' && currentVersion === cached.sessionVersion) return affiliate;
      forgetCachedAffiliateSession(documentId, true);
      persistAffiliateSessionCache();
      return null;
    }

    const pendingLookup = sessionLookupPromises.get(documentId);
    if (pendingLookup) return pendingLookup;

    const lookup = (async (): Promise<AffiliateAccount | null> => {
      const storedValue = await getFirestoreDoc<Record<string, unknown>>('affiliate_sessions', documentId);
      const storedSession = normalizeAffiliateSessionRecord(storedValue);
      if (!storedSession || storedSession.expiresAt <= Date.now()) {
        forgetCachedAffiliateSession(documentId, true);
        persistAffiliateSessionCache();
        if (storedSession) {
          await deleteFirestoreDoc('affiliate_sessions', documentId).catch(() => {});
        }
        return null;
      }

      // A direct account read makes suspension, deletion, password rotation,
      // and explicit all-session revocation visible across warm instances.
      const invalidationEpoch = affiliateSessionInvalidationEpochs.get(storedSession.affiliateId) || 0;
      const freshAffiliate = await getFirestoreDoc<AffiliateAccount>('affiliates', storedSession.affiliateId);
      const affiliate = freshAffiliate ? { ...freshAffiliate, id: storedSession.affiliateId } : undefined;
      const currentVersion = affiliate ? resolveAffiliateSessionVersion(affiliate) : null;
      if (
        (affiliateSessionInvalidationEpochs.get(storedSession.affiliateId) || 0) !== invalidationEpoch ||
        affiliate?.status !== 'active' ||
        currentVersion !== storedSession.sessionVersion
      ) {
        if ((affiliateSessionInvalidationEpochs.get(storedSession.affiliateId) || 0) === invalidationEpoch) {
          cacheFreshAffiliateRecord(storedSession.affiliateId, affiliate || null);
        }
        forgetCachedAffiliateSession(documentId, true);
        persistAffiliateSessionCache();
        await deleteFirestoreDoc('affiliate_sessions', documentId).catch(() => {});
        return null;
      }

      cacheFreshAffiliateRecord(storedSession.affiliateId, affiliate);
      cachedSessions.set(documentId, storedSession);
      cachedSessionVerifiedAt.set(documentId, Date.now());
      missingSessions.delete(documentId);
      persistAffiliateSessionCache();
      return this.getAffiliateById(storedSession.affiliateId) || affiliate;
    })();

    sessionLookupPromises.set(documentId, lookup);
    try {
      return await lookup;
    } finally {
      sessionLookupPromises.delete(documentId);
    }
  },

  async invalidateAffiliateSession(token: string): Promise<void> {
    if (!isValidSignedAffiliateSessionToken(token)) return;
    const documentId = getAffiliateSessionDocumentId(token);
    if (!documentId) return;

    const pendingLookup = sessionLookupPromises.get(documentId);
    if (pendingLookup) await pendingLookup.catch(() => null);
    forgetCachedAffiliateSession(documentId, true);
    persistAffiliateSessionCache();
    sessionLookupPromises.delete(documentId);
    await deleteFirestoreDoc('affiliate_sessions', documentId);
  },

  async invalidateAffiliateSessions(affiliateId: string): Promise<number> {
    const index = cachedAffiliates.findIndex(affiliate => affiliate.id === affiliateId);
    if (index < 0) return 0;

    // Rotate one private generation value rather than scanning and deleting an
    // unbounded session collection. Verification rejects every older version.
    const sessionVersion = createAffiliateSessionVersion();
    const updatedAt = new Date().toISOString();
    await updateFirestoreDoc('affiliates', affiliateId, { sessionVersion, updatedAt });
    cachedAffiliates[index] = { ...cachedAffiliates[index], sessionVersion, updatedAt };
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    return forgetCachedAffiliateSessionsForAffiliate(affiliateId);
  }
};


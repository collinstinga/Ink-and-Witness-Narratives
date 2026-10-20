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
  getAllFirestoreDocs
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
import { buildAffiliateAnalyticsReport } from './affiliateAnalytics.js';
import { isCurrentAffiliatePasswordHash } from './affiliateCredentials.js';
import { resolveOrderId, toAffiliateSaleCommission } from './salesLedger.js';
import { verifyConsumedAffiliateAttributionClaimInTransaction } from './affiliateAttributionClaimStore.js';
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

export class LiteraryCircleSettingsConflictError extends Error {
  constructor() {
    super('Literary Circle settings changed since this editor was opened. Reload the latest settings before saving again.');
    this.name = 'LiteraryCircleSettingsConflictError';
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
      .filter(([key]) => !/(password|secret|token|sessionVersion)/i.test(key))
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
  if (index >= 0) {
    cachedAffiliates[index] = refreshed;
  } else {
    cachedAffiliates.unshift(refreshed);
  }
  writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
  return refreshed;
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
        setFirestoreDoc('site_configs', 'affiliate_settings', cachedSettings).catch(() => {});
      } else {
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
        setFirestoreDoc('site_configs', 'affiliate_settings', cachedSettings).catch(() => {});
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
        setFirestoreDoc(
          'site_configs',
          LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
          cachedLiteraryCircleSettings
        ).catch(() => {});
      } else {
        writeJsonFileSync(LITERARY_CIRCLE_SETTINGS_FILE, cachedLiteraryCircleSettings);
        setFirestoreDoc(
          'site_configs',
          LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
          cachedLiteraryCircleSettings
        ).catch(() => {});
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
          for (const aff of cachedAffiliates) {
            setFirestoreDoc('affiliates', aff.id, aff).catch(() => {});
          }
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
        for (const comm of cachedCommissions) {
          setFirestoreDoc('affiliate_commissions', comm.id, comm).catch(() => {});
        }
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
        for (const p of cachedPayouts) {
          setFirestoreDoc('affiliate_payouts', p.id, p).catch(() => {});
        }
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
        for (const c of cachedCampaigns) {
          setFirestoreDoc('affiliate_campaigns', c.id, c).catch(() => {});
        }
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
        for (const a of cachedAuditLogs) {
          setFirestoreDoc('affiliate_audit', a.id, a).catch(() => {});
        }
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
    const now = new Date().toISOString();
    const requestedRevision = Number.isSafeInteger(expectedRevision) && Number(expectedRevision) >= 0
      ? Number(expectedRevision)
      : 0;
    const settingsReference = getDb()
      .collection('site_configs')
      .doc(LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID);
    const persisted = await getDb().runTransaction(async firestoreTransaction => {
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
      const requested = preserveExistingCommunityPosts
        ? normalizeLiteraryCircleSettings({
            ...validated,
            community: {
              ...validated.community,
              posts: previous.community.posts || []
            }
          })
        : validated;

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
      firestoreTransaction.set(settingsReference, next, { merge: false });
      return { previous, next };
    });

    // Publish the process-local copy only after the atomic source-of-truth
    // write succeeds. A stale editor therefore cannot revive old content.
    const published = publishLiteraryCircleSettingsSnapshot(persisted.next);
    this.recordAudit(
      actor,
      'literary_circle_settings_updated',
      'settings',
      'Updated Literary Circle configuration',
      LITERARY_CIRCLE_SETTINGS_DOCUMENT_ID,
      persisted.previous,
      persisted.next
    );
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

    return newAffiliate;
  },

  acceptAffiliateTerms(id: string, termsVersion = '2026.1', actor = 'Affiliate'): AffiliateAccount {
    const index = cachedAffiliates.findIndex(affiliate => affiliate.id === id);
    if (index < 0) {
      throw new Error("Affiliate not found.");
    }
    const prev = { ...cachedAffiliates[index] };
    const now = new Date().toISOString();
    const affiliate: AffiliateAccount = {
      ...prev,
      acceptedTerms: true,
      termsVersion,
      termsAcceptedAt: now,
      updatedAt: now
    };

    cachedAffiliates[index] = affiliate;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, {
      acceptedTerms: affiliate.acceptedTerms,
      termsVersion: affiliate.termsVersion,
      termsAcceptedAt: affiliate.termsAcceptedAt,
      updatedAt: affiliate.updatedAt
    }).catch(() => {});
    this.recordAudit(actor, 'terms_accepted', 'affiliate', `Affiliate ${affiliate.name} accepted Terms & Conditions (Version: ${termsVersion})`, id, prev, affiliate);
    return affiliate;
  },

  updateAffiliate(id: string, patch: Partial<AffiliateAccount>, actor = 'Admin'): AffiliateAccount {
    const index = cachedAffiliates.findIndex(a => a.id === id);
    if (index < 0) {
      throw new Error("Affiliate not found.");
    }

    const prev = { ...cachedAffiliates[index] };
    const {
      passwordHash: _ignoredPasswordHash,
      sessionVersion: _ignoredSessionVersion,
      // Identity keys are bound to permanent reservation documents when an
      // affiliate is created. Keep them immutable until a future update path
      // can move those reservations atomically.
      email: _ignoredEmail,
      affiliateCode: _ignoredAffiliateCode,
      ...safePatch
    } = patch;
    const updated: AffiliateAccount = {
      ...prev,
      ...safePatch,
      payoutDetails: {
        ...prev.payoutDetails,
        ...(safePatch.payoutDetails || {})
      },
      updatedAt: new Date().toISOString()
    };

    cachedAffiliates[index] = updated;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    const persistencePatch: Partial<AffiliateAccount> = {
      ...safePatch,
      updatedAt: updated.updatedAt
    };
    if (safePatch.payoutDetails) {
      persistencePatch.payoutDetails = updated.payoutDetails;
    }
    setFirestoreDoc('affiliates', updated.id, persistencePatch).catch(() => {});
    this.recordAudit(actor, 'affiliate_updated', 'affiliate', `Updated profile/settings for ${updated.name} (${updated.affiliateCode})`, id, prev, updated);

    return updated;
  },

  async updateAffiliateCredential(id: string, passwordHash: string, actor = 'System'): Promise<AffiliateAccount> {
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
    const idx = cachedAffiliates.findIndex(a => a.id === id);
    if (idx < 0) return false;
    const deleted = cachedAffiliates[idx];
    await deleteFirestoreDoc('affiliates', id);
    cachedAffiliates.splice(idx, 1);
    forgetCachedAffiliateSessionsForAffiliate(id);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    this.recordAudit(actor, 'affiliate_deleted', 'affiliate', `Deleted affiliate ${deleted.name} (${deleted.affiliateCode})`, id);
    return true;
  },

  // CLICKS & FUNNEL TRACKING
  async registerClick(code: string, articleId?: string, campaignCode?: string, ipHash?: string, userAgent?: string, referrer?: string): Promise<{
    valid: boolean;
    affiliate?: AffiliateAccount;
    campaign?: AffiliateCampaign;
    attributionMaxAgeMs?: number;
  }> {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) {
      return { valid: false };
    }

    const nowMs = Date.now();
    const retentionCutoff = nowMs - 90 * 24 * 60 * 60 * 1000;
    const retainedClicks = cachedClicks.filter(click => {
      const timestamp = new Date(click.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= retentionCutoff;
    });

    const duplicate = retainedClicks.some(click =>
      click.affiliateCode.toUpperCase() === cleanCode &&
      click.articleId === articleId &&
      click.campaignCode === campaignCode &&
      click.ipHash === ipHash &&
      nowMs - new Date(click.timestamp).getTime() < 30 * 60 * 1000
    );
    const now = new Date(nowMs).toISOString();
    const uniqueVisitor = !retainedClicks.some(click =>
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
            isCampaignValidAttribution(candidate, articleId, nowMs)
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

      if (!duplicate) {
        firestoreTransaction.set(affiliateReference, {
          totalClicks: FieldValue.increment(1),
          ...(uniqueVisitor ? { uniqueVisitors: FieldValue.increment(1) } : {}),
          lastActivityAt: now
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
        affiliateId: freshAffiliate.id,
        freshAffiliate: duplicate
          ? freshAffiliate
          : {
              ...freshAffiliate,
              totalClicks: (Number(freshAffiliate.totalClicks) || 0) + 1,
              uniqueVisitors: (Number(freshAffiliate.uniqueVisitors) || 0) + (uniqueVisitor ? 1 : 0),
              lastActivityAt: now
            },
        freshCampaign: freshCampaign
          ? {
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

    const affiliate = cacheFreshAffiliateRecord(persisted.freshAffiliate.id, persisted.freshAffiliate)
      || persisted.freshAffiliate;
    if (persisted.freshSettings) {
      cachedSettings = persisted.freshSettings;
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    }
    if (persisted.duplicate) {
      return {
        valid: true,
        affiliate,
        campaign: persisted.freshCampaign,
        attributionMaxAgeMs: persisted.attributionMaxAgeMs
      };
    }

    const clickEvent: AffiliateClickEvent = {
      id: `clk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      affiliateCode: affiliate.affiliateCode,
      affiliateId: affiliate.id,
      articleId,
      campaignCode: persisted.freshCampaign?.code,
      ipHash,
      userAgent: (userAgent || '').substring(0, 150),
      referrer: (referrer || '').substring(0, 200),
      timestamp: now
    };
    cachedClicks = [...retainedClicks, clickEvent].slice(-5000);
    writeJsonFileSync(CLICKS_FILE, cachedClicks);

    if (persisted.freshCampaign) {
      const campaignIndex = cachedCampaigns.findIndex(campaign => campaign.id === persisted.freshCampaign!.id);
      if (campaignIndex >= 0) {
        cachedCampaigns[campaignIndex] = persisted.freshCampaign;
      } else {
        cachedCampaigns.unshift(persisted.freshCampaign);
      }
      writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
    }

    console.log(`[Referral Click] Affiliate: ${affiliate.affiliateCode}, Article: ${articleId || 'all'}, Campaign: ${campaignCode || 'none'}`);
    return {
      valid: true,
      affiliate,
      campaign: persisted.freshCampaign,
      attributionMaxAgeMs: persisted.attributionMaxAgeMs
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

      if (tx.affiliateAttributionVersion === 2) {
        const issuedAt = Date.parse(tx.affiliateAttributionAt || '');
        const expiresAt = Date.parse(tx.affiliateAttributionExpiresAt || '');
        const claimIsValid = await verifyConsumedAffiliateAttributionClaimInTransaction(
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
            expiresAt
          }
        );
        if (!claimIsValid) {
          return {
            created: false,
            commission: null,
            affiliateId: undefined,
            freshAffiliate: undefined,
            freshCampaign: undefined,
            freshSettings: undefined
          };
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
      if (
        !isSelfReferral
        && initialRateResolution.source === 'literary_circle_tier'
        && freshAffiliate.literaryCircle?.tier.source !== 'manual'
      ) {
        const commissionQuery = db.collection('affiliate_commissions')
          .where('affiliateId', '==', freshAffiliate.id)
          .limit(10_000);
        const commissionSnapshot = await firestoreTransaction.get(commissionQuery) as any;
        const existingCommissions = (commissionSnapshot.docs || []).map((document: any) => ({
          ...(document.data() as AffiliateSaleCommission),
          id: document.id
        }));
        const periodKey = literaryCirclePeriodKey(transactionAt);
        monthlyVerifiedSales = countVerifiedSalesForPeriod(
          existingCommissions,
          periodKey,
          transactionLiteraryCircleSettings.qualificationEffectiveFrom
        );
        const qualificationStartsAt = Date.parse(
          transactionLiteraryCircleSettings.qualificationEffectiveFrom || '1970-01-01T00:00:00.000Z'
        );
        if (
          periodKey
          && literaryCirclePeriodKey(transactionAt) === periodKey
          && Date.parse(transactionAt) >= qualificationStartsAt
        ) {
          monthlyVerifiedSales += 1;
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

      firestoreTransaction.create(commissionRef, commission);
      const affiliateIncrement: Record<string, unknown> = {
        totalSalesCount: FieldValue.increment(1),
        totalRevenueKes: FieldValue.increment(saleAmountKes),
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
      const campaignIndex = cachedCampaigns.findIndex(campaign => campaign.id === persisted.freshCampaign!.id);
      if (campaignIndex >= 0) {
        cachedCampaigns[campaignIndex] = persisted.freshCampaign;
      } else {
        cachedCampaigns.unshift(persisted.freshCampaign);
      }
      writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
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
    return list;
  },

  updateCommissionStatus(commissionId: string, status: CommissionStatus, actor = 'Admin', reason?: string): AffiliateSaleCommission {
    const commission = cachedCommissions.find(c => c.id === commissionId);
    if (!commission) {
      throw new Error("Commission record not found.");
    }

    const prevStatus = commission.status;
    if (prevStatus === status) return commission;

    const affiliate = this.getAffiliateById(commission.affiliateId);
    const amount = commission.commissionAmountKes;

    // Adjust balances based on state transition
    if (affiliate) {
      if (prevStatus === 'PENDING' && status === 'APPROVED') {
        affiliate.balancePendingKes = Math.max(0, (affiliate.balancePendingKes || 0) - amount);
        affiliate.balanceAvailableKes = (affiliate.balanceAvailableKes || 0) + amount;
      } else if (prevStatus === 'APPROVED' && (status === 'REVERSED' || status === 'REJECTED')) {
        affiliate.balanceAvailableKes = Math.max(0, (affiliate.balanceAvailableKes || 0) - amount);
      } else if (prevStatus === 'PENDING' && (status === 'REVERSED' || status === 'REJECTED')) {
        affiliate.balancePendingKes = Math.max(0, (affiliate.balancePendingKes || 0) - amount);
      }
      writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    }

    commission.status = status;
    if (status === 'APPROVED' && !commission.approvedAt) {
      commission.approvedAt = new Date().toISOString();
    }
    if (status === 'REVERSED') {
      commission.reversedAt = new Date().toISOString();
      commission.reversalReason = reason || 'Reversed by admin';
    }
    writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
    setFirestoreDoc('affiliate_commissions', commission.id, commission).catch(() => {});

    this.recordAudit(actor, 'commission_status_change', 'commission', `Changed commission #${commission.receiptNumber} status from ${prevStatus} to ${status}${reason ? ` (${reason})` : ''}`, commission.id, { status: prevStatus }, { status });

    return commission;
  },

  reverseCommissionForTransaction(transactionId: string, reason = "Payment refund or chargeback", actor = 'System'): boolean {
    const commissions = cachedCommissions.filter(c => c.transactionId === transactionId && c.status !== 'REVERSED');
    if (commissions.length === 0) return false;

    commissions.forEach(c => {
      this.updateCommissionStatus(c.id, 'REVERSED', actor, reason);
    });

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

  requestPayout(affiliateId: string, requestedAmountKes?: number, notes?: string): AffiliatePayoutRequest {
    const affiliate = this.getAffiliateById(affiliateId);
    if (!affiliate) {
      throw new Error("Affiliate not found.");
    }

    const available = affiliate.balanceAvailableKes || 0;
    const minThreshold = cachedSettings.minPayoutThresholdKes || 1000;

    if (available < minThreshold) {
      throw new Error(`Available balance (KES ${available.toLocaleString()}) has not reached the minimum payout threshold of KES ${minThreshold.toLocaleString()}.`);
    }

    const amount = requestedAmountKes === undefined ? available : requestedAmountKes;
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new Error("Payout amount must be a whole Kenyan-shilling amount greater than zero.");
    }
    if (amount < minThreshold) {
      throw new Error(`Payout amount must be at least the configured minimum of KES ${minThreshold.toLocaleString()}.`);
    }
    if (amount > available) {
      throw new Error(`Payout amount cannot exceed the available balance of KES ${available.toLocaleString()}.`);
    }

    const activePayout = cachedPayouts.find(payout =>
      payout.affiliateId === affiliate.id
      && ['PENDING', 'APPROVED', 'PROCESSING'].includes(payout.status)
    );
    if (activePayout) {
      throw new Error(`A payout request for KES ${activePayout.amountKes.toLocaleString()} is already awaiting processing.`);
    }

    // Find all approved un-paid commissions for this affiliate
    const eligibleCommissions = cachedCommissions.filter(c => c.affiliateId === affiliate.id && c.status === 'APPROVED' && !c.payoutId);
    const commissionIds = eligibleCommissions.map(c => c.id);

    const now = new Date().toISOString();
    const payout: AffiliatePayoutRequest = {
      id: `payout_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      affiliateId: affiliate.id,
      affiliateCode: affiliate.affiliateCode,
      affiliateName: affiliate.name,
      amountKes: amount,
      salesCount: eligibleCommissions.length,
      commissionIds,
      payoutMethod: affiliate.payoutMethod,
      payoutDetails: { ...affiliate.payoutDetails },
      status: 'PENDING',
      requestedAt: now,
      notes: notes || 'Requested from affiliate portal'
    };

    cachedPayouts.unshift(payout);
    writeJsonFileSync(PAYOUTS_FILE, cachedPayouts);
    setFirestoreDoc('affiliate_payouts', payout.id, payout).catch(() => {});

    this.recordAudit(`Affiliate (${affiliate.name})`, 'payout_requested', 'payout', `Requested payout of KES ${amount.toLocaleString()} via ${affiliate.payoutMethod}`, payout.id, null, payout);

    return payout;
  },

  processPayout(payoutId: string, action: 'approve' | 'mark_paid' | 'reject' | 'fail', paymentReference?: string, notes?: string, actor = 'Admin'): AffiliatePayoutRequest {
    const payout = cachedPayouts.find(p => p.id === payoutId);
    if (!payout) {
      throw new Error("Payout request not found.");
    }

    const affiliate = this.getAffiliateById(payout.affiliateId);
    const now = new Date().toISOString();

    if (action === 'approve') {
      payout.status = 'APPROVED';
      payout.processedAt = now;
      if (notes) payout.notes = notes;
    } else if (action === 'mark_paid') {
      payout.status = 'PAID';
      payout.paidAt = now;
      payout.paymentReference = paymentReference || `B2C_${Date.now().toString().slice(-8)}`;
      if (notes) payout.notes = notes;

      // Deduct from affiliate available balance and add to paid
      if (affiliate) {
        affiliate.balanceAvailableKes = Math.max(0, (affiliate.balanceAvailableKes || 0) - payout.amountKes);
        affiliate.totalCommissionPaidKes = (affiliate.totalCommissionPaidKes || 0) + payout.amountKes;
        writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
        setFirestoreDoc('affiliates', affiliate.id, {
          balanceAvailableKes: affiliate.balanceAvailableKes,
          totalCommissionPaidKes: affiliate.totalCommissionPaidKes
        }).catch(() => {});
      }

      // Mark linked commissions as PAID
      if (payout.commissionIds && payout.commissionIds.length > 0) {
        cachedCommissions.forEach(c => {
          if (payout.commissionIds.includes(c.id)) {
            c.status = 'PAID';
            c.payoutId = payout.id;
            c.paidAt = now;
            setFirestoreDoc('affiliate_commissions', c.id, c).catch(() => {});
          }
        });
        writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
      }
    } else if (action === 'reject') {
      payout.status = 'REJECTED';
      payout.rejectedReason = notes || 'Declined by administrator';
      payout.processedAt = now;
    } else if (action === 'fail') {
      payout.status = 'FAILED';
      payout.processedAt = now;
      if (notes) payout.notes = notes;
    }

    writeJsonFileSync(PAYOUTS_FILE, cachedPayouts);
    setFirestoreDoc('affiliate_payouts', payout.id, payout).catch(() => {});
    this.recordAudit(actor, 'payout_processed', 'payout', `Processed payout #${payout.id} (Status: ${payout.status}, Amount: KES ${payout.amountKes.toLocaleString()}${paymentReference ? `, Ref: ${paymentReference}` : ''})`, payout.id, null, payout);

    return payout;
  },

  // CAMPAIGNS
  getCampaigns(): AffiliateCampaign[] {
    return [...cachedCampaigns];
  },

  saveCampaign(data: Partial<AffiliateCampaign>, actor = 'Admin'): AffiliateCampaign {
    const code = (data.code || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!code) {
      throw new Error("Campaign code is required.");
    }

    const index = cachedCampaigns.findIndex(c => c.id === data.id || c.code.toUpperCase() === code);
    const now = new Date().toISOString();

    const campaign: AffiliateCampaign = {
      id: data.id || `camp_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      code,
      name: (data.name || code).trim(),
      description: data.description || '',
      commissionRate: Number(data.commissionRate) || 20,
      attributionDays: Number(data.attributionDays) || 30,
      eligiblePieceIds: Array.isArray(data.eligiblePieceIds) ? data.eligiblePieceIds : [],
      startDate: data.startDate || now,
      endDate: data.endDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      isActive: data.isActive !== undefined ? data.isActive : true,
      clicksCount: data.clicksCount || (index >= 0 ? cachedCampaigns[index].clicksCount : 0),
      salesCount: data.salesCount || (index >= 0 ? cachedCampaigns[index].salesCount : 0),
      revenueKes: data.revenueKes || (index >= 0 ? cachedCampaigns[index].revenueKes : 0),
      commissionsKes: data.commissionsKes || (index >= 0 ? cachedCampaigns[index].commissionsKes : 0),
      createdAt: index >= 0 ? cachedCampaigns[index].createdAt : now,
      updatedAt: now
    };

    if (index >= 0) {
      cachedCampaigns[index] = campaign;
    } else {
      cachedCampaigns.unshift(campaign);
    }

    writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
    setFirestoreDoc('affiliate_campaigns', campaign.id, campaign).catch(() => {});
    this.recordAudit(actor, 'campaign_saved', 'campaign', `Saved campaign "${campaign.name}" (${campaign.code}) with ${campaign.commissionRate}% commission`, campaign.id, null, campaign);

    return campaign;
  },

  deleteCampaign(id: string, actor = 'Admin'): boolean {
    const idx = cachedCampaigns.findIndex(c => c.id === id);
    if (idx < 0) return false;
    const deleted = cachedCampaigns[idx];
    cachedCampaigns.splice(idx, 1);
    writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
    deleteFirestoreDoc('affiliate_campaigns', id).catch(() => {});
    this.recordAudit(actor, 'campaign_deleted', 'campaign', `Deleted campaign "${deleted.name}" (${deleted.code})`, id);
    return true;
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
  getAffiliateDashboard(affiliateId: string): AffiliateDashboardStats | null {
    const affiliate = this.getAffiliateById(affiliateId);
    if (!affiliate) return null;

    // Filter ONLY this affiliate's sales with ANONYMIZED customer info
    const sales = cachedCommissions
      .filter(c => c.affiliateId === affiliate.id)
      .map(toAffiliateSaleCommission);

    const payouts = cachedPayouts.filter(p => p.affiliateId === affiliate.id);
    const activeCampaigns = cachedCampaigns.filter(c => c.isActive);

    const commissionEarned = sales.reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionPending = sales.filter(s => s.status === 'PENDING').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionApproved = sales.filter(s => s.status === 'APPROVED').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionPaid = sales.filter(s => s.status === 'PAID').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const totalRevenue = sales.reduce((acc, s) => acc + s.saleAmountKes, 0);
    const dashboardAt = new Date().toISOString();
    const dashboardPolicy = resolveLiteraryCircleSettingsForTransaction(
      cachedLiteraryCircleSettings,
      dashboardAt
    );
    const activeRate = calculateCommissionRateFromRecords(
      affiliate,
      '',
      cachedSettings,
      undefined,
      dashboardPolicy,
      countVerifiedSalesForPeriod(
        sales,
        literaryCirclePeriodKey(dashboardAt),
        dashboardPolicy.qualificationEffectiveFrom
      ),
      dashboardAt
    );

    const safeAffiliate = {
      ...sanitizeAffiliateForResponse(affiliate),
      commissionRate: activeRate
    };

    return {
      affiliate: safeAffiliate,
      clicks: affiliate.totalClicks || 0,
      uniqueVisitors: affiliate.uniqueVisitors || 0,
      totalPiecesSold: sales.length,
      totalConfirmedSales: sales.filter(s => ['PENDING', 'APPROVED', 'PAID'].includes(s.status)).length,
      totalRevenueGeneratedKes: totalRevenue,
      commissionEarnedKes: commissionEarned,
      commissionPendingKes: commissionPending,
      commissionApprovedKes: commissionApproved,
      commissionPaidKes: commissionPaid,
      availableBalanceKes: affiliate.balanceAvailableKes || 0,
      minPayoutThresholdKes: cachedSettings.minPayoutThresholdKes || 1000,
      sales,
      payouts,
      campaigns: activeCampaigns,
      settings: {
        defaultCommissionRate: cachedSettings.defaultCommissionRate || 15,
        activeCommissionRate: activeRate,
        attributionDays: affiliate.attributionDays || cachedSettings.defaultAttributionDays || 30,
        minPayoutThresholdKes: cachedSettings.minPayoutThresholdKes || 1000
      },
      literaryCircle: buildLiteraryCircleDashboardSummary({
        affiliate,
        // Never pass the global ledger into an affiliate-facing summary.
        commissions: sales,
        settings: cachedLiteraryCircleSettings
      })
    };
  },

  // ADMIN OVERVIEW & CONTROL CENTER
  getAdminAffiliatesSummary(): AdminAffiliatesSummary {
    const defaultRate = cachedSettings.defaultCommissionRate || 15;
    const affiliates = cachedAffiliates.map(a => ({
      ...sanitizeAffiliateForResponse(a),
      commissionRate: (a.customCommissionRate !== null && a.customCommissionRate !== undefined && a.customCommissionRate > 0)
        ? a.customCommissionRate
        : defaultRate
    }));
    const totalAffiliates = affiliates.length;
    const activeAffiliates = affiliates.filter(a => a.status === 'active').length;
    const suspendedAffiliates = affiliates.filter(a => a.status === 'suspended').length;
    const pendingAffiliates = affiliates.filter(a => a.status === 'pending').length;

    const totalAffiliateClicks = affiliates.reduce((sum, a) => sum + (a.totalClicks || 0), 0);
    const totalAffiliateSales = cachedCommissions.length;
    const totalRevenueGeneratedKes = cachedCommissions.reduce((sum, c) => sum + c.saleAmountKes, 0);
    const totalCommissionsKes = cachedCommissions.reduce((sum, c) => sum + c.commissionAmountKes, 0);
    const pendingCommissionsKes = cachedCommissions.filter(c => c.status === 'PENDING').reduce((sum, c) => sum + c.commissionAmountKes, 0);
    const approvedCommissionsKes = cachedCommissions.filter(c => c.status === 'APPROVED').reduce((sum, c) => sum + c.commissionAmountKes, 0);
    const paidCommissionsKes = cachedCommissions.filter(c => c.status === 'PAID').reduce((sum, c) => sum + c.commissionAmountKes, 0);
    const outstandingBalanceKes = affiliates.reduce((sum, a) => sum + (a.balanceAvailableKes || 0), 0);

    const flaggedCount = cachedCommissions.filter(c => c.fraudFlag?.flagged && !c.fraudFlag.reviewed).length;
    const affiliateIdsWithVerifiedSales = new Set(
      cachedCommissions
        .filter(isVerifiedAffiliateCommission)
        .map(commission => commission.affiliateId)
    );
    const affiliatesWithLifetimeSales = affiliates.filter(affiliate =>
      affiliateIdsWithVerifiedSales.has(affiliate.id)
    ).length;
    const affiliatesWithoutSales = totalAffiliates - affiliatesWithLifetimeSales;

    // Top performers (strictly admin only)
    const topAffiliates = affiliates
      .map(a => {
        const sales = cachedCommissions.filter(c => c.affiliateId === a.id);
        const revenue = sales.reduce((sum, s) => sum + s.saleAmountKes, 0);
        const earned = sales.reduce((sum, s) => sum + s.commissionAmountKes, 0);
        const clicks = a.totalClicks || 0;
        const conversionRate = clicks > 0 ? Number(((sales.length / clicks) * 100).toFixed(1)) : 0;
        return {
          id: a.id,
          name: a.name,
          affiliateCode: a.affiliateCode,
          salesCount: sales.length,
          revenueKes: revenue,
          commissionEarnedKes: earned,
          conversionRate
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
      periods: buildLiteraryCirclePerformancePeriods({
        commissions: cachedCommissions.filter(commission => commission.affiliateId === affiliate.id),
        settings: cachedLiteraryCircleSettings,
        now: performanceNow,
        periodCount: 6,
      }),
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
      affiliates,
      recentSales: cachedCommissions.slice(0, 50),
      payouts: cachedPayouts,
      campaigns: cachedCampaigns,
      settings: cachedSettings,
      auditLogs: this.getAuditLogs(50),
      flaggedCount,
      affiliatesWithLifetimeSales,
      affiliatesWithoutSales,
      literaryCircleSettings: normalizeLiteraryCircleSettings(cachedLiteraryCircleSettings),
      literaryCirclePerformance,
      topAffiliates
    };
  },

  getAdminAffiliateAnalytics(options: {
    startDate?: string;
    endDate?: string;
    filters?: AffiliateAnalyticsFilters;
    now?: Date;
  } = {}): AffiliateAnalyticsReport {
    return buildAffiliateAnalyticsReport({
      affiliates: cachedAffiliates,
      commissions: cachedCommissions,
      clickEvents: cachedClicks,
      // The local click ledger is retained for only 90 days and capped, so it
      // must never be represented as complete historical coverage.
      clickHistoryCompleteForWindow: false,
      startDate: options.startDate,
      endDate: options.endDate,
      filters: options.filters,
      now: options.now,
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


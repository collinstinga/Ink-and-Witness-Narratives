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
  AffiliateStatus,
  CommissionStatus,
  PayoutStatus,
  PaymentTransaction,
  AffiliateSession
} from '../types.js';
import { isCurrentAffiliatePasswordHash } from './affiliateCredentials.js';
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

const DATA_DIR = path.join(process.cwd(), 'data');
const AFFILIATES_FILE = path.join(DATA_DIR, 'affiliates.json');
const COMMISSIONS_FILE = path.join(DATA_DIR, 'affiliate_commissions.json');
const CLICKS_FILE = path.join(DATA_DIR, 'affiliate_clicks.json');
const PAYOUTS_FILE = path.join(DATA_DIR, 'affiliate_payouts.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'affiliate_campaigns.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'affiliate_settings.json');
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
  campaign?: AffiliateCampaign
): number {
  if (campaign?.isActive && campaign.commissionRate > 0 && campaign.commissionRate <= 100) {
    if (!campaign.eligiblePieceIds || campaign.eligiblePieceIds.length === 0 || campaign.eligiblePieceIds.includes(articleId)) {
      return campaign.commissionRate;
    }
  }

  if (settings.pieceCommissionOverrides?.[articleId] !== undefined) {
    const pieceRate = Number(settings.pieceCommissionOverrides[articleId]);
    if (Number.isFinite(pieceRate) && pieceRate > 0 && pieceRate <= 100) {
      return pieceRate;
    }
  }

  if (affiliate.customCommissionRate !== null && affiliate.customCommissionRate !== undefined && affiliate.customCommissionRate > 0 && affiliate.customCommissionRate <= 100) {
    return affiliate.customCommissionRate;
  }

  return settings.defaultCommissionRate || DEFAULT_AFFILIATE_SETTINGS.defaultCommissionRate;
}

// In-Memory state
let cachedAffiliates: AffiliateAccount[] = [];
let cachedCommissions: AffiliateSaleCommission[] = [];
let cachedClicks: AffiliateClickEvent[] = [];
let cachedPayouts: AffiliatePayoutRequest[] = [];
let cachedCampaigns: AffiliateCampaign[] = [];
let cachedSettings: AffiliateSettings = normalizeAffiliateSettings(undefined);
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

    // 1. Load Settings from Firestore / JSON
    try {
      const fsSettings = await getFirestoreDoc<AffiliateSettings>('site_configs', 'affiliate_settings');
      if (fsSettings) {
        cachedSettings = { ...cachedSettings, ...fsSettings };
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
      } else if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8');
        cachedSettings = { ...cachedSettings, ...JSON.parse(raw) };
        setFirestoreDoc('site_configs', 'affiliate_settings', cachedSettings).catch(() => {});
      } else {
        writeJsonFileSync(SETTINGS_FILE, cachedSettings);
        setFirestoreDoc('site_configs', 'affiliate_settings', cachedSettings).catch(() => {});
      }
    } catch {
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    }

    // 2. Load Affiliates from Firestore / JSON
    try {
      const fsAffiliates = await getAllFirestoreDocs<AffiliateAccount>('affiliates');
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
      const fsCommissions = await getAllFirestoreDocs<AffiliateSaleCommission>('affiliate_commissions');
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
      const fsPayouts = await getAllFirestoreDocs<AffiliatePayoutRequest>('affiliate_payouts');
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
      const fsCampaigns = await getAllFirestoreDocs<AffiliateCampaign>('affiliate_campaigns');
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
      const fsAudit = await getAllFirestoreDocs<AffiliateAuditLogEntry>('affiliate_audit');
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

  saveSettings(patch: Partial<AffiliateSettings>, actor = 'Admin'): AffiliateSettings {
    const prev = { ...cachedSettings };
    cachedSettings = {
      ...cachedSettings,
      ...patch,
      pieceCommissionOverrides: patch.pieceCommissionOverrides || cachedSettings.pieceCommissionOverrides || {}
    };
    writeJsonFileSync(SETTINGS_FILE, cachedSettings);
    setFirestoreDoc('site_configs', 'affiliate_settings', cachedSettings).catch(() => {});
    this.recordAudit(actor, 'settings_updated', 'settings', 'Updated affiliate global configuration', undefined, prev, cachedSettings);
    return cachedSettings;
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
      status: data.status || 'active',
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
    return calculateCommissionRateFromRecords(affiliate, articleId, cachedSettings, campaign);
  },

  async recordAffiliateSale(tx: PaymentTransaction, affiliateRefCode?: string, campaignCode?: string): Promise<AffiliateSaleCommission | null> {
    if (!affiliateRefCode) return null;
    const cleanAffiliateCode = affiliateRefCode.trim().toUpperCase();
    if (!cleanAffiliateCode) return null;
    if (!['CONFIRMED', 'SUCCESS', 'PAID'].includes(tx.status)) return null;
    if (!transactionHasValidAffiliateAttribution(tx)) return null;
    const saleAmountKes = Number(tx.amount);
    if (!Number.isFinite(saleAmountKes) || saleAmountKes <= 0 || saleAmountKes > 1_000_000) return null;
    const attributedAtMs = tx.affiliateAttributionAt
      ? Date.parse(tx.affiliateAttributionAt)
      : Date.parse(tx.createdAt);
    const now = new Date().toISOString();
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
      const settingsSnapshot = await firestoreTransaction.get(settingsRef);
      const freshSettings = normalizeAffiliateSettings(
        settingsSnapshot.exists ? settingsSnapshot.data() : undefined
      );

      let freshCampaign: AffiliateCampaign | undefined;
      let campaignRef: any;
      if (campaignCode) {
        const campaignQuery = db.collection('affiliate_campaigns')
          .where('code', '==', campaignCode.trim().toUpperCase())
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
            candidate.code?.trim().toUpperCase() === campaignCode?.trim().toUpperCase() &&
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
      if (freshAffiliate.allowedPieceIds?.length && !freshAffiliate.allowedPieceIds.includes(tx.articleId)) {
        return {
          created: false,
          commission: null,
          affiliateId: freshAffiliate.id,
          freshAffiliate,
          freshCampaign,
          freshSettings
        };
      }

      const commissionRate = calculateCommissionRateFromRecords(
        freshAffiliate,
        tx.articleId,
        freshSettings,
        freshCampaign
      );
      const commissionAmountKes = Math.round(saleAmountKes * (commissionRate / 100));
      const grossCreatorRevenueKes = saleAmountKes - commissionAmountKes;

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

      const autoApprove = freshSettings.autoApproveCommissions;
      const status: CommissionStatus = isSelfReferral ? 'REJECTED' : (autoApprove ? 'APPROVED' : 'PENDING');
      const effectiveCommissionAmount = isSelfReferral ? 0 : commissionAmountKes;
      const commission: AffiliateSaleCommission = {
        id: commissionId,
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
        fraudFlag: isSelfReferral ? {
          flagged: true,
          reason: 'Self-referral prohibited: Buyer contact matches affiliate profile.',
          severity: 'high',
          reviewed: true
        } : undefined,
        createdAt: now,
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
        freshSettings
      };
    });

    if (persisted.freshSettings) {
      cachedSettings = persisted.freshSettings;
      writeJsonFileSync(SETTINGS_FILE, cachedSettings);
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

    const amount = requestedAmountKes ? Math.min(requestedAmountKes, available) : available;
    if (amount <= 0) {
      throw new Error("Payout amount must be greater than zero.");
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

    cachedAuditLogs.unshift(entry);
    if (cachedAuditLogs.length > 1000) {
      cachedAuditLogs = cachedAuditLogs.slice(0, 1000);
    }
    writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
    setFirestoreDoc('affiliate_audit', entry.id, entry).catch(() => {});
    return entry;
  },

  getAuditLogs(limit = 100): AffiliateAuditLogEntry[] {
    return cachedAuditLogs.slice(0, limit).map(entry => sanitizeAuditValue(entry));
  },

  // STRICTLY PRIVATE AFFILIATE DASHBOARD
  getAffiliateDashboard(affiliateId: string): AffiliateDashboardStats | null {
    const affiliate = this.getAffiliateById(affiliateId);
    if (!affiliate) return null;

    // Filter ONLY this affiliate's sales with ANONYMIZED customer info
    const sales = cachedCommissions
      .filter(c => c.affiliateId === affiliate.id)
      .map(c => ({
        id: c.id,
        affiliateId: c.affiliateId,
        affiliateCode: c.affiliateCode,
        affiliateName: c.affiliateName,
        transactionId: c.transactionId,
        receiptNumber: c.receiptNumber,
        articleId: c.articleId,
        articleTitle: c.articleTitle,
        saleAmountKes: c.saleAmountKes,
        currency: c.currency || 'KES',
        originalAmount: c.originalAmount || c.saleAmountKes,
        commissionRate: c.commissionRate,
        commissionAmountKes: c.commissionAmountKes,
        grossCreatorRevenueKes: c.grossCreatorRevenueKes,
        paymentMethod: c.paymentMethod,
        status: c.status,
        createdAt: c.createdAt,
        approvedAt: c.approvedAt,
        paidAt: c.paidAt
      }));

    const payouts = cachedPayouts.filter(p => p.affiliateId === affiliate.id);
    const activeCampaigns = cachedCampaigns.filter(c => c.isActive);

    const commissionEarned = sales.reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionPending = sales.filter(s => s.status === 'PENDING').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionApproved = sales.filter(s => s.status === 'APPROVED').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const commissionPaid = sales.filter(s => s.status === 'PAID').reduce((acc, s) => acc + s.commissionAmountKes, 0);
    const totalRevenue = sales.reduce((acc, s) => acc + s.saleAmountKes, 0);
    const activeRate = (affiliate.customCommissionRate !== null && affiliate.customCommissionRate !== undefined && affiliate.customCommissionRate > 0)
      ? affiliate.customCommissionRate
      : (cachedSettings.defaultCommissionRate || 15);

    const safeAffiliate = {
      ...sanitizeAffiliateForResponse(affiliate),
      commissionRate: activeRate
    };

    return {
      affiliate: safeAffiliate,
      clicks: affiliate.totalClicks || 0,
      uniqueVisitors: affiliate.uniqueVisitors || 0,
      totalPiecesSold: sales.length,
      totalConfirmedSales: sales.filter(s => s.status === 'APPROVED' || s.status === 'PAID').length,
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
      }
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
      topAffiliates
    };
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


import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { 
  getDb, 
  setFirestoreDoc, 
  getFirestoreDoc, 
  deleteFirestoreDoc, 
  getAllFirestoreDocs 
} from './db.js';
import { 
  AffiliateAccount, 
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
  PaymentTransaction
} from '../types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const AFFILIATES_FILE = path.join(DATA_DIR, 'affiliates.json');
const COMMISSIONS_FILE = path.join(DATA_DIR, 'affiliate_commissions.json');
const CLICKS_FILE = path.join(DATA_DIR, 'affiliate_clicks.json');
const PAYOUTS_FILE = path.join(DATA_DIR, 'affiliate_payouts.json');
const CAMPAIGNS_FILE = path.join(DATA_DIR, 'affiliate_campaigns.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'affiliate_settings.json');
const AUDIT_FILE = path.join(DATA_DIR, 'affiliate_audit.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'affiliate_sessions.json');

// In-Memory state
let cachedAffiliates: AffiliateAccount[] = [];
let cachedCommissions: AffiliateSaleCommission[] = [];
let cachedClicks: AffiliateClickEvent[] = [];
let cachedPayouts: AffiliatePayoutRequest[] = [];
let cachedCampaigns: AffiliateCampaign[] = [];
let cachedSettings: AffiliateSettings = {
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
let cachedAuditLogs: AffiliateAuditLogEntry[] = [];
let cachedSessions: Map<string, { affiliateId: string; createdAt: number; expiresAt: number }> = new Map();

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

// Password hashing utility using PBKDF2 with dynamic salt and timing-safe verification
export function hashAffiliatePassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password is required.');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512').toString('hex');
  return `pbkdf2:${salt}:${derivedKey}`;
}

export function verifyAffiliatePassword(password: string, hash: string): boolean {
  if (!hash || !password) return false;
  try {
    if (hash.startsWith('pbkdf2:')) {
      const parts = hash.split(':');
      if (parts.length !== 3) return false;
      const [, salt, originalKey] = parts;
      const checkKey = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512').toString('hex');
      return crypto.timingSafeEqual(Buffer.from(checkKey), Buffer.from(originalKey));
    }
    // Backward compatibility for legacy SHA-256 hashes
    const legacySalt = "ink_witness_affiliate_salt_2026";
    const legacyHash = crypto.createHash('sha256').update(password + legacySalt).digest('hex');
    if (legacyHash.length !== hash.length) return false;
    return crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(hash));
  } catch (err) {
    return false;
  }
}

export const affiliateStore = {
  async init() {
    if (!process.env.VERCEL && !fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

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

    // 8. Load Sessions
    if (fs.existsSync(SESSIONS_FILE)) {
      try {
        const raw = fs.readFileSync(SESSIONS_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        cachedSessions.clear();
        if (parsed && typeof parsed === 'object') {
          for (const [token, data] of Object.entries(parsed)) {
            const s = data as { affiliateId: string; createdAt: number; expiresAt: number };
            if (s.expiresAt > Date.now()) {
              cachedSessions.set(token, s);
            }
          }
        }
      } catch {}
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
  getAffiliates(filter?: { status?: string }): AffiliateAccount[] {
    const defaultRate = cachedSettings.defaultCommissionRate || 15;
    let list = cachedAffiliates.map(a => ({
      ...a,
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

  createAffiliate(data: Partial<AffiliateAccount>, actor = 'System'): AffiliateAccount {
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

    // Check duplicate code
    if (this.getAffiliateByCode(affiliateCode)) {
      affiliateCode = `${affiliateCode}${crypto.randomInt(10, 100)}`;
    }

    const id = `aff_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = new Date().toISOString();

    const newAffiliate: AffiliateAccount = {
      id,
      affiliateCode,
      name: (data.name || '').trim(),
      email,
      phone: (data.phone || '').trim(),
      passwordHash: data.passwordHash || hashAffiliatePassword("affiliate123"),
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
      updatedAt: now
    };

    cachedAffiliates.unshift(newAffiliate);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', newAffiliate.id, newAffiliate).catch(() => {});
    this.recordAudit(actor, 'affiliate_created', 'affiliate', `Created affiliate ${newAffiliate.name} (${newAffiliate.affiliateCode})`, id, null, newAffiliate);

    return newAffiliate;
  },

  acceptAffiliateTerms(id: string, termsVersion = '2026.1', actor = 'Affiliate'): AffiliateAccount {
    const affiliate = this.getAffiliateById(id);
    if (!affiliate) {
      throw new Error("Affiliate not found.");
    }
    const prev = { ...affiliate };
    const now = new Date().toISOString();
    affiliate.acceptedTerms = true;
    affiliate.termsVersion = termsVersion;
    affiliate.termsAcceptedAt = now;
    affiliate.updatedAt = now;

    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});
    this.recordAudit(actor, 'terms_accepted', 'affiliate', `Affiliate ${affiliate.name} accepted Terms & Conditions (Version: ${termsVersion})`, id, prev, affiliate);
    return affiliate;
  },

  updateAffiliate(id: string, patch: Partial<AffiliateAccount>, actor = 'Admin'): AffiliateAccount {
    const index = cachedAffiliates.findIndex(a => a.id === id);
    if (index < 0) {
      throw new Error("Affiliate not found.");
    }

    const prev = { ...cachedAffiliates[index] };
    const updated: AffiliateAccount = {
      ...prev,
      ...patch,
      payoutDetails: {
        ...prev.payoutDetails,
        ...(patch.payoutDetails || {})
      },
      updatedAt: new Date().toISOString()
    };

    cachedAffiliates[index] = updated;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', updated.id, updated).catch(() => {});
    this.recordAudit(actor, 'affiliate_updated', 'affiliate', `Updated profile/settings for ${updated.name} (${updated.affiliateCode})`, id, prev, updated);

    return updated;
  },

  setAffiliateStatus(id: string, status: AffiliateStatus, actor = 'Admin', reason?: string): AffiliateAccount {
    const affiliate = this.getAffiliateById(id);
    if (!affiliate) {
      throw new Error("Affiliate not found.");
    }
    const prevStatus = affiliate.status;
    affiliate.status = status;
    affiliate.updatedAt = new Date().toISOString();
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});
    this.recordAudit(actor, 'status_change', 'affiliate', `Changed status of ${affiliate.name} from ${prevStatus} to ${status}${reason ? ` (${reason})` : ''}`, id, { status: prevStatus }, { status });
    return affiliate;
  },

  toggleAffiliateLinks(id: string, disabled: boolean, actor = 'Admin'): AffiliateAccount {
    const affiliate = this.getAffiliateById(id);
    if (!affiliate) {
      throw new Error("Affiliate not found.");
    }
    affiliate.linksDisabled = disabled;
    affiliate.updatedAt = new Date().toISOString();
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});
    this.recordAudit(actor, 'links_toggle', 'link', `${disabled ? 'Disabled' : 'Enabled'} referral links for ${affiliate.name} (${affiliate.affiliateCode})`, id, { linksDisabled: !disabled }, { linksDisabled: disabled });
    return affiliate;
  },

  deleteAffiliate(id: string, actor = 'Admin'): boolean {
    const idx = cachedAffiliates.findIndex(a => a.id === id);
    if (idx < 0) return false;
    const deleted = cachedAffiliates[idx];
    cachedAffiliates.splice(idx, 1);
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    deleteFirestoreDoc('affiliates', id).catch(() => {});
    this.recordAudit(actor, 'affiliate_deleted', 'affiliate', `Deleted affiliate ${deleted.name} (${deleted.affiliateCode})`, id);
    return true;
  },

  // CLICKS & FUNNEL TRACKING
  registerClick(code: string, articleId?: string, campaignCode?: string, ipHash?: string, userAgent?: string, referrer?: string): { valid: boolean; affiliate?: AffiliateAccount } {
    const affiliate = this.getAffiliateByCode(code);
    if (!affiliate || affiliate.status !== 'active' || affiliate.linksDisabled) {
      return { valid: false };
    }

    const nowMs = Date.now();
    const retentionCutoff = nowMs - 90 * 24 * 60 * 60 * 1000;
    cachedClicks = cachedClicks.filter(click => {
      const timestamp = new Date(click.timestamp).getTime();
      return Number.isFinite(timestamp) && timestamp >= retentionCutoff;
    });

    const duplicate = cachedClicks.some(click =>
      click.affiliateCode === affiliate.affiliateCode &&
      click.articleId === articleId &&
      click.campaignCode === campaignCode &&
      click.ipHash === ipHash &&
      nowMs - new Date(click.timestamp).getTime() < 30 * 60 * 1000
    );
    if (duplicate) {
      return { valid: true, affiliate };
    }

    const now = new Date(nowMs).toISOString();
    const clickEvent: AffiliateClickEvent = {
      id: `clk_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      affiliateCode: affiliate.affiliateCode,
      affiliateId: affiliate.id,
      articleId,
      campaignCode,
      ipHash,
      userAgent: (userAgent || '').substring(0, 150),
      referrer: (referrer || '').substring(0, 200),
      timestamp: now
    };

    cachedClicks.push(clickEvent);
    // Keep max 5000 click events in memory/disk
    if (cachedClicks.length > 5000) {
      cachedClicks = cachedClicks.slice(-5000);
    }
    writeJsonFileSync(CLICKS_FILE, cachedClicks);
    // Raw click documents are intentionally not persisted to Firestore. Only
    // bounded aggregate counters are stored, protecting the Spark write quota.

    affiliate.totalClicks = (affiliate.totalClicks || 0) + 1;
    // Estimate unique visitor if new IP hash
    const pastClicksWithIp = cachedClicks.filter(c => c.affiliateCode === affiliate.affiliateCode && c.ipHash === ipHash);
    if (pastClicksWithIp.length <= 1) {
      affiliate.uniqueVisitors = (affiliate.uniqueVisitors || 0) + 1;
    }
    affiliate.lastActivityAt = now;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});

    // Update campaign stats if campaign attached
    if (campaignCode) {
      const camp = cachedCampaigns.find(c => c.code.toUpperCase() === campaignCode.toUpperCase());
      if (camp) {
        camp.clicksCount = (camp.clicksCount || 0) + 1;
        writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
        setFirestoreDoc('affiliate_campaigns', camp.id, camp).catch(() => {});
      }
    }

    console.log(`[Referral Click] Affiliate: ${affiliate.affiliateCode}, Article: ${articleId || 'all'}, Campaign: ${campaignCode || 'none'}`);

    return { valid: true, affiliate };
  },

  // RECONCILIATION OF PREVIOUS CONFIRMED TRANSACTIONS
  reconcileTransactions(transactions: PaymentTransaction[]): number {
    if (!Array.isArray(transactions) || transactions.length === 0) return 0;
    let reconciledCount = 0;
    for (const tx of transactions) {
      const isConfirmed = tx.status === 'CONFIRMED' || tx.status === 'SUCCESS' || tx.status === 'PAID';
      if (isConfirmed && tx.affiliateCode) {
        try {
          const comm = this.recordAffiliateSale(tx, tx.affiliateCode, tx.campaignCode);
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
    // 1. Campaign rate override if valid active campaign
    if (campaignCode) {
      const camp = cachedCampaigns.find(c => c.code.toUpperCase() === campaignCode.toUpperCase() && c.isActive);
      if (camp && camp.commissionRate > 0) {
        if (!camp.eligiblePieceIds || camp.eligiblePieceIds.length === 0 || camp.eligiblePieceIds.includes(articleId)) {
          return camp.commissionRate;
        }
      }
    }

    // 2. Piece-specific commission override in Settings
    if (cachedSettings.pieceCommissionOverrides && cachedSettings.pieceCommissionOverrides[articleId] !== undefined) {
      const pieceRate = Number(cachedSettings.pieceCommissionOverrides[articleId]);
      if (!isNaN(pieceRate) && pieceRate > 0) {
        return pieceRate;
      }
    }

    // 3. Individual affiliate custom commission rate
    if (affiliate.customCommissionRate !== null && affiliate.customCommissionRate !== undefined && affiliate.customCommissionRate > 0) {
      return affiliate.customCommissionRate;
    }

    // 4. Global default rate
    return cachedSettings.defaultCommissionRate || 15;
  },

  recordAffiliateSale(tx: PaymentTransaction, affiliateRefCode?: string, campaignCode?: string): AffiliateSaleCommission | null {
    if (!affiliateRefCode) return null;

    // Tips rule: Tips do not generate commission unless explicitly enabled by writer
    if (tx.type === 'TIP' && !cachedSettings.allowTipsCommission) {
      return null;
    }

    const affiliate = this.getAffiliateByCode(affiliateRefCode);
    if (!affiliate || affiliate.status !== 'active' || affiliate.linksDisabled) {
      return null;
    }

    // Check piece eligibility if affiliate is restricted to specific pieces
    if (affiliate.allowedPieceIds && affiliate.allowedPieceIds.length > 0) {
      if (!affiliate.allowedPieceIds.includes(tx.articleId)) {
        return null;
      }
    }

    // Idempotency: Avoid double-crediting if same transaction is confirmed multiple times
    const existing = cachedCommissions.find(c => 
      c.transactionId === tx.id || 
      (c.receiptNumber && tx.mpesaReceiptNumber && c.receiptNumber === tx.mpesaReceiptNumber)
    );
    if (existing) {
      console.log(`[Affiliate Commission Duplicate Prevention] Commission already exists for Transaction ID: ${tx.id}, Receipt: ${tx.mpesaReceiptNumber || tx.receiptNumber}. Skipping duplicate.`);
      return existing;
    }

    // Determine purchase amount in KES
    const saleAmountKes = Number(tx.amount) || 1500;
    const commissionRate = this.calculateCommissionRate(affiliate, tx.articleId, campaignCode);
    const commissionAmountKes = Math.round(saleAmountKes * (commissionRate / 100));
    const grossCreatorRevenueKes = saleAmountKes - commissionAmountKes;

    // Detect self-referral (buyer phone or email matches affiliate)
    let isSelfReferral = false;
    if (tx.phoneNumber && affiliate.phone) {
      const cleanBuyerPhone = tx.phoneNumber.replace(/[^0-9]/g, '').slice(-9);
      const cleanAffPhone = affiliate.phone.replace(/[^0-9]/g, '').slice(-9);
      if (cleanBuyerPhone && cleanAffPhone && cleanBuyerPhone === cleanAffPhone) {
        isSelfReferral = true;
      }
    }
    if (tx.userEmail && affiliate.email) {
      if (tx.userEmail.trim().toLowerCase() === affiliate.email.trim().toLowerCase()) {
        isSelfReferral = true;
      }
    }

    const now = new Date().toISOString();
    const autoApprove = cachedSettings.autoApproveCommissions;
    const status: CommissionStatus = isSelfReferral ? 'REJECTED' : (autoApprove ? 'APPROVED' : 'PENDING');
    const effectiveCommissionAmount = isSelfReferral ? 0 : commissionAmountKes;

    const commission: AffiliateSaleCommission = {
      id: `com_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      affiliateId: affiliate.id,
      affiliateCode: affiliate.affiliateCode,
      affiliateName: affiliate.name,
      transactionId: tx.id,
      checkoutRequestId: tx.checkoutRequestId,
      receiptNumber: tx.mpesaReceiptNumber || tx.bankReference || `REC-${Date.now().toString().slice(-6)}`,
      articleId: tx.articleId,
      articleTitle: tx.articleTitle || "Monograph",
      saleAmountKes,
      currency: tx.currency || "KES",
      originalAmount: tx.originalAmount || saleAmountKes,
      commissionRate: isSelfReferral ? 0 : commissionRate,
      commissionAmountKes: effectiveCommissionAmount,
      grossCreatorRevenueKes: isSelfReferral ? saleAmountKes : grossCreatorRevenueKes,
      paymentMethod: tx.paymentMethod || 'mpesa',
      status,
      campaignCode,
      fraudFlag: isSelfReferral ? {
        flagged: true,
        reason: "Self-referral prohibited: Buyer contact matches affiliate profile.",
        severity: 'high',
        reviewed: true
      } : undefined,
      createdAt: now,
      approvedAt: (!isSelfReferral && autoApprove) ? now : undefined
    };

    cachedCommissions.unshift(commission);
    writeJsonFileSync(COMMISSIONS_FILE, cachedCommissions);
    setFirestoreDoc('affiliate_commissions', commission.id, commission).catch(() => {});

    // Update Affiliate account balance & stats (only if not self-referral)
    affiliate.totalSalesCount = (affiliate.totalSalesCount || 0) + 1;
    affiliate.totalRevenueKes = (affiliate.totalRevenueKes || 0) + saleAmountKes;
    if (!isSelfReferral) {
      affiliate.totalCommissionEarnedKes = (affiliate.totalCommissionEarnedKes || 0) + commissionAmountKes;
      if (status === 'APPROVED') {
        affiliate.balanceAvailableKes = (affiliate.balanceAvailableKes || 0) + commissionAmountKes;
      } else {
        affiliate.balancePendingKes = (affiliate.balancePendingKes || 0) + commissionAmountKes;
      }
    }
    affiliate.lastActivityAt = now;
    writeJsonFileSync(AFFILIATES_FILE, cachedAffiliates);
    setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});

    // Update campaign stats if campaign attached
    if (campaignCode) {
      const camp = cachedCampaigns.find(c => c.code.toUpperCase() === campaignCode.toUpperCase());
      if (camp) {
        camp.salesCount = (camp.salesCount || 0) + 1;
        camp.revenueKes = (camp.revenueKes || 0) + saleAmountKes;
        camp.commissionsKes = (camp.commissionsKes || 0) + commissionAmountKes;
        writeJsonFileSync(CAMPAIGNS_FILE, cachedCampaigns);
        setFirestoreDoc('affiliate_campaigns', camp.id, camp).catch(() => {});
      }
    }

    this.recordAudit('System', 'commission_generated', 'commission', `Generated KES ${commissionAmountKes} commission (${commissionRate}%) for ${affiliate.name} on piece "${commission.articleTitle}" (Receipt: ${commission.receiptNumber})`, commission.id, null, commission);

    console.log(`[Affiliate Commission Created] Commission ID: ${commission.id}, Affiliate: ${affiliate.affiliateCode} (${affiliate.name}), Article: "${commission.articleTitle}", Sale: KES ${saleAmountKes}, Rate: ${commissionRate}%, Commission Earned: KES ${commissionAmountKes}, Status: ${status}, Tx ID: ${tx.id}, Receipt: ${commission.receiptNumber}`);

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
        setFirestoreDoc('affiliates', affiliate.id, affiliate).catch(() => {});
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
      previousValue: previousValue ? JSON.parse(JSON.stringify(previousValue)) : undefined,
      newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : undefined
    };

    cachedAuditLogs.unshift(entry);
    if (cachedAuditLogs.length > 1000) {
      cachedAuditLogs = cachedAuditLogs.slice(0, 1000);
    }
    writeJsonFileSync(AUDIT_FILE, cachedAuditLogs);
    return entry;
  },

  getAuditLogs(limit = 100): AffiliateAuditLogEntry[] {
    return cachedAuditLogs.slice(0, limit);
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

    const { passwordHash, ...safeAffiliateBase } = affiliate;
    const safeAffiliate = {
      ...safeAffiliateBase,
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
      ...a,
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
      auditLogs: cachedAuditLogs.slice(0, 50),
      flaggedCount,
      topAffiliates
    };
  },

  // SESSIONS
  createAffiliateSession(affiliateId: string): string {
    const random = crypto.randomBytes(24).toString('hex');
    const token = `aff_sess_${Date.now()}_${random}`;
    const expiresAt = Date.now() + 14 * 24 * 60 * 60 * 1000; // 14 days
    cachedSessions.set(token, { affiliateId, createdAt: Date.now(), expiresAt });
    writeJsonFileSync(SESSIONS_FILE, Object.fromEntries(cachedSessions));
    return token;
  },

  verifyAffiliateSession(token?: string | null): AffiliateAccount | null {
    if (!token) return null;
    const session = cachedSessions.get(token);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      cachedSessions.delete(token);
      writeJsonFileSync(SESSIONS_FILE, Object.fromEntries(cachedSessions));
      return null;
    }
    const affiliate = this.getAffiliateById(session.affiliateId);
    if (!affiliate || affiliate.status === 'suspended') {
      return null;
    }
    return affiliate;
  },

  invalidateAffiliateSession(token: string) {
    cachedSessions.delete(token);
    writeJsonFileSync(SESSIONS_FILE, Object.fromEntries(cachedSessions));
  }
};


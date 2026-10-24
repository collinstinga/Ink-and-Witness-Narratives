import type { Firestore, Query, Transaction } from 'firebase-admin/firestore';
import type {
  AffiliateAccount, AffiliateAuditLogEntry, AffiliateCampaign, AffiliatePayoutRequest,
  AffiliateSaleCommission, AffiliateSettings, LiteraryCircleSettings,
} from '../types.js';
import { verifiedCanonicalAffiliateCommissions } from './affiliateAnalytics.js';
import { recordedAffiliateCommissionPaidKes } from './salesLedger.js';

export const AFFILIATE_FINANCIAL_READ_LIMITS = Object.freeze({
  affiliates: 200, commissions: 5_000, payouts: 1_000, campaigns: 500,
});

export class AffiliateFinancialReadError extends Error {
  readonly code = 'AFFILIATE_FINANCIAL_UNAVAILABLE';
  readonly statusCode = 503;
  constructor(message = 'Current affiliate financial records could not be loaded. Please retry; no cached balances were substituted.') {
    super(message);
    this.name = 'AffiliateFinancialReadError';
  }
}

export interface AffiliateFinancialSnapshot {
  affiliates: AffiliateAccount[];
  commissions: AffiliateSaleCommission[];
  payouts: AffiliatePayoutRequest[];
  campaigns: AffiliateCampaign[];
  settings: AffiliateSettings;
  literaryCircleSettings?: LiteraryCircleSettings;
  auditLogs: AffiliateAuditLogEntry[];
}

async function boundedRows<T>(transaction: Transaction, query: Query, limit: number, label: string): Promise<T[]> {
  const snapshot = await transaction.get(query.limit(limit + 1));
  if (snapshot.docs.length > limit) {
    throw new AffiliateFinancialReadError(`The ${label} ledger exceeds this view's safe limit (${limit}). A paginated report is required; partial totals were not displayed.`);
  }
  return snapshot.docs.map(document => ({ ...document.data(), id: document.id }) as T);
}

/** A single read-only snapshot, never a startup-cache fallback or a financial mutation. */
export async function readAffiliateFinancialSnapshot(options: {
  db: Firestore;
  affiliateId?: string;
  /** Compare after the transaction, so an overlapping local commit cannot regress its response. */
  isOutdated?: (snapshot: AffiliateFinancialSnapshot) => boolean;
}): Promise<AffiliateFinancialSnapshot | null> {
  const { db, affiliateId } = options;
  if (affiliateId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(affiliateId)) {
    throw new AffiliateFinancialReadError('A valid affiliate identifier is required.');
  }
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await db.runTransaction(async transaction => {
        const affiliateSnapshot = affiliateId
          ? await transaction.get(db.collection('affiliates').doc(affiliateId)) : null;
        if (affiliateId && !affiliateSnapshot?.exists) return null;
        const scope = (collection: string): Query => affiliateId
          ? db.collection(collection).where('affiliateId', '==', affiliateId)
          : db.collection(collection);
        const [affiliates, commissions, payouts, campaigns, settings, circle, audit] = await Promise.all([
          affiliateId
            ? Promise.resolve([{ ...affiliateSnapshot!.data(), id: affiliateId } as AffiliateAccount])
            : boundedRows<AffiliateAccount>(transaction, db.collection('affiliates'), AFFILIATE_FINANCIAL_READ_LIMITS.affiliates, 'affiliate'),
          boundedRows<AffiliateSaleCommission>(transaction, scope('affiliate_commissions'), AFFILIATE_FINANCIAL_READ_LIMITS.commissions, 'commission'),
          boundedRows<AffiliatePayoutRequest>(transaction, scope('affiliate_payouts'), AFFILIATE_FINANCIAL_READ_LIMITS.payouts, 'payout'),
          boundedRows<AffiliateCampaign>(transaction, db.collection('affiliate_campaigns'), AFFILIATE_FINANCIAL_READ_LIMITS.campaigns, 'campaign'),
          transaction.get(db.collection('site_configs').doc('affiliate_settings')),
          transaction.get(db.collection('site_configs').doc('affiliate_literary_circle')),
          affiliateId ? Promise.resolve(null) : transaction.get(db.collection('affiliate_audit').orderBy('timestamp', 'desc').limit(50)),
        ]);
        if (!settings.exists) throw new AffiliateFinancialReadError('Affiliate financial settings are unavailable. No previous payout policy was substituted.');
        return {
          affiliates, commissions, payouts, campaigns,
          settings: settings.data() as AffiliateSettings,
          ...(circle.exists ? { literaryCircleSettings: circle.data() as LiteraryCircleSettings } : {}),
          auditLogs: audit?.docs.map(document => ({ ...document.data(), id: document.id }) as AffiliateAuditLogEntry) || [],
        };
      }, { readOnly: true });
      if (!result || !options.isOutdated?.(result)) return result;
    }
    throw new AffiliateFinancialReadError('A newer wallet change was committed while this view was loading. Please refresh to see the current state.');
  } catch (error) {
    if (error instanceof AffiliateFinancialReadError) throw error;
    throw new AffiliateFinancialReadError();
  }
}

export function affiliateFinancialTotals(ledger: AffiliateSaleCommission[]) {
  const verified = verifiedCanonicalAffiliateCommissions(ledger);
  const totals = verified.reduce((total, commission) => {
    const amount = Number.isFinite(commission.commissionAmountKes) && commission.commissionAmountKes >= 0
      ? commission.commissionAmountKes : 0;
    const paid = recordedAffiliateCommissionPaidKes(commission);
    const reserved = commission.walletLedgerVersion === 1 && Number.isSafeInteger(commission.payoutReservedKes)
      && Number(commission.payoutReservedKes) >= 0 && paid + Number(commission.payoutReservedKes) <= amount
      ? Number(commission.payoutReservedKes) : 0;
    total.sales += 1;
    total.revenueKes += Number(commission.saleAmountKes);
    total.earnedKes += amount;
    total.paidKes += paid;
    total.reservedKes += reserved;
    if (commission.status === 'PENDING') total.pendingKes += amount - paid - reserved;
    if (commission.status === 'APPROVED') total.approvedKes += amount - paid - reserved;
    return total;
  }, { sales: 0, revenueKes: 0, earnedKes: 0, paidKes: 0, pendingKes: 0, approvedKes: 0, reservedKes: 0 });
  return { ...totals, verified };
}

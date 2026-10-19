import crypto from 'crypto';
import type { AffiliateAccount, AffiliateAuditLogEntry } from '../types.js';
import { getDb, sanitizeForFirestore } from './db.js';

const SAFE_AFFILIATE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/;

export class AffiliateApprovalValidationError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AffiliateApprovalValidationError';
  }
}

export class AffiliateApprovalNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Affiliate account was not found.');
    this.name = 'AffiliateApprovalNotFoundError';
  }
}

export function hasValidAffiliateWriterApproval(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Pick<AffiliateAccount, 'approvedAt' | 'approvedBy'>;
  return typeof candidate.approvedAt === 'string'
    && Number.isFinite(Date.parse(candidate.approvedAt))
    && typeof candidate.approvedBy === 'string'
    && Boolean(candidate.approvedBy.trim());
}

export async function approveAffiliateAccount(
  affiliateIdValue: unknown,
  actorValue: unknown,
  options: { allowSuspendedReactivation?: boolean } = {},
): Promise<{ affiliate: AffiliateAccount; audit?: AffiliateAuditLogEntry }> {
  const affiliateId = typeof affiliateIdValue === 'string' ? affiliateIdValue.trim() : '';
  if (!SAFE_AFFILIATE_ID.test(affiliateId)) throw new AffiliateApprovalNotFoundError();
  const actor = typeof actorValue === 'string' && actorValue.trim()
    ? actorValue.trim().slice(0, 120)
    : 'Admin';
  const db = getDb();
  const affiliateRef = db.collection('affiliates').doc(affiliateId);
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(affiliateRef);
    if (!snapshot.exists) throw new AffiliateApprovalNotFoundError();
    const previous = { ...(snapshot.data() as AffiliateAccount), id: affiliateId };
    if (previous.status === 'suspended' && options.allowSuspendedReactivation !== true) {
      throw new AffiliateApprovalValidationError('Reactivate this suspended affiliate through the status control before confirming approval.');
    }
    if (hasValidAffiliateWriterApproval(previous) && previous.status === 'active') {
      return { affiliate: previous };
    }

    const now = new Date().toISOString();
    const existingApprovalAt = typeof previous.approvedAt === 'string' && Number.isFinite(Date.parse(previous.approvedAt))
      ? new Date(previous.approvedAt).toISOString()
      : undefined;
    const existingApprovalBy = typeof previous.approvedBy === 'string' && previous.approvedBy.trim()
      ? previous.approvedBy.trim().slice(0, 120)
      : undefined;
    const affiliate: AffiliateAccount = {
      ...previous,
      status: 'active',
      approvedAt: existingApprovalAt || now,
      approvedBy: existingApprovalBy || actor,
      updatedAt: now,
    };
    const audit: AffiliateAuditLogEntry = {
      id: `aud_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: now,
      actor,
      action: 'affiliate_writer_approval_confirmed',
      targetType: 'affiliate',
      targetId: affiliateId,
      summary: `Confirmed writer approval for ${affiliate.name} (${affiliate.affiliateCode}).`,
      previousValue: {
        status: previous.status,
        approvedAt: previous.approvedAt,
        approvedBy: previous.approvedBy,
      },
      newValue: {
        status: affiliate.status,
        approvedAt: affiliate.approvedAt,
        approvedBy: affiliate.approvedBy,
      },
    };
    transaction.set(affiliateRef, sanitizeForFirestore({
      status: affiliate.status,
      approvedAt: affiliate.approvedAt,
      approvedBy: affiliate.approvedBy,
      updatedAt: affiliate.updatedAt,
    }), { merge: true });
    transaction.set(db.collection('affiliate_audit').doc(audit.id), sanitizeForFirestore(audit), { merge: false });
    return { affiliate, audit };
  });
}

import crypto from 'crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import type { VerifiedAffiliateAttribution } from './affiliateAttributionSecurity.js';
import { getDb } from './db.js';
import { normalizeAffiliateConversionSourceClick, type AffiliateConversionSourceClick } from './affiliateConversionCohort.js';

const CLAIM_COLLECTION = 'affiliate_attribution_claims';
const CLAIM_STORAGE_VERSION = 1;
const ATTRIBUTION_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const AFFILIATE_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const PUBLIC_IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CHECKOUT_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CHANNEL_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;
const CLAIM_DOCUMENT_ID_PATTERN = /^[a-f0-9]{64}$/;

export type AffiliateAttributionClaimResult = 'claimed' | 'in_progress' | 'consumed';

export type AffiliateAttributionClaimOptions = {
  checkoutArticleId: string;
  channel: string;
};

export type AffiliateAttributionClaimBinding = Partial<AffiliateConversionSourceClick> & {
  checkoutRequestId: string;
  checkoutArticleId: string;
  affiliateCode: string;
  campaignCode?: string;
  channel: 'mpesa' | 'bank';
  issuedAt: number;
  expiresAt: number;
};

type AffiliateAttributionClaimRecord = Partial<AffiliateConversionSourceClick> & {
  version: 1;
  status: 'claimed' | 'consumed';
  affiliateCode: string;
  campaignCode?: string;
  originArticleId?: string;
  checkoutArticleId: string;
  channel: string;
  issuedAt: number;
  expiresAt: number;
  claimedAt: number;
  consumedAt?: number;
  checkoutRequestId?: string;
};

function requireAttributionId(value: unknown): string {
  if (typeof value !== 'string' || !ATTRIBUTION_ID_PATTERN.test(value)) {
    throw new TypeError('A valid affiliate attribution ID is required.');
  }
  return value;
}

function requirePublicIdentifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !PUBLIC_IDENTIFIER_PATTERN.test(value.trim())) {
    throw new TypeError(`A valid ${label} is required.`);
  }
  return value.trim();
}

function normalizeAttribution(attribution: VerifiedAffiliateAttribution): VerifiedAffiliateAttribution {
  if (!attribution || typeof attribution !== 'object') {
    throw new TypeError('A verified affiliate attribution is required.');
  }
  const attributionId = requireAttributionId(attribution.attributionId);
  const ref = typeof attribution.ref === 'string' ? attribution.ref.trim().toLowerCase() : '';
  if (!AFFILIATE_CODE_PATTERN.test(ref)) {
    throw new TypeError('A valid affiliate code is required.');
  }
  const campaign = typeof attribution.campaign === 'string'
    ? attribution.campaign.trim().toLowerCase()
    : '';
  if (campaign && !AFFILIATE_CODE_PATTERN.test(campaign)) {
    throw new TypeError('A valid affiliate campaign is required.');
  }
  const articleId = typeof attribution.articleId === 'string'
    ? requirePublicIdentifier(attribution.articleId, 'origin article ID')
    : undefined;
  if (
    !Number.isSafeInteger(attribution.issuedAt) ||
    !Number.isSafeInteger(attribution.expiresAt) ||
    attribution.issuedAt < 0 ||
    attribution.expiresAt <= attribution.issuedAt
  ) {
    throw new TypeError('Valid affiliate attribution timestamps are required.');
  }
  return {
    attributionId,
    ref,
    ...(campaign ? { campaign } : {}),
    ...(articleId ? { articleId } : {}),
    issuedAt: attribution.issuedAt,
    expiresAt: attribution.expiresAt,
    ...normalizedSource(attribution),
  };
}

function normalizedSource(value: Partial<AffiliateConversionSourceClick>): Partial<AffiliateConversionSourceClick> {
  const hasSource = value.sourceClickEventId !== undefined || value.sourceClickKeySha256 !== undefined || value.sourceClickAt !== undefined;
  const source = normalizeAffiliateConversionSourceClick(value);
  if (hasSource && !source) throw new TypeError('A complete verified affiliate click source is required.');
  return source || {};
}

function normalizeOptions(options: AffiliateAttributionClaimOptions): AffiliateAttributionClaimOptions {
  if (!options || typeof options !== 'object') {
    throw new TypeError('Affiliate checkout claim options are required.');
  }
  const checkoutArticleId = requirePublicIdentifier(options.checkoutArticleId, 'checkout article ID');
  const channel = typeof options.channel === 'string' ? options.channel.trim().toLowerCase() : '';
  if (!CHANNEL_PATTERN.test(channel)) {
    throw new TypeError('A valid affiliate checkout channel is required.');
  }
  return { checkoutArticleId, channel };
}

function requireCheckoutRequestId(value: unknown): string {
  if (typeof value !== 'string' || !CHECKOUT_REQUEST_ID_PATTERN.test(value.trim())) {
    throw new TypeError('A valid checkout request ID is required.');
  }
  return value.trim();
}

function requireClaimDocumentId(value: unknown): string {
  if (typeof value !== 'string' || !CLAIM_DOCUMENT_ID_PATTERN.test(value)) {
    throw new TypeError('A valid affiliate attribution claim document ID is required.');
  }
  return value;
}

function normalizeBinding(binding: AffiliateAttributionClaimBinding): AffiliateAttributionClaimBinding {
  if (!binding || typeof binding !== 'object') {
    throw new TypeError('An affiliate attribution claim binding is required.');
  }
  const checkoutRequestId = requireCheckoutRequestId(binding.checkoutRequestId);
  const checkoutArticleId = requirePublicIdentifier(binding.checkoutArticleId, 'checkout article ID');
  const affiliateCode = typeof binding.affiliateCode === 'string'
    ? binding.affiliateCode.trim().toLowerCase()
    : '';
  if (!AFFILIATE_CODE_PATTERN.test(affiliateCode)) {
    throw new TypeError('A valid affiliate code is required.');
  }
  const campaignCode = binding.campaignCode === undefined
    ? undefined
    : typeof binding.campaignCode === 'string'
      ? binding.campaignCode.trim().toLowerCase()
      : '';
  if (campaignCode !== undefined && !AFFILIATE_CODE_PATTERN.test(campaignCode)) {
    throw new TypeError('A valid affiliate campaign is required.');
  }
  const channel = typeof binding.channel === 'string'
    ? binding.channel.trim().toLowerCase()
    : '';
  if (channel !== 'mpesa' && channel !== 'bank') {
    throw new TypeError('A valid affiliate checkout channel is required.');
  }
  if (
    !Number.isSafeInteger(binding.issuedAt) ||
    !Number.isSafeInteger(binding.expiresAt) ||
    binding.issuedAt < 0 ||
    binding.expiresAt <= binding.issuedAt
  ) {
    throw new TypeError('Valid affiliate attribution timestamps are required.');
  }
  return {
    checkoutRequestId,
    checkoutArticleId,
    affiliateCode,
    ...(campaignCode ? { campaignCode } : {}),
    channel,
    issuedAt: binding.issuedAt,
    expiresAt: binding.expiresAt,
    ...normalizedSource(binding),
  };
}

export function getAffiliateAttributionClaimDocumentId(rawId: string): string {
  const attributionId = requireAttributionId(rawId);
  return crypto.createHash('sha256').update(attributionId, 'utf8').digest('hex');
}

function getStatus(value: unknown): 'claimed' | 'consumed' | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const status = (value as Record<string, unknown>).status;
  return status === 'claimed' || status === 'consumed' ? status : null;
}

function claimMetadataMatchesBinding(
  value: Record<string, unknown>,
  binding: AffiliateAttributionClaimBinding
): boolean {
  return value.version === CLAIM_STORAGE_VERSION &&
    value.affiliateCode === binding.affiliateCode &&
    value.campaignCode === binding.campaignCode &&
    value.checkoutArticleId === binding.checkoutArticleId &&
    value.channel === binding.channel &&
    value.issuedAt === binding.issuedAt &&
    value.expiresAt === binding.expiresAt &&
    value.sourceClickEventId === binding.sourceClickEventId &&
    value.sourceClickKeySha256 === binding.sourceClickKeySha256 &&
    value.sourceClickAt === binding.sourceClickAt;
}

function consumedClaimMatchesBinding(
  value: Record<string, unknown>,
  binding: AffiliateAttributionClaimBinding
): boolean {
  return getStatus(value) === 'consumed' &&
    claimMetadataMatchesBinding(value, binding) &&
    value.checkoutRequestId === binding.checkoutRequestId;
}

/**
 * Atomically binds a reserved attribution claim to a checkout. Calling this
 * again with the same complete binding is idempotent; a replay with any
 * different checkout or attribution metadata fails closed.
 */
export async function consumeAffiliateAttributionClaimInTransaction(
  transaction: Transaction,
  db: Firestore,
  claimDocumentId: string,
  expected: AffiliateAttributionClaimBinding
): Promise<boolean> {
  const normalizedClaimDocumentId = requireClaimDocumentId(claimDocumentId);
  const normalizedExpected = normalizeBinding(expected);
  const claimRef = db.collection(CLAIM_COLLECTION).doc(normalizedClaimDocumentId);
  const snapshot = await transaction.get(claimRef);
  if (!snapshot.exists) return false;

  const value = snapshot.data();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (getStatus(value) === 'consumed') {
    return consumedClaimMatchesBinding(value, normalizedExpected);
  }
  if (
    getStatus(value) !== 'claimed' ||
    !claimMetadataMatchesBinding(value, normalizedExpected) ||
    value.checkoutRequestId !== undefined ||
    value.consumedAt !== undefined
  ) {
    return false;
  }

  transaction.update(claimRef, {
    status: 'consumed',
    consumedAt: Date.now(),
    checkoutRequestId: normalizedExpected.checkoutRequestId
  });
  return true;
}

/** Read-only proof that a checkout owns a consumed attribution claim. */
export async function verifyConsumedAffiliateAttributionClaimInTransaction(
  transaction: Transaction,
  db: Firestore,
  claimDocumentId: string,
  expected: AffiliateAttributionClaimBinding
): Promise<boolean> {
  return Boolean(await readConsumedAffiliateAttributionClaimInTransaction(transaction, db, claimDocumentId, expected));
}

/** The already verified private record is reused for same-transaction conversion enrichment. */
export async function readConsumedAffiliateAttributionClaimInTransaction(
  transaction: Transaction,
  db: Firestore,
  claimDocumentId: string,
  expected: AffiliateAttributionClaimBinding,
): Promise<Record<string, unknown> | null> {
  const normalizedClaimDocumentId = requireClaimDocumentId(claimDocumentId);
  const normalizedExpected = normalizeBinding(expected);
  const claimRef = db.collection(CLAIM_COLLECTION).doc(normalizedClaimDocumentId);
  const snapshot = await transaction.get(claimRef);
  if (!snapshot.exists) return null;

  const value = snapshot.data();
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    consumedClaimMatchesBinding(value, normalizedExpected)
  ) ? value : null;
}

export class AffiliateAttributionClaimStore {
  constructor(private readonly dbProvider: () => Firestore = getDb) {}

  async claim(
    attribution: VerifiedAffiliateAttribution,
    options: AffiliateAttributionClaimOptions
  ): Promise<AffiliateAttributionClaimResult> {
    const normalizedAttribution = normalizeAttribution(attribution);
    const normalizedOptions = normalizeOptions(options);
    const db = this.dbProvider();
    const claimRef = db.collection(CLAIM_COLLECTION)
      .doc(getAffiliateAttributionClaimDocumentId(normalizedAttribution.attributionId));

    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(claimRef);
      if (snapshot.exists) {
        return getStatus(snapshot.data()) === 'consumed' ? 'consumed' : 'in_progress';
      }

      const record: AffiliateAttributionClaimRecord = {
        version: CLAIM_STORAGE_VERSION,
        status: 'claimed',
        affiliateCode: normalizedAttribution.ref,
        ...(normalizedAttribution.campaign
          ? { campaignCode: normalizedAttribution.campaign }
          : {}),
        ...(normalizedAttribution.articleId
          ? { originArticleId: normalizedAttribution.articleId }
          : {}),
        checkoutArticleId: normalizedOptions.checkoutArticleId,
        channel: normalizedOptions.channel,
        issuedAt: normalizedAttribution.issuedAt,
        expiresAt: normalizedAttribution.expiresAt,
        ...normalizedSource(normalizedAttribution),
        claimedAt: Date.now()
      };
      transaction.create(claimRef, record);
      return 'claimed';
    });
  }

  async finalize(attributionId: string, checkoutRequestId: string): Promise<void> {
    const normalizedAttributionId = requireAttributionId(attributionId);
    const normalizedCheckoutRequestId = requireCheckoutRequestId(checkoutRequestId);
    const db = this.dbProvider();
    const claimRef = db.collection(CLAIM_COLLECTION)
      .doc(getAffiliateAttributionClaimDocumentId(normalizedAttributionId));

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(claimRef);
      if (!snapshot.exists) {
        throw new Error('Affiliate attribution claim does not exist.');
      }
      const value = snapshot.data() as Record<string, unknown> | undefined;
      const status = getStatus(value);
      if (status === 'consumed') {
        if (value?.checkoutRequestId !== normalizedCheckoutRequestId) {
          throw new Error('Affiliate attribution was already consumed by another checkout.');
        }
        return;
      }
      if (status !== 'claimed') {
        throw new Error('Affiliate attribution claim is invalid.');
      }
      transaction.update(claimRef, {
        status: 'consumed',
        consumedAt: Date.now(),
        checkoutRequestId: normalizedCheckoutRequestId
      });
    });
  }

  async release(attributionId: string): Promise<void> {
    const normalizedAttributionId = requireAttributionId(attributionId);
    const db = this.dbProvider();
    const claimRef = db.collection(CLAIM_COLLECTION)
      .doc(getAffiliateAttributionClaimDocumentId(normalizedAttributionId));

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(claimRef);
      if (snapshot.exists && getStatus(snapshot.data()) === 'claimed') {
        transaction.delete(claimRef);
      }
    });
  }
}

const affiliateAttributionClaimStore = new AffiliateAttributionClaimStore();

export function claimAffiliateAttribution(
  attribution: VerifiedAffiliateAttribution,
  options: AffiliateAttributionClaimOptions
): Promise<AffiliateAttributionClaimResult> {
  return affiliateAttributionClaimStore.claim(attribution, options);
}

export function finalizeAffiliateAttributionClaim(
  attributionId: string,
  checkoutRequestId: string
): Promise<void> {
  return affiliateAttributionClaimStore.finalize(attributionId, checkoutRequestId);
}

export function releaseAffiliateAttributionClaim(attributionId: string): Promise<void> {
  return affiliateAttributionClaimStore.release(attributionId);
}

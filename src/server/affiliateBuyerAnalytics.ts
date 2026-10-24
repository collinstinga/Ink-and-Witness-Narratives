import crypto from 'crypto';
import type { AffiliateBuyerAnalyticsEvidence, AffiliateSaleCommission, PaymentTransaction } from '../types.js';
import { deriveAffiliateBuyerAnalyticsKey } from './affiliateAnalytics.js';
import { isVerifiedAffiliateCommission } from './literaryCircle.js';

const KEY_ID = /^[a-z][a-z0-9-]{0,31}$/;
const BUYER_KEY = /^abk1_[A-Za-z0-9_-]{43}$/;
const FINGERPRINT = /^abf1_[A-Za-z0-9_-]{43}$/;
const PROOF = /^abp1_[A-Za-z0-9_-]{43}$/;
export const MAX_AFFILIATE_BUYER_HISTORY = 10_000;
export const MAX_AFFILIATE_BUYER_KEYS = 3;

/** Strip private evidence from writer ledgers too; only aggregate analytics may consume it. */
export function withoutAffiliateBuyerAnalytics(commission: AffiliateSaleCommission): AffiliateSaleCommission {
  const { affiliateBuyerAnalytics: _privateEvidence, ...safeCommission } = commission;
  return safeCommission;
}

interface BuyerKey { id: string; secret: Buffer; fingerprint: string }
export interface AffiliateBuyerAnalyticsRuntime {
  enabled: boolean;
  reason: 'complete' | 'not_enabled' | 'invalid_configuration';
  activeKeyId?: string;
  keys: readonly BuyerKey[];
}

/** Dedicated, protected server variables only. No secret or error value is logged. */
export function resolveAffiliateBuyerAnalyticsRuntime(
  env: NodeJS.ProcessEnv = process.env,
): AffiliateBuyerAnalyticsRuntime {
  if (!env.AFFILIATE_BUYER_ANALYTICS_MODE || env.AFFILIATE_BUYER_ANALYTICS_MODE === 'off') {
    return { enabled: false, reason: 'not_enabled', keys: [] };
  }
  const invalid = (): AffiliateBuyerAnalyticsRuntime => ({ enabled: false, reason: 'invalid_configuration', keys: [] });
  if (env.AFFILIATE_BUYER_ANALYTICS_MODE !== 'enabled') return invalid();
  try {
    const activeKeyId = env.AFFILIATE_BUYER_ANALYTICS_ACTIVE_KEY_ID;
    if (!activeKeyId || !KEY_ID.test(activeKeyId)) return invalid();
    const serialized = env.AFFILIATE_BUYER_ANALYTICS_KEYS_JSON;
    if (!serialized || serialized.length > 2_048) return invalid();
    const record: unknown = JSON.parse(serialized);
    if (!record || typeof record !== 'object' || Array.isArray(record)) return invalid();
    const entries = Object.entries(record);
    if (!entries.length || entries.length > MAX_AFFILIATE_BUYER_KEYS) return invalid();
    const keys: BuyerKey[] = [];
    for (const [id, encoded] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      if (!KEY_ID.test(id) || typeof encoded !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return invalid();
      const secret = Buffer.from(encoded, 'base64');
      if (secret.length < 32 || secret.length > 64 || secret.toString('base64') !== encoded) return invalid();
      const fingerprint = `abf1_${crypto.createHmac('sha256', secret)
        .update('ink-witness:affiliate-buyer-key-fingerprint:v1', 'utf8').digest('base64url')}`;
      if (keys.some(key => key.fingerprint === fingerprint)) return invalid();
      keys.push({ id, secret, fingerprint });
    }
    if (!keys.some(key => key.id === activeKeyId)) return invalid();
    return { enabled: true, reason: 'complete', activeKeyId, keys };
  } catch { return invalid(); }
}

function canonicalTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

function identifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function canonicalCommissionIdentity(commission: AffiliateSaleCommission): Record<string, unknown> | null {
  if (!identifier(commission.id) || !identifier(commission.checkoutRequestId)
    || !identifier(commission.transactionId) || !identifier(commission.affiliateId)
    || !identifier(commission.affiliateCode) || !identifier(commission.articleId)
    || !canonicalTimestamp(commission.createdAt)
    || !Number.isFinite(commission.saleAmountKes) || commission.saleAmountKes <= 0 || commission.saleAmountKes > 1_000_000
    || (commission.currency !== undefined && commission.currency !== 'KES')
    || !['mpesa', 'bank'].includes(commission.paymentMethod)
    || !['piece', 'bundle', 'subscription'].includes(commission.purchaseKind || 'piece')) return null;
  const expectedId = `com_tx_${crypto.createHash('sha256').update(commission.checkoutRequestId).digest('hex').slice(0, 40)}`;
  if (commission.id !== expectedId) return null;
  return {
    id: commission.id, checkoutRequestId: commission.checkoutRequestId,
    transactionId: commission.transactionId, affiliateId: commission.affiliateId,
    affiliateCode: commission.affiliateCode, articleId: commission.articleId,
    saleAmountKes: commission.saleAmountKes, currency: commission.currency || 'KES',
    paymentMethod: commission.paymentMethod, purchaseKind: commission.purchaseKind || 'piece',
    subscriptionPlanId: commission.subscriptionPlanId || null,
    subscriptionRenewal: commission.subscriptionRenewal === true, createdAt: commission.createdAt,
  };
}

function proofFor(
  commission: AffiliateSaleCommission,
  evidence: Omit<AffiliateBuyerAnalyticsEvidence, 'proof'>,
  key: BuyerKey,
): string | null {
  const identity = canonicalCommissionIdentity(commission);
  if (!identity) return null;
  const canonicalJson = (value: unknown): string => JSON.stringify(value, (_field, item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
  });
  return `abp1_${crypto.createHmac('sha256', key.secret)
    .update(`ink-witness:affiliate-buyer-evidence:v1\u0000${canonicalJson({ identity, evidence })}`, 'utf8')
    .digest('base64url')}`;
}

/** Pure best-effort enrichment: analytics can never change payment, attribution or commission decisions. */
export function buildCommittedAffiliateBuyerAnalyticsEvidence(input: {
  commission: AffiliateSaleCommission;
  transaction: PaymentTransaction;
  runtime: AffiliateBuyerAnalyticsRuntime;
}): AffiliateBuyerAnalyticsEvidence | undefined {
  try {
    const { commission, transaction, runtime } = input;
    if (!runtime.enabled || !isVerifiedAffiliateCommission(commission) || commission.fraudFlag?.flagged || !canonicalCommissionIdentity(commission)
      || transaction.type !== 'PURCHASE' || !['CONFIRMED', 'SUCCESS', 'PAID'].includes(transaction.status)
      || transaction.saleChannel === 'DIRECT' || transaction.checkoutRequestId !== commission.checkoutRequestId
      || transaction.id !== commission.transactionId || transaction.articleId !== commission.articleId
      || transaction.affiliateCode?.trim().toUpperCase() !== commission.affiliateCode.trim().toUpperCase()
      || transaction.amount !== commission.saleAmountKes
      || (transaction.currency !== undefined && transaction.currency !== 'KES')
      || (transaction.paymentMethod || 'mpesa') !== commission.paymentMethod
      || (transaction.purchaseKind || 'piece') !== (commission.purchaseKind || 'piece')
      || transaction.subscriptionPlanId !== commission.subscriptionPlanId
      || (transaction.subscriptionRenewal === true) !== (commission.subscriptionRenewal === true)) return undefined;
    const settlementTime = [transaction.confirmedAt, transaction.settledAt, transaction.completedAt, transaction.createdAt]
      .find(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
    if (settlementTime !== commission.createdAt) return undefined;
    const readerId = transaction.buyer?.userId || transaction.userId;
    // Explicit account evidence must be valid; never silently fall back from a corrupt account to a phone.
    if (readerId !== undefined && (typeof readerId !== 'string' || !readerId.trim()
      || readerId.length > 256 || /[\u0000-\u001f\u007f]/.test(readerId))) return undefined;
    const identity = { readerId, phoneNumber: transaction.buyer?.phoneNumber || transaction.phoneNumber };
    const keys = runtime.keys.map(key => ({ keyId: key.id, keyFingerprint: key.fingerprint,
      buyerKey: deriveAffiliateBuyerAnalyticsKey(identity, key.secret) }));
    if (!keys.length || keys.some(key => !key.buyerKey)) return undefined;
    const activeKey = runtime.keys.find(key => key.id === runtime.activeKeyId);
    if (!activeKey) return undefined;
    const evidence: Omit<AffiliateBuyerAnalyticsEvidence, 'proof'> = {
      schemaVersion: 1, identitySource: readerId ? 'reader_account' : 'verified_payment_phone',
      capturedAt: commission.createdAt,
      keys: keys as AffiliateBuyerAnalyticsEvidence['keys'], proofKeyId: activeKey.id,
    };
    const proof = proofFor(commission, evidence, activeKey);
    return proof ? { ...evidence, proof } : undefined;
  } catch { return undefined; }
}

function verifiedEvidence(commission: AffiliateSaleCommission, runtime: AffiliateBuyerAnalyticsRuntime) {
  if (commission.fraudFlag?.flagged) return null;
  const evidence: unknown = commission.affiliateBuyerAnalytics;
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const value = evidence as AffiliateBuyerAnalyticsEvidence;
  if (Object.keys(value).sort().join(',') !== 'capturedAt,identitySource,keys,proof,proofKeyId,schemaVersion'
    || value.schemaVersion !== 1 || !['reader_account', 'verified_payment_phone'].includes(value.identitySource)
    || value.capturedAt !== commission.createdAt || !Array.isArray(value.keys)
    || !value.keys.length || value.keys.length > MAX_AFFILIATE_BUYER_KEYS
    || !KEY_ID.test(value.proofKeyId) || !PROOF.test(value.proof)) return null;
  const proofKey = runtime.keys.find(key => key.id === value.proofKeyId);
  if (!proofKey) return null;
  const seen = new Set<string>();
  for (const key of value.keys) {
    if (!key || typeof key !== 'object' || Object.keys(key).sort().join(',') !== 'buyerKey,keyFingerprint,keyId'
      || !KEY_ID.test(key.keyId) || !FINGERPRINT.test(key.keyFingerprint) || !BUYER_KEY.test(key.buyerKey)
      || seen.has(key.keyId)) return null;
    seen.add(key.keyId);
  }
  const { proof, ...unsigned } = value;
  const expected = proofFor(commission, unsigned, proofKey);
  if (!expected || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(proof))) return null;
  const keys = value.keys.filter(item => runtime.keys.some(key => key.id === item.keyId && key.fingerprint === item.keyFingerprint));
  if (!keys.some(key => key.keyId === value.proofKeyId)) return null;
  return { keys, identitySource: value.identitySource };
}

export interface AffiliateStoredBuyerProjection {
  keysByCommissionId?: Record<string, string>;
  historyComplete: boolean;
  reason: 'complete' | 'not_enabled' | 'invalid_configuration' | 'incomplete_history' | 'invalid_evidence' | 'mixed_identity_sources';
}

/** Only aggregate callers may consume this server-only projection; pseudonyms never enter a response. */
export function projectStoredAffiliateBuyerAnalytics(input: {
  commissions: AffiliateSaleCommission[];
  runtime: AffiliateBuyerAnalyticsRuntime;
  historyComplete: boolean;
}): AffiliateStoredBuyerProjection {
  if (!input.runtime.enabled) return { historyComplete: false, reason: input.runtime.reason };
  const eligible = input.commissions.filter(commission => isVerifiedAffiliateCommission(commission)
    && Number.isFinite(commission.saleAmountKes) && commission.saleAmountKes > 0);
  const aliases = new Map<string, string>();
  const root = (key: string): string => {
    let current = key;
    while (aliases.has(current) && aliases.get(current) !== current) current = aliases.get(current)!;
    return current;
  };
  const valid: Array<{ commission: AffiliateSaleCommission; keys: string[]; fingerprints: string[] }> = [];
  const sources = new Set<string>();
  let invalid = false;
  for (const commission of eligible) {
    const evidence = verifiedEvidence(commission, input.runtime);
    if (!evidence) { invalid ||= commission.affiliateBuyerAnalytics !== undefined; continue; }
    sources.add(evidence.identitySource);
    const keys = evidence.keys.map(key => key.buyerKey);
    const canonical = keys.map(root).sort()[0];
    for (const key of keys) aliases.set(root(key), canonical);
    valid.push({ commission, keys, fingerprints: evidence.keys.map(key => key.keyFingerprint) });
  }
  const keysByCommissionId: Record<string, string> = Object.create(null);
  for (const item of valid) keysByCommissionId[item.commission.id] = root(item.keys[0]);
  // Disconnected key eras could be the same readers. Never count them twice after a bad rotation.
  const groupFingerprints = new Map<string, Set<string>>();
  for (const item of valid) {
    const group = groupFingerprints.get(root(item.keys[0])) || new Set<string>();
    for (const fingerprint of item.fingerprints) group.add(fingerprint);
    groupFingerprints.set(root(item.keys[0]), group);
  }
  const fingerprintSets = [...new Map([...groupFingerprints.values()]
    .map(set => [[...set].sort().join(','), set])).values()];
  if (fingerprintSets.some(left => fingerprintSets.some(right => ![...left].some(value => right.has(value))))) {
    return { historyComplete: false, reason: 'incomplete_history' };
  }
  if (sources.size > 1) return { historyComplete: false, reason: 'mixed_identity_sources' };
  const historyComplete = input.historyComplete && valid.length === eligible.length && sources.size <= 1;
  return { keysByCommissionId, historyComplete,
    reason: !input.historyComplete ? 'incomplete_history' : invalid ? 'invalid_evidence'
      : valid.length !== eligible.length ? 'incomplete_history' : 'complete' };
}

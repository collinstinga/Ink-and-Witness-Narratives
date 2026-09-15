import crypto from 'crypto';

export const MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION = 'manual_access_phone_reservations';
export const MANUAL_ACCESS_PHONE_RESERVATION_VERSION = 1 as const;
export const MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN = /^v1_[a-f0-9]{64}$/;
export const MANUAL_ACCESS_ENTITLEMENT_COLLECTION = 'manual_access_entitlements';
export const MANUAL_ACCESS_ENTITLEMENT_VERSION = 1 as const;
export const MANUAL_ACCESS_ENTITLEMENT_ID_PATTERN = /^v1_[a-f0-9]{64}$/;

export type ManualAccessPhoneReservationState =
  | 'unclaimed'
  | 'claimed'
  | 'revoked'
  | 'deleted';

export interface ManualAccessPhoneReservation {
  storageVersion: typeof MANUAL_ACCESS_PHONE_RESERVATION_VERSION;
  grantId: string;
  articleId: string;
  state: ManualAccessPhoneReservationState;
  createdAt: string;
  updatedAt: string;
  boundUserId?: string;
  claimedAt?: string;
  revokedAt?: string;
  deletedAt?: string;
}

export type ManualAccessEntitlementState = 'active' | 'revoked' | 'deleted';

/**
 * A non-transferable manual-access entitlement bound to one authenticated
 * account and one article. This record deliberately contains no bearer token,
 * phone number, email address, receipt, or other reader PII.
 */
export interface ManualAccessEntitlement {
  storageVersion: typeof MANUAL_ACCESS_ENTITLEMENT_VERSION;
  grantId: string;
  userId: string;
  articleId: string;
  state: ManualAccessEntitlementState;
  createdAt: string;
  updatedAt: string;
  revokedAt?: string;
  deletedAt?: string;
}

export class ManualAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'ManualAccessError';
  }
}

function decodePhoneReservationSecret(value: unknown): Buffer | null {
  const configured = typeof value === 'string' ? value.trim() : '';
  if (/^(?:[a-f0-9]{2}){32,}$/i.test(configured)) {
    return Buffer.from(configured, 'hex');
  }

  const base64Url = configured.startsWith('base64url:')
    ? configured.slice('base64url:'.length)
    : '';
  if (/^[A-Za-z0-9_-]{43,}$/.test(base64Url)) {
    const decoded = Buffer.from(base64Url, 'base64url');
    return decoded.length >= 32 ? decoded : null;
  }

  return null;
}

function resolveStableManualAccessSecret(explicitSecret?: string): Buffer {
  const configured = decodePhoneReservationSecret(
    explicitSecret === undefined
      ? process.env.MANUAL_ACCESS_PHONE_RESERVATION_SECRET
      : explicitSecret
  );
  if (configured) return configured;

  // Entitlement IDs address shared, durable state. An ephemeral development
  // key would make the same account/article resolve to a different document
  // after a process restart, so this path must fail closed in every runtime.
  throw new ManualAccessError(
    'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
    'Manual access is temporarily unavailable.',
    503
  );
}

function normalizeEntitlementIdentity(
  value: unknown,
  code: 'MANUAL_ACCESS_INVALID_USER' | 'MANUAL_ACCESS_INVALID_ARTICLE',
  message: string
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || Buffer.byteLength(value, 'utf8') > 1024
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new ManualAccessError(code, message, 400);
  }
  return value;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

export function normalizeManualAccessPhone(input: unknown): string {
  if (typeof input !== 'string') return '';
  let digits = input.trim().replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) {
    digits = `254${digits.slice(1)}`;
  } else if ((digits.startsWith('7') || digits.startsWith('1')) && digits.length === 9) {
    digits = `254${digits}`;
  }

  return /^\d{9,15}$/.test(digits) ? digits : '';
}

export function getManualAccessPhoneReservationId(
  phone: unknown,
  explicitSecret?: string
): string {
  const normalizedPhone = normalizeManualAccessPhone(phone);
  if (!normalizedPhone) {
    throw new ManualAccessError(
      'MANUAL_ACCESS_INVALID_PHONE',
      'Please provide a valid phone number.',
      400
    );
  }

  const digest = crypto
    .createHmac('sha256', resolveStableManualAccessSecret(explicitSecret))
    .update(`manual-access-phone:v1:${normalizedPhone}`, 'utf8')
    .digest('hex');
  return `v1_${digest}`;
}

export function isManualAccessPhoneReservationId(value: unknown): value is string {
  return typeof value === 'string' && MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN.test(value);
}

export function getManualAccessEntitlementId(
  userId: unknown,
  articleId: unknown,
  explicitSecret?: string
): string {
  const normalizedUserId = normalizeEntitlementIdentity(
    userId,
    'MANUAL_ACCESS_INVALID_USER',
    'An authenticated reader account is required.'
  );
  const normalizedArticleId = normalizeEntitlementIdentity(
    articleId,
    'MANUAL_ACCESS_INVALID_ARTICLE',
    'A valid article is required.'
  );
  const secret = resolveStableManualAccessSecret(explicitSecret);
  const userIdBytes = Buffer.byteLength(normalizedUserId, 'utf8');
  const articleIdBytes = Buffer.byteLength(normalizedArticleId, 'utf8');
  const digest = crypto
    .createHmac('sha256', secret)
    .update(
      `manual-access-entitlement:v1:${userIdBytes}:${normalizedUserId}:${articleIdBytes}:${normalizedArticleId}`,
      'utf8'
    )
    .digest('hex');

  return `v1_${digest}`;
}

export function isManualAccessEntitlementId(value: unknown): value is string {
  return typeof value === 'string' && MANUAL_ACCESS_ENTITLEMENT_ID_PATTERN.test(value);
}

export function isManualAccessBearerLicense(token: unknown, license: unknown): boolean {
  const safeToken = typeof token === 'string' ? token : '';
  const record = license && typeof license === 'object' && !Array.isArray(license)
    ? license as Record<string, unknown>
    : {};
  const receipt = typeof record.receipt === 'string' ? record.receipt.toUpperCase() : '';

  return record.accessSource === 'MANUAL_GRANT'
    || safeToken.startsWith('ink_grant_')
    || safeToken.startsWith('ink_manual_')
    || receipt.startsWith('MANUAL');
}

export function normalizeManualAccessEntitlement(
  value: unknown
): ManualAccessEntitlement | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'storageVersion',
    'grantId',
    'userId',
    'articleId',
    'state',
    'createdAt',
    'updatedAt',
    'revokedAt',
    'deletedAt'
  ]);
  if (Object.keys(record).some(key => !allowedKeys.has(key))) return null;

  const isIdentity = (candidate: unknown): candidate is string => (
    typeof candidate === 'string'
    && candidate.length > 0
    && candidate === candidate.trim()
    && Buffer.byteLength(candidate, 'utf8') <= 1024
    && !/[\u0000-\u001f\u007f]/.test(candidate)
  );
  const isState = (candidate: unknown): candidate is ManualAccessEntitlementState => (
    candidate === 'active' || candidate === 'revoked' || candidate === 'deleted'
  );

  if (
    record.storageVersion !== MANUAL_ACCESS_ENTITLEMENT_VERSION
    || !isIdentity(record.grantId)
    || !isIdentity(record.userId)
    || !isIdentity(record.articleId)
    || !isState(record.state)
    || !isIsoTimestamp(record.createdAt)
    || !isIsoTimestamp(record.updatedAt)
  ) {
    return null;
  }

  const createdAtMs = Date.parse(record.createdAt);
  const updatedAtMs = Date.parse(record.updatedAt);
  if (updatedAtMs < createdAtMs) return null;

  const revokedAt = record.revokedAt;
  const deletedAt = record.deletedAt;
  if (revokedAt !== undefined && !isIsoTimestamp(revokedAt)) return null;
  if (deletedAt !== undefined && !isIsoTimestamp(deletedAt)) return null;
  if (
    (revokedAt !== undefined
      && (Date.parse(revokedAt) < createdAtMs || Date.parse(revokedAt) > updatedAtMs))
    || (deletedAt !== undefined
      && (Date.parse(deletedAt) < createdAtMs || Date.parse(deletedAt) > updatedAtMs))
  ) {
    return null;
  }

  if (record.state === 'active' && (revokedAt !== undefined || deletedAt !== undefined)) {
    return null;
  }
  if (record.state === 'revoked' && (revokedAt === undefined || deletedAt !== undefined)) {
    return null;
  }
  if (record.state === 'deleted' && deletedAt === undefined) return null;

  return {
    storageVersion: MANUAL_ACCESS_ENTITLEMENT_VERSION,
    grantId: record.grantId,
    userId: record.userId,
    articleId: record.articleId,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(revokedAt === undefined ? {} : { revokedAt }),
    ...(deletedAt === undefined ? {} : { deletedAt })
  };
}

export function createManualAccessPhoneAlreadyUsedError(): ManualAccessError {
  return new ManualAccessError(
    'MANUAL_ACCESS_PHONE_ALREADY_USED',
    'This phone number has already been used for manual access and cannot be authorized again.',
    409
  );
}

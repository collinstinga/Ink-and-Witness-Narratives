import crypto from 'crypto';

export const MANUAL_ACCESS_PHONE_RESERVATION_COLLECTION = 'manual_access_phone_reservations';
export const MANUAL_ACCESS_PHONE_RESERVATION_VERSION = 1 as const;
export const MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN = /^v1_[a-f0-9]{64}$/;

const DEVELOPMENT_PHONE_RESERVATION_SECRET = crypto.randomBytes(32).toString('hex');

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

function isProductionRuntime(): boolean {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

function resolvePhoneReservationSecret(explicitSecret?: string): Buffer {
  const configured = decodePhoneReservationSecret(
    explicitSecret === undefined
      ? process.env.MANUAL_ACCESS_PHONE_RESERVATION_SECRET
      : explicitSecret
  );
  if (configured) return configured;

  if (isProductionRuntime()) {
    throw new ManualAccessError(
      'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
      'Manual access is temporarily unavailable.',
      503
    );
  }

  const developmentSecret = decodePhoneReservationSecret(DEVELOPMENT_PHONE_RESERVATION_SECRET);
  if (!developmentSecret) {
    throw new ManualAccessError(
      'MANUAL_ACCESS_CONFIGURATION_UNAVAILABLE',
      'Manual access is temporarily unavailable.',
      503
    );
  }
  return developmentSecret;
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
    .createHmac('sha256', resolvePhoneReservationSecret(explicitSecret))
    .update(`manual-access-phone:v1:${normalizedPhone}`, 'utf8')
    .digest('hex');
  return `v1_${digest}`;
}

export function isManualAccessPhoneReservationId(value: unknown): value is string {
  return typeof value === 'string' && MANUAL_ACCESS_PHONE_RESERVATION_ID_PATTERN.test(value);
}

export function createManualAccessPhoneAlreadyUsedError(): ManualAccessError {
  return new ManualAccessError(
    'MANUAL_ACCESS_PHONE_ALREADY_USED',
    'This phone number has already been used for manual access and cannot be authorized again.',
    409
  );
}

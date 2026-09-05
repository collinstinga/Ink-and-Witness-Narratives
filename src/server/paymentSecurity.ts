import crypto from 'crypto';
import { PaymentTransaction } from '../types.js';

export const PAYMENT_CAPABILITY_BYTES = 32;
export const PAYMENT_CALLBACK_QUERY_PARAMETER = 'cb_auth';

const CAPABILITY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;

export function generatePaymentCapability(): string {
  return crypto.randomBytes(PAYMENT_CAPABILITY_BYTES).toString('base64url');
}

export function hashPaymentCapability(capability: string): string {
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new Error('Payment capability has an invalid format.');
  }
  return crypto.createHash('sha256').update(capability, 'utf8').digest('hex');
}

export function verifyPaymentCapability(capability: unknown, expectedHash: unknown): boolean {
  if (
    typeof capability !== 'string' ||
    typeof expectedHash !== 'string' ||
    !CAPABILITY_PATTERN.test(capability) ||
    !HASH_PATTERN.test(expectedHash)
  ) {
    return false;
  }

  const actual = Buffer.from(
    crypto.createHash('sha256').update(capability, 'utf8').digest('hex'),
    'hex'
  );
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function attachCallbackCapability(callbackUrl: string, capability: string): string {
  if (!CAPABILITY_PATTERN.test(capability)) {
    throw new Error('Payment capability has an invalid format.');
  }
  const parsed = new URL(callbackUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('The M-Pesa callback URL must use HTTPS.');
  }
  parsed.searchParams.set(PAYMENT_CALLBACK_QUERY_PARAMETER, capability);
  parsed.hash = '';
  return parsed.toString();
}

export function redactPaymentTransaction(transaction: PaymentTransaction): PaymentTransaction {
  const {
    paymentCapabilityHash: _paymentCapabilityHash,
    callbackCapabilityHash: _callbackCapabilityHash,
    ...safeTransaction
  } = transaction;
  return safeTransaction;
}

export function canRecoverMpesaPurchase(
  transaction: PaymentTransaction | undefined,
  receiptNumber: string,
  normalizedPhone: string
): transaction is PaymentTransaction {
  if (!transaction) return false;
  const canonicalReceipt = (transaction.mpesaReceiptNumber || transaction.receiptNumber || '')
    .trim()
    .toUpperCase();
  return (
    transaction.paymentMethod === 'mpesa' &&
    transaction.type === 'PURCHASE' &&
    (transaction.status === 'SUCCESS' || transaction.status === 'CONFIRMED' || transaction.status === 'PAID') &&
    canonicalReceipt === receiptNumber.trim().toUpperCase() &&
    Boolean(transaction.phoneNumber) &&
    transaction.phoneNumber === normalizedPhone
  );
}

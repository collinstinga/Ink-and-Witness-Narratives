import type {
  AffiliateSaleCommission,
  PaymentBuyerSnapshot,
  PaymentMethod,
  PaymentTransaction,
  SaleChannel,
  TransactionStatus
} from '../types.js';

const SETTLED_STATUSES = new Set<TransactionStatus>(['CONFIRMED', 'SUCCESS', 'PAID']);
const FAILED_STATUSES = new Set<TransactionStatus>([
  'FAILED',
  'CANCELLED',
  'TIMEOUT',
  'TIMED_OUT',
  'EXPIRED'
]);

type LegacyPaymentTransaction = Partial<PaymentTransaction> & {
  method?: string;
};

export type AdminSalesTransaction = Omit<
  PaymentTransaction,
  'paymentCapabilityHash' | 'callbackCapabilityHash' | 'downloadToken'
> & {
  orderId: string;
  paymentMethod: PaymentMethod;
  saleChannel: SaleChannel;
};

export function isSettledTransactionStatus(status: unknown): boolean {
  return typeof status === 'string' && SETTLED_STATUSES.has(status.toUpperCase() as TransactionStatus);
}

export function isFailedTransactionStatus(status: unknown): boolean {
  return typeof status === 'string' && FAILED_STATUSES.has(status.toUpperCase() as TransactionStatus);
}

export function normalizePaymentMethod(
  value: PaymentMethod | LegacyPaymentTransaction | string | null | undefined
): PaymentMethod {
  if (value && typeof value === 'object') {
    const explicit = String(value.paymentMethod || value.method || '').trim().toLowerCase();
    if (explicit === 'bank' || explicit === 'manual' || explicit === 'mpesa') return explicit;
    const checkoutRequestId = String(value.checkoutRequestId || '');
    if (checkoutRequestId.startsWith('bank_') || checkoutRequestId.startsWith('IW-BNK-')) return 'bank';
    if (value.type === 'MANUAL') return 'manual';
    return 'mpesa';
  }

  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'bank' || normalized === 'manual' ? normalized : 'mpesa';
}

export function resolveSaleChannel(
  transaction: Pick<PaymentTransaction, 'saleChannel' | 'affiliateCode'>
): SaleChannel {
  if (transaction.saleChannel === 'AFFILIATE' || transaction.saleChannel === 'DIRECT') {
    return transaction.saleChannel;
  }
  return transaction.affiliateCode ? 'AFFILIATE' : 'DIRECT';
}

export function createStableOrderId(identifier: unknown): string {
  const value = typeof identifier === 'string' ? identifier.trim() : '';
  if (!value || value.length > 256 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new Error('A safe transaction identifier is required to create an order ID.');
  }
  return value.startsWith('ord_') ? value : `ord_${value}`;
}

export function resolveOrderId(
  transaction: Pick<PaymentTransaction, 'orderId' | 'id' | 'checkoutRequestId'>
): string {
  const existing = transaction.orderId?.trim();
  if (existing) return existing;
  const identifier = transaction.id?.trim() || transaction.checkoutRequestId?.trim();
  return createStableOrderId(identifier);
}

export function buildBuyerSnapshot(input: {
  userId?: unknown;
  email?: unknown;
  phoneNumber?: unknown;
  phoneVerifiedAt?: unknown;
  name?: unknown;
}): PaymentBuyerSnapshot | undefined {
  const userId = typeof input.userId === 'string' ? input.userId.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const phoneNumber = typeof input.phoneNumber === 'string' ? input.phoneNumber.trim() : '';
  const phoneVerifiedAt = typeof input.phoneVerifiedAt === 'string' ? input.phoneVerifiedAt.trim() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!userId && !email && !phoneNumber && !name) return undefined;
  return {
    userId: userId || undefined,
    email: email || undefined,
    phoneNumber: phoneNumber || undefined,
    phoneVerifiedAt: phoneVerifiedAt || undefined,
    name: name || undefined
  };
}

/**
 * Writer-facing transaction projection. Provider capability hashes and bearer
 * access tokens never need to leave the server, even for an administrator.
 */
export function toAdminSalesTransaction(transaction: PaymentTransaction): AdminSalesTransaction {
  const {
    paymentCapabilityHash: _paymentCapabilityHash,
    callbackCapabilityHash: _callbackCapabilityHash,
    downloadToken: _downloadToken,
    ...safeTransaction
  } = transaction;
  return {
    ...safeTransaction,
    orderId: resolveOrderId(transaction),
    paymentMethod: normalizePaymentMethod(transaction),
    saleChannel: resolveSaleChannel(transaction),
    buyer: transaction.buyer ? buildBuyerSnapshot(transaction.buyer) : undefined
  };
}

/**
 * Affiliate-facing projection is an explicit allow-list. This prevents future
 * buyer fields added to commission records from reaching affiliate clients.
 */
export function toAffiliateSaleCommission(
  commission: AffiliateSaleCommission
): AffiliateSaleCommission {
  return {
    id: commission.id,
    orderId: commission.orderId || createStableOrderId(commission.transactionId || commission.id),
    affiliateId: commission.affiliateId,
    affiliateCode: commission.affiliateCode,
    affiliateName: commission.affiliateName,
    transactionId: commission.transactionId,
    checkoutRequestId: commission.checkoutRequestId,
    receiptNumber: commission.receiptNumber,
    articleId: commission.articleId,
    articleTitle: commission.articleTitle,
    saleAmountKes: commission.saleAmountKes,
    currency: commission.currency,
    originalAmount: commission.originalAmount,
    commissionRate: commission.commissionRate,
    commissionAmountKes: commission.commissionAmountKes,
    grossCreatorRevenueKes: commission.grossCreatorRevenueKes,
    paymentMethod: commission.paymentMethod,
    status: commission.status,
    payoutId: commission.payoutId,
    reversalReason: commission.reversalReason,
    fraudFlag: commission.fraudFlag,
    campaignCode: commission.campaignCode,
    createdAt: commission.createdAt,
    approvedAt: commission.approvedAt,
    paidAt: commission.paidAt,
    reversedAt: commission.reversedAt
  };
}

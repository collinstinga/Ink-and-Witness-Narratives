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
    & Partial<Pick<PaymentTransaction, 'phoneNumber' | 'buyer'>>
): string {
  const buyerPhoneDigits = String(transaction.buyer?.phoneNumber || transaction.phoneNumber || '')
    .replace(/\D/g, '');
  const isBuyerPhone = (value: string | undefined) => {
    const identifierDigits = String(value || '').replace(/\D/g, '');
    return buyerPhoneDigits.length >= 9 && identifierDigits === buyerPhoneDigits;
  };
  const existing = transaction.orderId?.trim();
  if (
    existing
    && !isBuyerPhone(existing)
    && existing.length <= 256
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(existing)
  ) {
    return existing;
  }
  for (const identifier of [transaction.id, transaction.checkoutRequestId]) {
    if (isBuyerPhone(identifier)) continue;
    try {
      return createStableOrderId(identifier);
    } catch {
      // Historical records can contain a malformed legacy ID. Prefer the next
      // stable identifier rather than making the complete writer ledger fail.
    }
  }
  throw new Error('A safe transaction identifier is required to resolve an order ID.');
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
 * Quote a value for spreadsheet-compatible CSV and neutralize formula
 * prefixes. Writer exports can contain reader-entered names and references,
 * so ordinary CSV escaping alone is not sufficient.
 */
export function formatCsvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * Additive metadata for all newly written or deliberately updated payment
 * records. Existing identifiers remain the Firestore document keys; orderId is
 * a reporting identifier and never derives from a phone number.
 */
export function enrichSalesTransaction(transaction: PaymentTransaction): PaymentTransaction {
  const buyer = buildBuyerSnapshot({
    userId: transaction.buyer?.userId || transaction.userId,
    email: transaction.buyer?.email || transaction.userEmail,
    phoneNumber: transaction.buyer?.phoneNumber || transaction.phoneNumber,
    phoneVerifiedAt: transaction.buyer?.phoneVerifiedAt,
    name: transaction.buyer?.name || transaction.senderName
  });
  const settledAt = transaction.settledAt
    || transaction.confirmedAt
    || transaction.completedAt;
  return {
    ...transaction,
    schemaVersion: 2,
    orderId: resolveOrderId(transaction),
    paymentMethod: normalizePaymentMethod(transaction),
    saleChannel: resolveSaleChannel(transaction),
    ...(buyer ? { buyer } : {}),
    ...(isSettledTransactionStatus(transaction.status) && settledAt ? { settledAt } : {})
  };
}

/**
 * Writer-facing transaction projection. Provider capability hashes and bearer
 * access tokens never need to leave the server, even for an administrator.
 */
export function toAdminSalesTransaction(
  transaction: PaymentTransaction,
  commission?: AffiliateSaleCommission
): AdminSalesTransaction {
  const {
    paymentCapabilityHash: _paymentCapabilityHash,
    callbackCapabilityHash: _callbackCapabilityHash,
    downloadToken: _downloadToken,
    ...safeTransaction
  } = transaction;
  const enriched = enrichSalesTransaction(safeTransaction as PaymentTransaction);
  return {
    ...enriched,
    orderId: resolveOrderId(enriched),
    paymentMethod: normalizePaymentMethod(enriched),
    saleChannel: resolveSaleChannel(enriched),
    ...(commission ? {
      commission: {
        id: commission.id,
        affiliateId: commission.affiliateId,
        affiliateCode: commission.affiliateCode,
        affiliateName: commission.affiliateName,
        amountKes: commission.commissionAmountKes,
        rate: commission.commissionRate,
        status: commission.status
      }
    } : {})
  };
}

/**
 * Affiliate-facing projection is an explicit allow-list. This prevents future
 * buyer fields added to commission records from reaching affiliate clients.
 */
export function toAffiliateSaleCommission(
  commission: AffiliateSaleCommission
): AffiliateSaleCommission {
  const legacyTransactionId = commission.transactionId?.trim();
  const phoneLikeLegacyId = /^\+?[\d\s()-]{9,}$/.test(legacyTransactionId || '');
  const safeLegacyOrderSource = phoneLikeLegacyId
    ? commission.id
    : (legacyTransactionId || commission.id);
  return {
    id: commission.id,
    orderId: commission.orderId || createStableOrderId(safeLegacyOrderSource),
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

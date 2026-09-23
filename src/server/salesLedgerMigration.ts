import type { PaymentTransaction } from '../types.js';
import {
  enrichSalesTransaction,
  isSettledTransactionStatus
} from './salesLedger.js';

export type SalesLedgerBackfillPatch = Pick<
  PaymentTransaction,
  'schemaVersion' | 'orderId' | 'paymentMethod' | 'saleChannel'
> & Partial<Pick<PaymentTransaction, 'buyer' | 'settledAt'>>;

export interface SalesLedgerBackfillPlan {
  action: 'skip' | 'update' | 'error';
  patch?: SalesLedgerBackfillPatch;
  changedFields: string[];
  warnings: string[];
  error?: string;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isSeedTransaction(transaction: PaymentTransaction): boolean {
  return Boolean(transaction.isSeed) || transaction.id?.startsWith('tx_seed_');
}

/**
 * Plans an additive migration for one historical transaction. Existing
 * canonical values always win; the migration only supplies absent v2 fields
 * or fills missing buyer-snapshot keys from the transaction itself.
 */
export function planSalesLedgerBackfill(transaction: PaymentTransaction): SalesLedgerBackfillPlan {
  if (!transaction || typeof transaction !== 'object') {
    return { action: 'error', changedFields: [], warnings: [], error: 'Document is not an object.' };
  }
  if (isSeedTransaction(transaction)) {
    return { action: 'skip', changedFields: [], warnings: ['Seed/demo transaction is excluded.'] };
  }
  if (!transaction.id && !transaction.checkoutRequestId) {
    return {
      action: 'error',
      changedFields: [],
      warnings: [],
      error: 'Transaction has neither an ID nor a checkout request ID.'
    };
  }
  if (!transaction.articleId || !transaction.status || !transaction.type) {
    return {
      action: 'error',
      changedFields: [],
      warnings: [],
      error: 'Transaction is missing its piece, status, or type.'
    };
  }

  try {
    const enriched = enrichSalesTransaction(transaction);
    const patch = {} as SalesLedgerBackfillPatch;
    const changedFields: string[] = [];
    const warnings: string[] = [];

    const addMissing = <Key extends keyof SalesLedgerBackfillPatch>(
      key: Key,
      value: SalesLedgerBackfillPatch[Key]
    ) => {
      if (value === undefined) return;
      if (transaction[key as keyof PaymentTransaction] === undefined) {
        patch[key] = value;
        changedFields.push(String(key));
      }
    };

    addMissing('schemaVersion', enriched.schemaVersion);
    addMissing('orderId', enriched.orderId);
    addMissing('paymentMethod', enriched.paymentMethod);
    addMissing('saleChannel', enriched.saleChannel);
    addMissing('settledAt', enriched.settledAt);

    if (enriched.buyer) {
      const mergedBuyer = { ...enriched.buyer, ...(transaction.buyer || {}) };
      if (!sameValue(transaction.buyer, mergedBuyer)) {
        patch.buyer = mergedBuyer;
        changedFields.push('buyer');
      }
    }

    if (transaction.schemaVersion !== undefined && transaction.schemaVersion !== 2) {
      warnings.push('Existing schemaVersion was not overwritten.');
    }
    if (transaction.orderId && transaction.orderId !== enriched.orderId) {
      warnings.push('Existing orderId was preserved and requires manual review.');
    }
    if (isSettledTransactionStatus(transaction.status)) {
      if (!transaction.articleTitle) warnings.push('Settled sale has no piece-title snapshot.');
      if (!enriched.buyer?.userId && !enriched.buyer?.email && !enriched.buyer?.phoneNumber) {
        warnings.push('Settled sale has no durable buyer identifier.');
      }
      if (!transaction.mpesaReceiptNumber && !transaction.receiptNumber && !transaction.bankReference) {
        warnings.push('Settled sale has no provider/reference identifier.');
      }
    }

    return {
      action: changedFields.length ? 'update' : 'skip',
      patch: changedFields.length ? patch : undefined,
      changedFields,
      warnings
    };
  } catch (error) {
    return {
      action: 'error',
      changedFields: [],
      warnings: [],
      error: error instanceof Error ? error.message : 'Transaction could not be normalized.'
    };
  }
}

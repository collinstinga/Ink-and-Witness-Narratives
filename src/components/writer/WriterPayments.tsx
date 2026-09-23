import React, { useState, useMemo } from 'react';
import { 
  CreditCard, 
  DollarSign, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Download, 
  RefreshCw,
  FileText,
  Building2,
  Smartphone,
  Check,
  XCircle,
  Loader2,
  Globe
} from 'lucide-react';
import { PaymentTransaction } from '../../types.js';
import { api } from '../../utils/api.js';

const SETTLED_STATUSES = new Set(['CONFIRMED', 'SUCCESS', 'PAID']);
const FAILED_STATUSES = new Set(['FAILED', 'CANCELLED', 'TIMEOUT', 'TIMED_OUT', 'EXPIRED']);

function isSettled(transaction: PaymentTransaction): boolean {
  return SETTLED_STATUSES.has(transaction.status);
}

function paymentMethod(transaction: PaymentTransaction): 'mpesa' | 'bank' | 'manual' {
  if (transaction.paymentMethod) return transaction.paymentMethod;
  const legacyMethod = (transaction as PaymentTransaction & { method?: string }).method;
  if (legacyMethod === 'bank') return 'bank';
  if (transaction.type === 'MANUAL') return 'manual';
  return transaction.checkoutRequestId?.startsWith('bank_')
    || transaction.checkoutRequestId?.startsWith('IW-BNK-')
    ? 'bank'
    : 'mpesa';
}

function saleChannel(transaction: PaymentTransaction): 'DIRECT' | 'AFFILIATE' {
  return transaction.saleChannel === 'AFFILIATE' || transaction.affiliateCode
    ? 'AFFILIATE'
    : 'DIRECT';
}

interface WriterPaymentsProps {
  transactions: PaymentTransaction[];
  loading: boolean;
  onRefresh: () => void;
}

export const WriterPayments: React.FC<WriterPaymentsProps> = ({
  transactions,
  loading,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'SETTLED' | 'PENDING' | 'FAILED'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'mpesa' | 'bank' | 'manual'>('all');
  const [channelFilter, setChannelFilter] = useState<'all' | 'DIRECT' | 'AFFILIATE'>('all');
  const [pieceFilter, setPieceFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Filter Pay-to-Read transactions (type === 'PURCHASE' or not TIP)
  const purchaseTransactions = useMemo(() => {
    return transactions.filter(transaction => {
      const legacyMethod = (transaction as PaymentTransaction & { method?: string }).method;
      return transaction.type === 'PURCHASE'
        || transaction.type === 'MANUAL'
        || legacyMethod === 'bank'
        || legacyMethod === 'card';
    });
  }, [transactions]);

  // Verified total earnings
  const verifiedRevenue = useMemo(() => {
    return purchaseTransactions
      .filter(isSettled)
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  }, [purchaseTransactions]);

  const settledTransactions = useMemo(
    () => purchaseTransactions.filter(isSettled),
    [purchaseTransactions]
  );

  const pieceOptions = useMemo(() => Array.from(new Map<string, string>(
    purchaseTransactions
      .filter(transaction => transaction.articleId)
      .map(transaction => [transaction.articleId, transaction.articleTitle || transaction.articleId] as [string, string])
  ).entries()).sort((left, right) => left[1].localeCompare(right[1])), [purchaseTransactions]);

  const channelSummary = useMemo(() => {
    let directCount = 0;
    let directRevenueKes = 0;
    let affiliateCount = 0;
    let affiliateRevenueKes = 0;
    let affiliateCommissionsKes = 0;
    for (const transaction of settledTransactions) {
      if (saleChannel(transaction) === 'AFFILIATE') {
        affiliateCount += 1;
        affiliateRevenueKes += transaction.amount || 0;
        affiliateCommissionsKes += transaction.commission?.amountKes || 0;
      } else {
        directCount += 1;
        directRevenueKes += transaction.amount || 0;
      }
    }
    return { directCount, directRevenueKes, affiliateCount, affiliateRevenueKes, affiliateCommissionsKes };
  }, [settledTransactions]);

  const filtered = useMemo(() => {
    return purchaseTransactions.filter(tx => {
      if (statusFilter === 'SETTLED' && !isSettled(tx)) return false;
      if (statusFilter === 'PENDING' && !['PENDING', 'INITIATED', 'STK_SENT'].includes(tx.status)) return false;
      if (statusFilter === 'FAILED' && !FAILED_STATUSES.has(tx.status)) return false;
      if (methodFilter !== 'all' && paymentMethod(tx) !== methodFilter) return false;
      if (channelFilter !== 'all' && saleChannel(tx) !== channelFilter) return false;
      if (pieceFilter !== 'all' && tx.articleId !== pieceFilter) return false;

      const occurredAt = Date.parse(tx.settledAt || tx.confirmedAt || tx.completedAt || tx.createdAt);
      if (dateFrom && occurredAt < new Date(`${dateFrom}T00:00:00`).getTime()) return false;
      if (dateTo && occurredAt > new Date(`${dateTo}T23:59:59.999`).getTime()) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inReceipt = (tx.mpesaReceiptNumber || tx.receiptNumber || '').toLowerCase().includes(q);
        const inTitle = (tx.articleTitle || '').toLowerCase().includes(q);
        const inPhone = (tx.buyer?.phoneNumber || tx.phoneNumber || '').toLowerCase().includes(q);
        const inOrder = (tx.orderId || tx.id || tx.checkoutRequestId || '').toLowerCase().includes(q);
        const inBankRef = (tx.bankReference || tx.bankOrderReference || '').toLowerCase().includes(q);
        const inEmail = (tx.buyer?.email || tx.userEmail || '').toLowerCase().includes(q);
        const inName = (tx.buyer?.name || tx.senderName || '').toLowerCase().includes(q);
        const inAffiliate = (tx.commission?.affiliateName || tx.affiliateCode || '').toLowerCase().includes(q);
        if (!inReceipt && !inTitle && !inPhone && !inOrder && !inBankRef && !inEmail && !inName && !inAffiliate) return false;
      }
      return true;
    });
  }, [purchaseTransactions, statusFilter, methodFilter, channelFilter, pieceFilter, dateFrom, dateTo, searchQuery]);

  const handleAdminConfirm = async (txId: string) => {
    try {
      setActionLoadingId(txId);
      setActionMessage(null);
      const res = await api.confirmPaymentAsAdmin(txId);
      if (res.success) {
        setActionMessage(`Transaction ${txId} confirmed and unlocked successfully!`);
        setTimeout(() => setActionMessage(null), 4000);
        onRefresh();
      }
    } catch (err: any) {
      alert(`Confirmation failed: ${err.message || 'Error occurred'}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAdminReject = async (txId: string) => {
    if (!window.confirm('Are you sure you want to mark this transaction as Failed/Rejected?')) return;
    try {
      setActionLoadingId(txId);
      setActionMessage(null);
      const res = await api.rejectPaymentAsAdmin(txId);
      if (res.success) {
        setActionMessage(`Transaction ${txId} marked as failed.`);
        setTimeout(() => setActionMessage(null), 4000);
        onRefresh();
      }
    } catch (err: any) {
      alert(`Action failed: ${err.message || 'Error occurred'}`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleExport = async () => {
    try {
      setExporting(true);
      await api.exportTransactionsCsv({ type: 'PURCHASE' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Export failed';
      alert(`Export failed: ${message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Revenue Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight">
            Pay-to-Read Sales Ledger
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time verification of reader purchases across M-PESA &amp; Bank Payments
          </p>
        </div>

        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono border border-slate-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono border border-slate-800 transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Ledger</span>
          </button>
        </div>
      </div>

      {actionMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/80 text-emerald-300 text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Revenue Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-950/40 via-[#0b1120] to-[#0b1120] border border-emerald-800/40 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-emerald-400">
            <span>Verified Pay-to-Read Revenue</span>
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            KES {verifiedRevenue.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Total funds collected from unlocked monographs
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Successful Purchases</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            {settledTransactions.length}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Confirmed reader unlock transactions
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Direct Sales</span>
            <CreditCard className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            {channelSummary.directCount} <span className="text-sm text-slate-400">/ KES {channelSummary.directRevenueKes.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Purchases without affiliate attribution
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Affiliate Sales</span>
            <Globe className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            {channelSummary.affiliateCount} <span className="text-sm text-slate-400">/ KES {channelSummary.affiliateRevenueKes.toLocaleString()}</span>
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            KES {channelSummary.affiliateCommissionsKes.toLocaleString()} attributed commission
          </p>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="p-4 rounded-xl bg-[#0b1120] border border-slate-800/80 space-y-3">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search sales ledger"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search buyer, phone, email, order, receipt, affiliate, or piece…"
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#080d1a] border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 font-mono"
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 font-mono">Method:</span>
            <select
              value={methodFilter}
              aria-label="Filter sales by payment method"
              onChange={(e) => setMethodFilter(e.target.value as typeof methodFilter)}
              className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono"
            >
              <option value="all">All Methods</option>
              <option value="mpesa">M-Pesa (Kenya)</option>
              <option value="bank">Bank Transfers</option>
              <option value="manual">Manual</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 font-mono">Status:</span>
            <select
              value={statusFilter}
              aria-label="Filter sales by status"
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono"
            >
              <option value="all">All Statuses</option>
              <option value="SETTLED">Confirmed / Paid</option>
              <option value="PENDING">Pending (Action Needed)</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
          <select aria-label="Filter sales by channel" value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as typeof channelFilter)} className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono">
            <option value="all">Direct + affiliate</option>
            <option value="DIRECT">Direct only</option>
            <option value="AFFILIATE">Affiliate only</option>
          </select>
          <select aria-label="Filter sales by piece" value={pieceFilter} onChange={(event) => setPieceFilter(event.target.value)} className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono">
            <option value="all">All pieces</option>
            {pieceOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
          </select>
          <input type="date" aria-label="Sales from date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono" />
          <input type="date" aria-label="Sales through date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono" />
        </div>
        <p className="text-[11px] font-mono text-slate-500">Showing {filtered.length} of {purchaseTransactions.length} permanent purchase records.</p>
      </div>

      {/* Transactions Table */}
      <div className="bg-[#0b1120] border border-slate-800/80 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs font-mono animate-pulse">
            Loading verified payment records...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs font-mono">
            No purchase transactions found matching the filter criteria.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#080d1a] text-slate-400 uppercase font-mono border-b border-slate-800 text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Method</th>
                  <th className="py-3 px-4">Receipt / Order Ref</th>
                  <th className="py-3 px-4">Piece Title</th>
                  <th className="py-3 px-4">Reader Info</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Channel / Commission</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((tx) => {
                  const isSuccess = isSettled(tx);
                  const isPending = ['PENDING', 'INITIATED', 'STK_SENT'].includes(tx.status);
                  const method = paymentMethod(tx);
                  const isBank = method === 'bank';
                  const txId = tx.id || tx.checkoutRequestId;
                  const orderId = tx.orderId || txId;
                  const isActionLoading = actionLoadingId === txId;

                  return (
                    <tr key={orderId} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-3.5 px-4">
                        {isBank ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                            <Building2 className="w-3 h-3" />
                            <span>Bank</span>
                          </span>
                        ) : method === 'manual' ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-sky-950/80 text-sky-300 border border-sky-800/60">
                            <FileText className="w-3 h-3" />
                            <span>Manual</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                            <Smartphone className="w-3 h-3" />
                            <span>M-PESA</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                        {tx.mpesaReceiptNumber || tx.receiptNumber ? (
                          <span className="text-emerald-400 block">{tx.mpesaReceiptNumber || tx.receiptNumber}</span>
                        ) : (
                          <span className="text-slate-500 text-[10px] block">
                            Awaiting receipt
                          </span>
                        )}
                        <span className="text-slate-400 text-[10px] block" title={orderId}>
                          {orderId}
                        </span>
                        {tx.bankReference && (
                          <span className="text-indigo-400 text-[10px] block font-mono">
                            Ref: {tx.bankReference}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs">
                        <button type="button" onClick={() => setPieceFilter(tx.articleId)} className="max-w-xs truncate text-left hover:text-sky-300 hover:underline" title="Show this piece's sales history">
                          {tx.articleTitle || 'Monograph Access'}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        <div className="font-sans text-slate-200">{tx.buyer?.name || tx.senderName || 'Reader'}</div>
                        <div>{tx.buyer?.phoneNumber || tx.phoneNumber || '—'}</div>
                        {(tx.buyer?.email || tx.userEmail) && <div className="text-[10px] text-slate-500">{tx.buyer?.email || tx.userEmail}</div>}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-white">
                        KES {tx.amount}
                      </td>
                      <td className="py-3.5 px-4">
                        {saleChannel(tx) === 'AFFILIATE' ? (
                          <div className="space-y-1">
                            <span className="inline-flex rounded-full border border-cyan-800 bg-cyan-950/60 px-2 py-0.5 text-[10px] font-mono text-cyan-300">Affiliate</span>
                            <div className="text-[10px] text-slate-400">{tx.commission?.affiliateName || tx.affiliateCode}</div>
                            <div className="text-[10px] text-slate-500">KES {(tx.commission?.amountKes || 0).toLocaleString()} · {tx.commission?.status || 'reconciling'}</div>
                          </div>
                        ) : (
                          <span className="inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-mono text-slate-400">Direct</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          isSuccess 
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : isPending
                            ? 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                            : 'bg-rose-950/80 text-rose-300 border border-rose-800/60'
                        }`}>
                          {isSuccess && <CheckCircle2 className="w-3 h-3" />}
                          {isPending && <Clock className="w-3 h-3 animate-spin" />}
                          {FAILED_STATUSES.has(tx.status) && <AlertCircle className="w-3 h-3" />}
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                        {new Date(tx.settledAt || tx.confirmedAt || tx.completedAt || tx.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isPending && isBank && Boolean(tx.bankReference) && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleAdminConfirm(txId)}
                              disabled={isActionLoading}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                              title="Confirm received funds and unlock piece for reader"
                            >
                              {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              <span>Confirm</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Reject payment ${orderId}`}
                              onClick={() => handleAdminReject(txId)}
                              disabled={isActionLoading}
                              className="p-1 rounded bg-rose-950 hover:bg-rose-900 text-rose-400 hover:text-rose-200 border border-rose-800/60 text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                              title="Mark failed / decline"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                        {isPending && (!isBank || !tx.bankReference) && (
                          <span className="text-[10px] font-mono text-amber-400/80">Awaiting provider evidence</span>
                        )}
                        {isSuccess && (
                          <span className="text-[10px] font-mono text-emerald-400/80 flex items-center justify-end gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Unlocked</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

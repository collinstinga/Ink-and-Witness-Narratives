import React, { useState, useMemo } from 'react';
import { 
  CreditCard, 
  DollarSign, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  Download, 
  Filter,
  RefreshCw,
  Phone,
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
  const [statusFilter, setStatusFilter] = useState<'all' | 'SUCCESS' | 'PENDING' | 'FAILED'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'MPESA' | 'BANK'>('all');
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  // Filter Pay-to-Read transactions (type === 'PURCHASE' or not TIP)
  const purchaseTransactions = useMemo(() => {
    return transactions.filter(t => t.type === 'PURCHASE' || t.type === 'MANUAL' || (t as any).method === 'bank' || (t as any).method === 'card');
  }, [transactions]);

  // Verified total earnings
  const verifiedRevenue = useMemo(() => {
    return purchaseTransactions
      .filter(t => t.status === 'SUCCESS')
      .reduce((sum, t) => sum + (t.amount || 0), 0);
  }, [purchaseTransactions]);

  const filtered = useMemo(() => {
    return purchaseTransactions.filter(tx => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      
      const isBank = (tx as any).method === 'bank' || (tx.checkoutRequestId && tx.checkoutRequestId.startsWith('IW-BNK-'));
      const isMpesa = !isBank;

      if (methodFilter === 'MPESA' && !isMpesa) return false;
      if (methodFilter === 'BANK' && !isBank) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inReceipt = (tx.mpesaReceiptNumber || '').toLowerCase().includes(q);
        const inTitle = (tx.articleTitle || '').toLowerCase().includes(q);
        const inPhone = (tx.phoneNumber || '').toLowerCase().includes(q);
        const inReq = (tx.checkoutRequestId || '').toLowerCase().includes(q);
        const inBankRef = ((tx as any).bankReference || '').toLowerCase().includes(q);
        const inEmail = ((tx as any).email || '').toLowerCase().includes(q);
        if (!inReceipt && !inTitle && !inPhone && !inReq && !inBankRef && !inEmail) return false;
      }
      return true;
    });
  }, [purchaseTransactions, statusFilter, methodFilter, searchQuery]);

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

        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono border border-slate-800 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Ledger</span>
        </button>
      </div>

      {actionMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-500/80 text-emerald-300 text-xs font-mono flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{actionMessage}</span>
        </div>
      )}

      {/* Revenue Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
            {purchaseTransactions.filter(t => t.status === 'SUCCESS').length}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Confirmed reader unlock transactions
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Average Monograph Price</span>
            <CreditCard className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            KES {purchaseTransactions.length ? Math.round(verifiedRevenue / Math.max(1, purchaseTransactions.filter(t => t.status === 'SUCCESS').length)) : 300}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Average price per monograph read
          </p>
        </div>
      </div>

      {/* Filter & Search Controls */}
      <div className="p-4 rounded-xl bg-[#0b1120] border border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search receipt, bank ref, phone, or title..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#080d1a] border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 font-mono"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 font-mono">Method:</span>
            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as any)}
              className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono"
            >
              <option value="all">All Methods</option>
              <option value="MPESA">M-Pesa (Kenya)</option>
              <option value="BANK">Bank Transfers</option>
            </select>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-500 font-mono">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono"
            >
              <option value="all">All Statuses</option>
              <option value="SUCCESS">Success Only</option>
              <option value="PENDING">Pending (Action Needed)</option>
              <option value="FAILED">Failed</option>
            </select>
          </div>
        </div>
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
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date &amp; Time</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((tx) => {
                  const isSuccess = tx.status === 'SUCCESS';
                  const isPending = tx.status === 'PENDING';
                  const isBank = (tx as any).method === 'bank' || (tx.checkoutRequestId && tx.checkoutRequestId.startsWith('IW-BNK-'));
                  const txId = tx.id || tx.checkoutRequestId;
                  const isActionLoading = actionLoadingId === txId;

                  return (
                    <tr key={txId} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-3.5 px-4">
                        {isBank ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-indigo-950/80 text-indigo-300 border border-indigo-800/60">
                            <Building2 className="w-3 h-3" />
                            <span>Bank</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/60">
                            <Smartphone className="w-3 h-3" />
                            <span>M-PESA</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-medium text-slate-200">
                        {tx.mpesaReceiptNumber ? (
                          <span className="text-emerald-400 block">{tx.mpesaReceiptNumber}</span>
                        ) : (
                          <span className="text-slate-400 text-[11px] block">
                            {tx.checkoutRequestId}
                          </span>
                        )}
                        {(tx as any).bankReference && (
                          <span className="text-indigo-400 text-[10px] block font-mono">
                            Ref: {(tx as any).bankReference}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        {tx.articleTitle || 'Monograph Access'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        <div>{tx.phoneNumber || '—'}</div>
                        {(tx as any).senderName && (
                          <div className="text-[10px] text-slate-400 font-sans">{(tx as any).senderName}</div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-white">
                        KES {tx.amount}
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
                          {tx.status === 'FAILED' && <AlertCircle className="w-3 h-3" />}
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                        {new Date(tx.createdAt).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {isPending && (
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => handleAdminConfirm(txId)}
                              disabled={isActionLoading}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                              title="Confirm received funds and unlock piece for reader"
                            >
                              {isActionLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              <span>Confirm</span>
                            </button>
                            <button
                              onClick={() => handleAdminReject(txId)}
                              disabled={isActionLoading}
                              className="p-1 rounded bg-rose-950 hover:bg-rose-900 text-rose-400 hover:text-rose-200 border border-rose-800/60 text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                              title="Mark failed / decline"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                            </button>
                          </div>
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

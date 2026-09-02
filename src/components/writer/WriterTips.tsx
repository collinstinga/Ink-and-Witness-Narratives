import React, { useState, useMemo } from 'react';
import { 
  Heart, 
  DollarSign, 
  Search, 
  CheckCircle2, 
  Clock, 
  AlertCircle, 
  RefreshCw,
  Gift,
  Sparkles
} from 'lucide-react';
import { PaymentTransaction } from '../../types.js';

interface WriterTipsProps {
  tips: PaymentTransaction[];
  loading: boolean;
  onRefresh: () => void;
}

export const WriterTips: React.FC<WriterTipsProps> = ({
  tips,
  loading,
  onRefresh
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'SUCCESS' | 'PENDING' | 'FAILED'>('all');

  const verifiedTips = useMemo(() => {
    return tips.filter(t => t.status === 'SUCCESS');
  }, [tips]);

  const totalTipsRevenue = useMemo(() => {
    return verifiedTips.reduce((sum, t) => sum + (t.amount || 0), 0);
  }, [verifiedTips]);

  const filtered = useMemo(() => {
    return tips.filter(tx => {
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const inReceipt = (tx.mpesaReceiptNumber || '').toLowerCase().includes(q);
        const inTitle = (tx.articleTitle || '').toLowerCase().includes(q);
        const inPhone = (tx.phoneNumber || '').toLowerCase().includes(q);
        if (!inReceipt && !inTitle && !inPhone) return false;
      }
      return true;
    });
  }, [tips, statusFilter, searchQuery]);

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight flex items-center gap-2">
            <span>Reader Patron Tips Ledger</span>
            <Heart className="w-5 h-5 text-rose-500 fill-rose-500/20" />
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Voluntary patron donations sent via M-Pesa Till 1618656
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-200 text-xs font-mono border border-slate-800 transition-colors flex items-center gap-2 cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Tips</span>
        </button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-950/40 via-[#0b1120] to-[#0b1120] border border-rose-800/40 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-rose-400">
            <span>Total Reader Tips</span>
            <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            KES {totalTipsRevenue.toLocaleString()}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Direct patron contributions received
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Verified Donations</span>
            <Gift className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-3xl font-serif font-bold text-white">
            {verifiedTips.length}
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Successful reader tip transactions
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>Destination Till</span>
            <Sparkles className="w-4 h-4 text-sky-400" />
          </div>
          <div className="text-2xl font-mono font-bold text-white">
            1618656
          </div>
          <p className="text-[11px] text-slate-400 font-sans">
            Safaricom Buy Goods Till Number
          </p>
        </div>
      </div>

      {/* Filter & Search */}
      <div className="p-4 rounded-xl bg-[#0b1120] border border-slate-800/80 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search tip receipt or phone..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[#080d1a] border border-slate-700/80 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-sky-500 font-mono"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs text-slate-500 font-mono">Status:</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-[#080d1a] border border-slate-700 text-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-sky-500 font-mono"
          >
            <option value="all">All Tips</option>
            <option value="SUCCESS">Confirmed Only</option>
            <option value="PENDING">Pending</option>
          </select>
        </div>
      </div>

      {/* Tips Table */}
      <div className="bg-[#0b1120] border border-slate-800/80 rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-12 text-center text-slate-400 text-xs font-mono animate-pulse">
            Loading reader tips ledger...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs font-mono">
            No tip transactions found. Reader tips sent to Till 1618656 will show up here.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-[#080d1a] text-slate-400 uppercase font-mono border-b border-slate-800 text-[10px] tracking-wider">
                <tr>
                  <th className="py-3 px-4">Receipt</th>
                  <th className="py-3 px-4">Target Piece / Purpose</th>
                  <th className="py-3 px-4">Patron Phone</th>
                  <th className="py-3 px-4">Currency &amp; Orig. Amount</th>
                  <th className="py-3 px-4">Settled (KES)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Date &amp; Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {filtered.map((tx) => {
                  const isSuccess = tx.status === 'SUCCESS';
                  const hasCurrency = tx.currency && tx.currency !== 'KES';
                  return (
                    <tr key={tx.id || tx.checkoutRequestId} className="hover:bg-slate-800/20 transition-colors">
                      <td className="py-3.5 px-4 font-mono font-medium text-rose-300">
                        {tx.mpesaReceiptNumber || 'PENDING'}
                      </td>
                      <td className="py-3.5 px-4 font-medium text-white max-w-xs truncate">
                        {tx.articleTitle || 'Patron Tip to Author'}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-300">
                        {tx.phoneNumber}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-200">
                        {hasCurrency ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-sky-300">
                              {tx.originalAmount} {tx.currency}
                            </span>
                            {tx.exchangeRate && (
                              <span className="text-[10px] text-slate-500">
                                Rate: {tx.exchangeRate} KES/{tx.currency}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400">KES {tx.amount}</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-emerald-400">
                        KES {tx.amount}
                      </td>
                      <td className="py-3.5 px-4">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                          isSuccess 
                            ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800/60'
                            : 'bg-amber-950/80 text-amber-300 border border-amber-800/60'
                        }`}>
                          {isSuccess ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3 animate-spin" />}
                          {tx.status}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 font-mono text-slate-400 text-[11px]">
                        {new Date(tx.createdAt).toLocaleString()}
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

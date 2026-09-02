import React, { useState, useEffect } from 'react';
import { 
  Users, 
  KeyRound, 
  Search, 
  Plus, 
  Trash2, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileText, 
  Smartphone, 
  RefreshCw,
  Copy,
  Check,
  RotateCcw,
  Shield,
  UserCheck,
  Lock,
  Unlock,
  Info
} from 'lucide-react';
import { ReaderLicense, Article, ManualAccessGrant } from '../../types.js';
import { api } from '../../utils/api.js';

interface WriterReadersProps {
  articles: Article[];
}

export const WriterReaders: React.FC<WriterReadersProps> = ({ articles }) => {
  const [activeTab, setActiveTab] = useState<'manual-access' | 'token-licenses'>('manual-access');
  const [manualGrants, setManualGrants] = useState<ManualAccessGrant[]>([]);
  const [licenses, setLicenses] = useState<ReaderLicense[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Manual Grant Modal
  const [showManualGrantModal, setShowManualGrantModal] = useState<boolean>(false);
  const [manualArticleId, setManualArticleId] = useState<string>('');
  const [manualPhone, setManualPhone] = useState<string>('');
  const [manualNotes, setManualNotes] = useState<string>('');
  const [manualSubmitting, setManualSubmitting] = useState<boolean>(false);
  const [manualSuccessMsg, setManualSuccessMsg] = useState<string | null>(null);
  const [manualError, setManualError] = useState<string | null>(null);

  // Reset / Action state
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [bannerMessage, setBannerMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Token License Modal
  const [showLicenseModal, setShowLicenseModal] = useState<boolean>(false);
  const [grantArticleId, setGrantArticleId] = useState<string>('');
  const [grantPhone, setGrantPhone] = useState<string>('');
  const [grantReceipt, setGrantReceipt] = useState<string>('');
  const [grantDurationDays, setGrantDurationDays] = useState<number>(60);
  const [grantSubmitting, setGrantSubmitting] = useState<boolean>(false);
  const [grantSuccessMsg, setGrantSuccessMsg] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [grantsRes, licensesRes] = await Promise.allSettled([
        api.getManualAccessGrants(),
        api.getReaderLicenses()
      ]);

      if (grantsRes.status === 'fulfilled') {
        setManualGrants(grantsRes.value.grants || []);
      }
      if (licensesRes.status === 'fulfilled') {
        setLicenses(licensesRes.value.licenses || []);
      }
    } catch (err) {
      console.error('Failed to load reader data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCopy = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2500);
  };

  const handleCreateManualGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualArticleId || !manualPhone.trim()) {
      setManualError('Please select a monograph and specify the reader phone number.');
      return;
    }

    try {
      setManualSubmitting(true);
      setManualError(null);
      setManualSuccessMsg(null);
      await api.grantManualAccess({
        articleId: manualArticleId,
        phone: manualPhone.trim(),
        notes: manualNotes.trim() || undefined,
        grantedBy: 'Jake'
      });
      setManualSuccessMsg(`Single-session access authorization granted for phone ${manualPhone.trim()}.`);
      setManualPhone('');
      setManualNotes('');
      await fetchData();
    } catch (err: any) {
      setManualError(err.message || 'Failed to grant single-session manual access.');
    } finally {
      setManualSubmitting(false);
    }
  };

  const handleResetManualAccess = async (grant: ManualAccessGrant) => {
    const confirmPrompt = `Are you sure you want to reset manual access for ${grant.phone} (${grant.articleTitle || grant.articleId})?\n\nThis will:\n• Clear the account & device session binding (${grant.boundUserEmail || 'Current Device'})\n• Mark activation status back to Pending (unactivated)\n• Allow the genuine reader to activate again once from their account.`;
    
    if (!window.confirm(confirmPrompt)) {
      return;
    }

    try {
      setActionLoadingId(grant.id);
      const res = await api.resetManualAccess(grant.id);
      setBannerMessage({
        type: 'success',
        text: res.message || `Access for ${grant.phone} has been reset. The authorized reader can now activate it again.`
      });
      await fetchData();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.message || 'Failed to reset manual access.'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRevokeManualAccess = async (grantId: string, phone: string) => {
    if (!window.confirm(`Are you sure you want to revoke manual access for ${phone}? The reader will not be able to read the piece until re-authorized.`)) {
      return;
    }

    try {
      setActionLoadingId(grantId);
      await api.revokeManualAccess(grantId);
      setBannerMessage({
        type: 'success',
        text: `Manual access for ${phone} has been revoked.`
      });
      await fetchData();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.message || 'Failed to revoke manual access.'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDeleteManualAccess = async (grantId: string, phone: string) => {
    if (!window.confirm(`PERMANENT DELETE: Are you sure you want to completely remove the manual access grant for ${phone}?\n\nThis will permanently remove the manual grant record and any associated manual grant tokens. (Legitimate M-Pesa purchases will not be affected).`)) {
      return;
    }

    try {
      setActionLoadingId(grantId);
      await api.deleteManualAccess(grantId);
      setBannerMessage({
        type: 'success',
        text: `Manual access grant for ${phone} has been permanently deleted.`
      });
      await fetchData();
    } catch (err: any) {
      setBannerMessage({
        type: 'error',
        text: err.message || 'Failed to delete manual access grant.'
      });
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleGrantTokenLicense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!grantArticleId || !grantPhone) {
      setGrantError('Please select a monograph and provide reader phone number.');
      return;
    }

    try {
      setGrantSubmitting(true);
      setGrantError(null);
      setGrantSuccessMsg(null);
      const res = await api.grantReaderLicense({
        articleId: grantArticleId,
        phone: grantPhone,
        receipt: grantReceipt || `MANUAL-${Date.now().toString().slice(-6)}`,
        durationDays: Number(grantDurationDays) || 60
      });
      setGrantSuccessMsg(`License token issued successfully: ${res.token}`);
      setGrantPhone('');
      setGrantReceipt('');
      await fetchData();
    } catch (err: any) {
      setGrantError(err.message || 'Failed to grant reader license.');
    } finally {
      setGrantSubmitting(false);
    }
  };

  const handleRevokeTokenLicense = async (token: string) => {
    if (!window.confirm('Are you sure you want to revoke this reader license token?')) {
      return;
    }

    try {
      await api.revokeReaderLicense(token);
      await fetchData();
    } catch (err: any) {
      alert(err.message || 'Failed to revoke license token.');
    }
  };

  // Filtered manual grants
  const filteredGrants = manualGrants.filter(g => {
    const q = searchQuery.toLowerCase();
    const matchPhone = g.phone.toLowerCase().includes(q);
    const matchArticle = (g.articleTitle || '').toLowerCase().includes(q) || g.articleId.toLowerCase().includes(q);
    const matchNotes = (g.notes || '').toLowerCase().includes(q);
    const matchUser = (g.boundUserEmail || '').toLowerCase().includes(q) || (g.boundUserName || '').toLowerCase().includes(q);
    return matchPhone || matchArticle || matchNotes || matchUser;
  });

  // Filtered token licenses
  const filteredLicenses = licenses.filter(lic => {
    const q = searchQuery.toLowerCase();
    const matchesPhone = lic.phone.toLowerCase().includes(q);
    const matchesToken = lic.token.toLowerCase().includes(q);
    const matchesArticle = (lic.articleTitle || '').toLowerCase().includes(q) || lic.articleId.toLowerCase().includes(q);
    const matchesReceipt = (lic.receipt || '').toLowerCase().includes(q);
    return matchesPhone || matchesToken || matchesArticle || matchesReceipt;
  });

  const totalGrantsCount = manualGrants.length;
  const activatedGrantsCount = manualGrants.filter(g => g.activated).length;
  const pendingGrantsCount = manualGrants.filter(g => !g.activated && g.status === 'active').length;

  return (
    <div id="writer-readers-view" className="space-y-8">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-sky-400 mb-1">
            <KeyRound className="w-4 h-4" />
            <span>Access Control &amp; Single-Session Verification</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-serif font-bold text-white">
            Reader Access &amp; Licenses
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 font-sans mt-1">
            Manage single-session phone authorization whitelist, monitor activation bindings, reset reader sessions, and inspect cryptographic licenses.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              if (activeTab === 'manual-access') {
                setShowManualGrantModal(true);
                setManualSuccessMsg(null);
                setManualError(null);
                if (!manualArticleId && articles.length > 0) {
                  setManualArticleId(articles[0].id);
                }
              } else {
                setShowLicenseModal(true);
                setGrantSuccessMsg(null);
                setGrantError(null);
                if (!grantArticleId && articles.length > 0) {
                  setGrantArticleId(articles[0].id);
                }
              }
            }}
            id="btn-grant-access-top"
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-sky-950/50 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{activeTab === 'manual-access' ? 'Authorize Phone Access' : 'Issue Token License'}</span>
          </button>

          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh readers data"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Global Status Banner */}
      {bannerMessage && (
        <div className={`p-4 rounded-xl text-xs flex items-start justify-between gap-3 animate-in fade-in ${
          bannerMessage.type === 'success' 
            ? 'bg-emerald-950/70 border border-emerald-500/50 text-emerald-200' 
            : 'bg-rose-950/70 border border-rose-500/50 text-rose-200'
        }`}>
          <div className="flex items-start gap-2">
            {bannerMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            )}
            <span>{bannerMessage.text}</span>
          </div>
          <button 
            onClick={() => setBannerMessage(null)}
            className="text-xs opacity-70 hover:opacity-100 cursor-pointer font-mono"
          >
            ✕
          </button>
        </div>
      )}

      {/* Section Switcher Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800/80">
        <button
          type="button"
          id="tab-manual-grants"
          onClick={() => setActiveTab('manual-access')}
          className={`px-4 py-3 text-xs font-mono font-medium border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'manual-access'
              ? 'border-sky-500 text-sky-400 bg-sky-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Single-Session Manual Grants ({manualGrants.length})</span>
        </button>

        <button
          type="button"
          id="tab-token-licenses"
          onClick={() => setActiveTab('token-licenses')}
          className={`px-4 py-3 text-xs font-mono font-medium border-b-2 transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'token-licenses'
              ? 'border-sky-500 text-sky-400 bg-sky-950/20'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <KeyRound className="w-4 h-4" />
          <span>Cryptographic Tokens ({licenses.length})</span>
        </button>
      </div>

      {/* ============================================================== */}
      {/* TAB 1: SINGLE-SESSION MANUAL ACCESS (SECURITY SYSTEM) */}
      {/* ============================================================== */}
      {activeTab === 'manual-access' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Summary Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Total Manual Grants</span>
              <span className="text-2xl font-mono font-bold text-white">{totalGrantsCount}</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Activated &amp; Account-Bound</span>
              <span className="text-2xl font-mono font-bold text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 inline" />
                {activatedGrantsCount}
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Pending Initial Activation</span>
              <span className="text-2xl font-mono font-bold text-amber-400 flex items-center gap-2">
                <Clock className="w-5 h-5 text-amber-400 inline" />
                {pendingGrantsCount}
              </span>
            </div>
          </div>

          {/* Security Notice Card */}
          <div className="p-4 rounded-2xl bg-sky-950/20 border border-sky-800/40 text-xs text-sky-200 flex items-start gap-3">
            <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-sky-300">Single-Session Anti-Sharing Policy Enforced</p>
              <p className="text-slate-300 leading-relaxed">
                When an authorized reader enters their granted phone number, the system activates access and permanently binds it to their account. If a second user enters the same number, access is automatically blocked to prevent credential sharing. You can click <strong>Reset</strong> below at any time to clear the binding and allow re-activation.
              </p>
            </div>
          </div>

          {/* Add Manual Grant Modal */}
          {showManualGrantModal && (
            <div className="p-6 rounded-2xl bg-[#0b1120] border border-sky-800/80 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-serif font-bold text-base text-white flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-sky-400" />
                  <span>Authorize Nominated Reader Phone</span>
                </h3>
                <button
                  onClick={() => setShowManualGrantModal(false)}
                  className="text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
                >
                  Close
                </button>
              </div>

              {manualError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{manualError}</span>
                </div>
              )}

              {manualSuccessMsg && (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-mono">{manualSuccessMsg}</span>
                </div>
              )}

              <form onSubmit={handleCreateManualGrant} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Target Monograph</label>
                  <select
                    value={manualArticleId}
                    onChange={(e) => setManualArticleId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">★ All Access Pass (Archive-Wide Access)</option>
                    {articles.map((art) => (
                      <option key={art.id} value={art.id}>
                        {art.title} ({art.priceKes ? `KES ${art.priceKes}` : 'Free'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Reader Phone Number</label>
                  <input
                    type="text"
                    placeholder="e.g. 0712345678 or 2547..."
                    value={manualPhone}
                    onChange={(e) => setManualPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">Any Kenyan or international format will be automatically matched.</p>
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Authorization Notes / Reason (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. VIP Guest Reader, Editorial Review, Cash / Bank payment, Friend"
                    value={manualNotes}
                    onChange={(e) => setManualNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowManualGrantModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={manualSubmitting}
                    className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium font-sans flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    {manualSubmitting ? 'Authorizing...' : 'Grant & Whitelist Phone'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Grants Search & Table */}
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by phone, title, bound email, or notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <span className="text-xs font-mono text-slate-400">
                Showing {filteredGrants.length} of {manualGrants.length} manual grants
              </span>
            </div>

            {/* Manual Grants Table */}
            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Reader Phone</th>
                    <th className="py-3.5 px-4 font-medium">Target Piece</th>
                    <th className="py-3.5 px-4 font-medium">Access Status</th>
                    <th className="py-3.5 px-4 font-medium">Activation Status</th>
                    <th className="py-3.5 px-4 font-medium">Bound Account Identity</th>
                    <th className="py-3.5 px-4 font-medium">Granted Info</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredGrants.map((grant) => (
                    <tr key={grant.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Phone */}
                      <td className="py-3.5 px-4 text-slate-200 font-bold">
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-sky-400" />
                          <span>{grant.phone}</span>
                        </div>
                      </td>

                      {/* Piece */}
                      <td className="py-3.5 px-4 text-slate-300 font-sans max-w-[180px] truncate">
                        {grant.articleTitle || (grant.articleId === 'all' ? '★ All Access Pass' : grant.articleId)}
                      </td>

                      {/* Access Status */}
                      <td className="py-3.5 px-4">
                        {grant.status === 'claimed' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] inline-flex items-center gap-1 font-semibold">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Claimed / Active
                          </span>
                        ) : grant.status === 'active' ? (
                          <span className="px-2 py-0.5 rounded-full bg-sky-950/80 border border-sky-800 text-sky-300 text-[10px] inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
                            Active (Granted)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-rose-400 text-[10px] inline-flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                            Revoked
                          </span>
                        )}
                      </td>

                      {/* Activation Status & Date */}
                      <td className="py-3.5 px-4">
                        {grant.activated || grant.status === 'claimed' ? (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-[10px] inline-flex items-center gap-1 font-semibold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              Bound &amp; Unlocked
                            </span>
                            {(grant.claimedAt || grant.activatedAt) && (
                              <p className="text-[10px] text-slate-400">
                                {new Date(grant.claimedAt || grant.activatedAt!).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit'
                                })}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="px-2 py-0.5 rounded-full bg-amber-950/80 border border-amber-800 text-amber-300 text-[10px] inline-flex items-center gap-1">
                              <Clock className="w-3 h-3 text-amber-400" />
                              Pending Claim
                            </span>
                            <p className="text-[10px] text-slate-500">Not yet claimed by reader</p>
                          </div>
                        )}
                      </td>

                      {/* Bound Account Identity */}
                      <td className="py-3.5 px-4">
                        {(grant.boundUserEmail || grant.claimedUserEmail) ? (
                          <div className="space-y-0.5 font-sans">
                            <div className="flex items-center gap-1 text-slate-200 text-xs font-medium">
                              <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              <span className="truncate max-w-[140px]">{grant.boundUserName || grant.claimedUserName || 'Verified Reader'}</span>
                            </div>
                            <p className="text-[10px] text-slate-400 font-mono truncate max-w-[160px]">
                              {grant.boundUserEmail || grant.claimedUserEmail}
                            </p>
                          </div>
                        ) : (
                          <span className="text-slate-500 text-[11px] italic">Unbound (Direct Reader Token)</span>
                        )}
                      </td>

                      {/* Granted Info */}
                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        <p>{grant.grantedBy || 'Jake'}</p>
                        <p className="text-[10px] text-slate-500">
                          {new Date(grant.grantedAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </p>
                        {grant.notes && (
                          <p className="text-[10px] text-sky-400/80 truncate max-w-[120px]" title={grant.notes}>
                            Note: {grant.notes}
                          </p>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Reset Access Button */}
                          <button
                            type="button"
                            onClick={() => handleResetManualAccess(grant)}
                            disabled={actionLoadingId === grant.id}
                            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 hover:text-amber-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                            title="Reset manual access (clears binding so reader can re-claim)"
                          >
                            <RotateCcw className={`w-3.5 h-3.5 ${actionLoadingId === grant.id ? 'animate-spin' : ''}`} />
                          </button>

                          {/* Revoke Access Button */}
                          {grant.status !== 'revoked' ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeManualAccess(grant.id, grant.phone)}
                              disabled={actionLoadingId === grant.id}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-rose-300 hover:text-rose-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                              title="Revoke access (temporarily disable)"
                            >
                              <Lock className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleResetManualAccess(grant)}
                              disabled={actionLoadingId === grant.id}
                              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-300 hover:text-emerald-200 border border-slate-700 transition-colors cursor-pointer disabled:opacity-50"
                              title="Re-activate access"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                            </button>
                          )}

                          {/* Permanent Delete Button */}
                          <button
                            type="button"
                            onClick={() => handleDeleteManualAccess(grant.id, grant.phone)}
                            disabled={actionLoadingId === grant.id}
                            className="p-1.5 rounded-lg hover:bg-rose-950/60 text-slate-500 hover:text-rose-400 border border-transparent hover:border-rose-900 transition-colors cursor-pointer disabled:opacity-50"
                            title="Permanently DELETE manual grant"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}

                  {filteredGrants.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-500 font-mono text-xs">
                        No manual access grants found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* TAB 2: CRYPTOGRAPHIC READER LICENSES (TOKENS & M-PESA) */}
      {/* ============================================================== */}
      {activeTab === 'token-licenses' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          
          {/* Stats row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Total Issued Tokens</span>
              <span className="text-2xl font-mono font-bold text-white">{licenses.length}</span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Active / Non-Expired</span>
              <span className="text-2xl font-mono font-bold text-emerald-400">
                {licenses.filter(l => l.status === 'active').length}
              </span>
            </div>
            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800">
              <span className="text-[11px] font-mono text-slate-400 block mb-1">Unique Verified Readers</span>
              <span className="text-2xl font-mono font-bold text-sky-400">
                {new Set(licenses.map(l => l.phone)).size}
              </span>
            </div>
          </div>

          {/* License Modal / Form */}
          {showLicenseModal && (
            <div className="p-6 rounded-2xl bg-[#0b1120] border border-sky-800/80 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="font-serif font-bold text-base text-white flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-sky-400" />
                  <span>Issue Monograph Access License Token</span>
                </h3>
                <button
                  onClick={() => setShowLicenseModal(false)}
                  className="text-slate-400 hover:text-white text-xs font-mono cursor-pointer"
                >
                  Close
                </button>
              </div>

              {grantError && (
                <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{grantError}</span>
                </div>
              )}

              {grantSuccessMsg && (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="font-mono">{grantSuccessMsg}</span>
                </div>
              )}

              <form onSubmit={handleGrantTokenLicense} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-sans">
                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Target Monograph</label>
                  <select
                    value={grantArticleId}
                    onChange={(e) => setGrantArticleId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                  >
                    <option value="all">★ All Access Pass (Archive-Wide)</option>
                    {articles.map((art) => (
                      <option key={art.id} value={art.id}>
                        {art.title} ({art.priceKes ? `KES ${art.priceKes}` : 'Free'})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Reader Phone / Identifier</label>
                  <input
                    type="text"
                    placeholder="254712345678"
                    value={grantPhone}
                    onChange={(e) => setGrantPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Reference / Note (Optional)</label>
                  <input
                    type="text"
                    placeholder="e.g. VIP Gift, Manual MPESA Ref, Editorial Review"
                    value={grantReceipt}
                    onChange={(e) => setGrantReceipt(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-mono text-[11px] mb-1">Validity (Days)</label>
                  <input
                    type="number"
                    min="1"
                    max="3650"
                    value={grantDurationDays}
                    onChange={(e) => setGrantDurationDays(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                  />
                </div>

                <div className="md:col-span-2 flex justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowLicenseModal(false)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-mono cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={grantSubmitting}
                    className="px-5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium font-sans flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    {grantSubmitting ? 'Issuing...' : 'Grant & Issue Token'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Search & Table */}
          <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by phone, token ID, title, or receipt..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <span className="text-xs font-mono text-slate-400">
                Showing {filteredLicenses.length} of {licenses.length} tokens
              </span>
            </div>

            <div className="overflow-x-auto border border-slate-800 rounded-xl">
              <table className="w-full text-left text-xs font-sans">
                <thead className="bg-[#090e1a] text-slate-400 font-mono uppercase tracking-wider text-[10px] border-b border-slate-800">
                  <tr>
                    <th className="py-3.5 px-4 font-medium">Reader Phone</th>
                    <th className="py-3.5 px-4 font-medium">Monograph Title</th>
                    <th className="py-3.5 px-4 font-medium">Access Token</th>
                    <th className="py-3.5 px-4 font-medium">Issued At</th>
                    <th className="py-3.5 px-4 font-medium">Status</th>
                    <th className="py-3.5 px-4 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 font-mono">
                  {filteredLicenses.map((lic) => (
                    <tr key={lic.token} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4 text-slate-200 font-bold flex items-center gap-1.5">
                        <Smartphone className="w-3.5 h-3.5 text-slate-500" />
                        <span>{lic.phone}</span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-300 font-sans max-w-xs truncate">
                        {lic.articleTitle || (lic.articleId === 'all' ? '★ All Access Pass' : lic.articleId)}
                      </td>

                      <td className="py-3.5 px-4 text-slate-400">
                        <div className="flex items-center gap-2">
                          <span className="truncate max-w-[140px] text-[11px] bg-slate-950 px-2 py-0.5 rounded border border-slate-800 font-mono text-sky-400">
                            {lic.token}
                          </span>
                          <button
                            onClick={() => handleCopy(lic.token)}
                            className="text-slate-400 hover:text-white transition-colors cursor-pointer"
                            title="Copy token"
                          >
                            {copiedToken === lic.token ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-400 text-[11px]">
                        {new Date(lic.createdAt).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>

                      <td className="py-3.5 px-4">
                        {lic.status === 'active' ? (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[10px]">
                            Active
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-800 text-rose-400 text-[10px]">
                            Expired
                          </span>
                        )}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <button
                          onClick={() => handleRevokeTokenLicense(lic.token)}
                          className="p-1.5 rounded-lg hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Revoke License"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}

                  {filteredLicenses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-500 font-mono text-xs">
                        No reader licenses match the search query.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { 
  Share2, 
  Users, 
  DollarSign, 
  ShoppingBag, 
  Wallet, 
  TrendingUp, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Search, 
  Filter, 
  RefreshCw, 
  Plus, 
  Edit3, 
  Trash2, 
  Eye, 
  Lock, 
  Unlock, 
  Sliders, 
  Sparkles, 
  Send, 
  Check, 
  X, 
  ArrowUpRight, 
  FileText,
  AlertTriangle,
  History,
  Tag
} from 'lucide-react';
import { 
  AdminAffiliatesSummary, 
  AffiliateAccount, 
  AffiliateSaleCommission, 
  AffiliatePayoutRequest, 
  AffiliateCampaign, 
  AffiliateSettings, 
  AffiliateAuditLogEntry,
  Article
} from '../../types.js';
import { api } from '../../utils/api.js';
import { validateAffiliatePasswordForInput } from '../../utils/affiliatePasswordPolicy.js';

interface AffiliatesAdminTabProps {
  articles: Article[];
}

type AdminSubTab = 'overview' | 'affiliates' | 'commissions' | 'payouts' | 'campaigns' | 'settings' | 'audit';

export const AffiliatesAdminTab: React.FC<AffiliatesAdminTabProps> = ({
  articles
}) => {
  const [activeSubTab, setActiveSubTab] = useState<AdminSubTab>('overview');
  const [summary, setSummary] = useState<AdminAffiliatesSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  // Modals state
  const [showCreateAffiliateModal, setShowCreateAffiliateModal] = useState(false);
  const [showEditAffiliateModal, setShowEditAffiliateModal] = useState<AffiliateAccount | null>(null);
  const [showPayoutProcessModal, setShowPayoutProcessModal] = useState<AffiliatePayoutRequest | null>(null);
  const [showAffiliateDetailsModal, setShowAffiliateDetailsModal] = useState<AffiliateAccount | null>(null);
  const [showCreateCampaignModal, setShowCreateCampaignModal] = useState(false);

  // New Affiliate Form
  const [newAffName, setNewAffName] = useState('');
  const [newAffEmail, setNewAffEmail] = useState('');
  const [newAffPhone, setNewAffPhone] = useState('');
  const [newAffCode, setNewAffCode] = useState('');
  const [newAffRate, setNewAffRate] = useState<number>(15);
  const [newAffPassword, setNewAffPassword] = useState('');
  const [creatingAff, setCreatingAff] = useState(false);

  // Edit Affiliate & Custom Commission State
  const [editAffName, setEditAffName] = useState('');
  const [editAffEmail, setEditAffEmail] = useState('');
  const [editAffPhone, setEditAffPhone] = useState('');
  const [editAffIsCustomRate, setEditAffIsCustomRate] = useState(false);
  const [editAffRate, setEditAffRate] = useState<number>(15);
  const [editAffStatus, setEditAffStatus] = useState<any>('active');
  const [editAffLinksDisabled, setEditAffLinksDisabled] = useState(false);
  const [editAffNotes, setEditAffNotes] = useState('');
  const [savingEditAff, setSavingEditAff] = useState(false);

  // Payout Process Form
  const [payoutAction, setPayoutAction] = useState<'pay' | 'reject'>('pay');
  const [payoutRef, setPayoutRef] = useState('');
  const [payoutNotes, setPayoutNotes] = useState('');
  const [processingPayout, setProcessingPayout] = useState(false);

  // Campaign Form
  const [campCode, setCampCode] = useState('');
  const [campName, setCampName] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [campRate, setCampRate] = useState<number>(20);
  const [campDays, setCampDays] = useState<number>(30);
  const [savingCamp, setSavingCamp] = useState(false);

  // Settings State
  const [settingsForm, setSettingsForm] = useState<AffiliateSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);

  // Filters
  const [affSearch, setAffSearch] = useState('');
  const [affStatusFilter, setAffStatusFilter] = useState('ALL');
  const [commSearch, setCommSearch] = useState('');
  const [commStatusFilter, setCommStatusFilter] = useState('ALL');

  const loadSummary = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const res = await api.getAdminAffiliatesSummary();
      setSummary(res);
      if (res.settings) {
        setSettingsForm(res.settings);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load affiliate administration summary');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadSummary();
    const timer = setInterval(() => {
      loadSummary(true);
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  const handleCreateAffiliate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAffName.trim() || !newAffEmail.trim() || !newAffPassword) {
      setError('Please fill in Name, Email, and Initial Password.');
      return;
    }
    const passwordError = validateAffiliatePasswordForInput(newAffPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    setError('');
    setCreatingAff(true);
    try {
      const res = await api.createAdminAffiliate({
        name: newAffName.trim(),
        email: newAffEmail.trim().toLowerCase(),
        phone: newAffPhone.trim() || undefined,
        affiliateCode: newAffCode.trim() || undefined,
        customCommissionRate: newAffRate || 15,
        password: newAffPassword
      });
      if (res.success) {
        setSuccessMsg(`Affiliate "${res.affiliate.name}" created with code "${res.affiliate.affiliateCode}"!`);
        setShowCreateAffiliateModal(false);
        setNewAffName('');
        setNewAffEmail('');
        setNewAffPhone('');
        setNewAffCode('');
        setNewAffPassword('');
        loadSummary(true);
        setTimeout(() => setSuccessMsg(''), 4000);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to create affiliate');
    } finally {
      setCreatingAff(false);
    }
  };

  const handleOpenEditAffiliate = (aff: AffiliateAccount) => {
    setShowEditAffiliateModal(aff);
    setEditAffName(aff.name || '');
    setEditAffEmail(aff.email || '');
    setEditAffPhone(aff.phone || '');
    const hasCustom = aff.customCommissionRate !== null && aff.customCommissionRate !== undefined;
    setEditAffIsCustomRate(hasCustom);
    setEditAffRate(hasCustom ? Number(aff.customCommissionRate) : (summary?.settings?.defaultCommissionRate || 15));
    setEditAffStatus(aff.status || 'active');
    setEditAffLinksDisabled(!!aff.linksDisabled);
    setEditAffNotes(aff.notes || '');
  };

  const handleSaveEditAffiliate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showEditAffiliateModal) return;

    if (!editAffName.trim() || !editAffEmail.trim()) {
      alert("Name and email are required.");
      return;
    }

    setSavingEditAff(true);
    try {
      const finalRate = editAffIsCustomRate ? Number(editAffRate) : null;
      await api.updateAdminAffiliate(showEditAffiliateModal.id, {
        name: editAffName.trim(),
        email: editAffEmail.trim().toLowerCase(),
        phone: editAffPhone.trim() || undefined,
        customCommissionRate: finalRate,
        status: editAffStatus,
        linksDisabled: editAffLinksDisabled,
        notes: editAffNotes.trim() || undefined
      });

      setSuccessMsg(`Updated partner "${editAffName}" — Commission Rate set to ${finalRate !== null ? `${finalRate}% (Custom Override)` : `15% (Global Default)`}`);
      setShowEditAffiliateModal(null);
      loadSummary(true);
      setTimeout(() => setSuccessMsg(''), 4500);
    } catch (err: any) {
      alert(`Failed to update affiliate: ${err.message}`);
    } finally {
      setSavingEditAff(false);
    }
  };

  const handleToggleStatus = async (aff: AffiliateAccount) => {
    const nextStatus = aff.status === 'active' ? 'suspended' : 'active';
    const reason = nextStatus === 'suspended' ? prompt("Reason for suspension (optional):") || undefined : undefined;
    
    try {
      await api.setAdminAffiliateStatus(aff.id, nextStatus, reason);
      loadSummary(true);
    } catch (err: any) {
      alert(`Failed to update status: ${err.message}`);
    }
  };

  const handleToggleLinks = async (aff: AffiliateAccount) => {
    try {
      await api.toggleAdminAffiliateLinks(aff.id, !aff.linksDisabled);
      loadSummary(true);
    } catch (err: any) {
      alert(`Failed to toggle links: ${err.message}`);
    }
  };

  const handleResetPassword = async (aff: AffiliateAccount) => {
    const newPass = window.prompt(`Enter a new password for ${aff.name}, or leave blank to securely auto-generate one:`);
    if (newPass === null) {
      return;
    }

    const shouldGenerate = newPass.trim().length === 0;
    if (shouldGenerate && !window.confirm(`Generate a secure temporary password for ${aff.name}?`)) {
      return;
    }

    if (!shouldGenerate) {
      const passwordError = validateAffiliatePasswordForInput(newPass);
      if (passwordError) {
        window.alert(passwordError);
        return;
      }
    }

    try {
      const res = await api.resetAdminAffiliatePassword(aff.id, shouldGenerate ? undefined : newPass);
      const generatedPassword = (res as typeof res & { generatedPassword?: string }).generatedPassword
        ?? res.temporaryPassword;
      if (generatedPassword) {
        window.alert(`Password updated for ${aff.name}.\n\nOne-time generated password:\n${generatedPassword}\n\nCopy and share it securely now. It will not be shown again.`);
      } else {
        window.alert(`Password updated for ${aff.name}.`);
      }
      loadSummary(true);
    } catch (err: any) {
      window.alert(`Failed to reset password: ${err.message}`);
    }
  };

  const handleDeleteAffiliate = async (aff: AffiliateAccount) => {
    if (!window.confirm(`Are you sure you want to permanently delete affiliate ${aff.name} (${aff.affiliateCode})?`)) {
      return;
    }
    try {
      await api.deleteAdminAffiliate(aff.id);
      loadSummary(true);
    } catch (err: any) {
      alert(`Failed to delete affiliate: ${err.message}`);
    }
  };

  const handleProcessPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!showPayoutProcessModal) return;

    setProcessingPayout(true);
    try {
      await api.processAdminAffiliatePayout(
        showPayoutProcessModal.id,
        payoutAction,
        payoutRef.trim() || undefined,
        payoutNotes.trim() || undefined
      );
      setSuccessMsg(`Payout request for KES ${showPayoutProcessModal.amountKes.toLocaleString()} marked as ${payoutAction === 'pay' ? 'Paid' : 'Rejected'}.`);
      setShowPayoutProcessModal(null);
      setPayoutRef('');
      setPayoutNotes('');
      loadSummary(true);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(`Failed to process payout: ${err.message}`);
    } finally {
      setProcessingPayout(false);
    }
  };

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campCode || !campName) {
      alert("Code and Name are required.");
      return;
    }
    setSavingCamp(true);
    try {
      await api.saveAdminAffiliateCampaign({
        code: campCode.toLowerCase().trim(),
        name: campName.trim(),
        description: campDesc.trim(),
        commissionRate: campRate,
        attributionDays: campDays,
        eligiblePieceIds: []
      });
      setShowCreateCampaignModal(false);
      setCampCode('');
      setCampName('');
      setCampDesc('');
      loadSummary(true);
    } catch (err: any) {
      alert(`Failed to save campaign: ${err.message}`);
    } finally {
      setSavingCamp(false);
    }
  };

  const handleDeleteCampaign = async (campId: string) => {
    if (!window.confirm("Delete this promotional campaign?")) return;
    try {
      await api.deleteAdminAffiliateCampaign(campId);
      loadSummary(true);
    } catch (err: any) {
      alert(`Failed to delete campaign: ${err.message}`);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settingsForm) return;
    setSavingSettings(true);
    try {
      const res = await api.saveAdminAffiliateSettings(settingsForm);
      setSettingsForm(res.settings);
      setSuccessMsg("Affiliate program global settings updated successfully!");
      loadSummary(true);
      setTimeout(() => setSuccessMsg(''), 4000);
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    } finally {
      setSavingSettings(false);
    }
  };

  // Filter affiliates
  const filteredAffiliates = (summary?.affiliates || []).filter((aff) => {
    const matchesSearch = 
      aff.name.toLowerCase().includes(affSearch.toLowerCase()) ||
      aff.email.toLowerCase().includes(affSearch.toLowerCase()) ||
      aff.affiliateCode.toLowerCase().includes(affSearch.toLowerCase());
    const matchesStatus = affStatusFilter === 'ALL' || aff.status === affStatusFilter;
    return matchesSearch && matchesStatus;
  });

  // Filter commissions
  const filteredCommissions = (summary?.recentSales || []).filter((sale) => {
    const matchesSearch = 
      sale.articleTitle.toLowerCase().includes(commSearch.toLowerCase()) ||
      sale.affiliateName.toLowerCase().includes(commSearch.toLowerCase()) ||
      sale.affiliateCode.toLowerCase().includes(commSearch.toLowerCase()) ||
      sale.receiptNumber.toLowerCase().includes(commSearch.toLowerCase());
    const matchesStatus = commStatusFilter === 'ALL' || sale.status === commStatusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div id="writer-affiliates-admin-tab" className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl bg-[#080d1a] border border-slate-800">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <Share2 className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-serif font-bold text-white tracking-wide">
                Affiliates &amp; Referral Sales Control Center
              </h2>
              <span className="px-2 py-0.5 rounded-md bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono text-[10px] font-semibold">
                ADMIN
              </span>
            </div>
            <p className="text-xs text-slate-400 font-sans mt-0.5">
              Full control over referral partners, commission calculations, payout disbursements, and anti-fraud monitoring.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={() => loadSummary(true)}
            disabled={refreshing}
            className="p-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
            title="Refresh All Affiliate Data"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
          </button>

          <button
            onClick={() => setShowCreateAffiliateModal(true)}
            className="px-3.5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Affiliate</span>
          </button>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* Sub Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveSubTab('overview')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'overview' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>Overview</span>
        </button>

        <button
          onClick={() => setActiveSubTab('affiliates')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'affiliates' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span>Affiliates ({summary?.totalAffiliates || 0})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('commissions')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'commissions' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShoppingBag className="w-3.5 h-3.5" />
          <span>Commissions Ledger ({summary?.recentSales?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('payouts')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'payouts' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>Payout Requests ({summary?.payouts?.filter(p => p.status === 'pending')?.length || 0} pending)</span>
        </button>

        <button
          onClick={() => setActiveSubTab('campaigns')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'campaigns' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>Campaigns ({summary?.campaigns?.length || 0})</span>
        </button>

        <button
          onClick={() => setActiveSubTab('settings')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'settings' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Program Rules</span>
        </button>

        <button
          onClick={() => setActiveSubTab('audit')}
          className={`px-3.5 py-2 rounded-xl font-mono text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
            activeSubTab === 'audit' ? 'bg-cyan-950 text-cyan-300 border border-cyan-700/80 shadow-sm' : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Audit Log</span>
        </button>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-xs">
          <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
          <span>Loading affiliate administration center...</span>
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW */}
          {activeSubTab === 'overview' && (
            <div className="space-y-6 animate-in fade-in">
              {/* Summary KPIs */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono">Affiliates</span>
                    <Users className="w-4 h-4 text-cyan-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-white">
                    {summary?.totalAffiliates || 0}
                  </p>
                  <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                    {summary?.activeAffiliates || 0} active
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono">Total Clicks</span>
                    <TrendingUp className="w-4 h-4 text-sky-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-white">
                    {summary?.totalAffiliateClicks?.toLocaleString() || 0}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Referral visits
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono">Referral Sales</span>
                    <ShoppingBag className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-emerald-400">
                    {summary?.totalAffiliateSales || 0}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Monographs bought
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                  <div className="flex items-center justify-between text-slate-400 mb-1">
                    <span className="text-[11px] font-mono">Gross Sales</span>
                    <DollarSign className="w-4 h-4 text-sky-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-sky-300">
                    KES {(summary?.totalRevenueGeneratedKes || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    Revenue via partners
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-800/60">
                  <div className="flex items-center justify-between text-amber-300 mb-1">
                    <span className="text-[11px] font-mono">Unpaid Balance</span>
                    <Wallet className="w-4 h-4 text-amber-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-amber-400">
                    KES {(summary?.outstandingBalanceKes || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-amber-500 font-mono mt-0.5">
                    Owed to partners
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60">
                  <div className="flex items-center justify-between text-emerald-300 mb-1">
                    <span className="text-[11px] font-mono">Paid Out</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  </div>
                  <p className="text-xl font-bold font-mono text-emerald-400">
                    KES {(summary?.paidCommissionsKes || 0).toLocaleString()}
                  </p>
                  <p className="text-[10px] text-emerald-500 font-mono mt-0.5">
                    Total disbursed
                  </p>
                </div>
              </div>

              {/* Pending Payout Requests Banner */}
              {(summary?.payouts?.filter(p => p.status === 'pending')?.length || 0) > 0 && (
                <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                      <Wallet className="w-4 h-4" />
                    </div>
                    <div>
                      <p className="text-xs font-mono font-semibold text-amber-300">
                        {summary?.payouts?.filter(p => p.status === 'pending')?.length} Affiliate Payout Request(s) Pending Review
                      </p>
                      <p className="text-[11px] text-amber-400/80">
                        Affiliates have reached their minimum payout threshold and are awaiting disbursement.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setActiveSubTab('payouts')}
                    className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono font-bold text-xs transition-all shadow-md cursor-pointer shrink-0"
                  >
                    Review Payouts
                  </button>
                </div>
              )}

              {/* Top Performing Affiliates */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-serif font-bold text-white">
                    Top Referral Partners
                  </h3>
                  <button
                    onClick={() => setActiveSubTab('affiliates')}
                    className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>View All Affiliates</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </button>
                </div>

                {(!summary?.topAffiliates || summary.topAffiliates.length === 0) ? (
                  <div className="p-8 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                    No active referral sales registered yet. Share referral codes with partners to see leaderboard analytics.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {summary.topAffiliates.map((top, idx) => (
                      <div key={top.id} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-bold">
                            #{idx + 1} • {top.affiliateCode}
                          </span>
                          <span className="text-xs font-mono text-emerald-400 font-bold">
                            {top.salesCount} sales
                          </span>
                        </div>

                        <p className="text-xs font-serif font-bold text-slate-100">
                          {top.name}
                        </p>

                        <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-slate-800 text-slate-400">
                          <span>Revenue: KES {top.revenueKes.toLocaleString()}</span>
                          <span className="text-emerald-400 font-bold">Earned: KES {top.commissionEarnedKes.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: AFFILIATES LIST */}
          {activeSubTab === 'affiliates' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={affSearch}
                      onChange={(e) => setAffSearch(e.target.value)}
                      placeholder="Search name, email, code..."
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <select
                    value={affStatusFilter}
                    onChange={(e) => setAffStatusFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="suspended">Suspended</option>
                  </select>
                </div>

                <button
                  onClick={() => setShowCreateAffiliateModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Affiliate</span>
                </button>
              </div>

              {filteredAffiliates.length === 0 ? (
                <div className="py-16 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                  No affiliates found matching filter.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Partner Name</th>
                        <th className="p-3">Referral Code</th>
                        <th className="p-3">Rate</th>
                        <th className="p-3 text-right">Clicks</th>
                        <th className="p-3 text-right">Sales</th>
                        <th className="p-3 text-right">Earned</th>
                        <th className="p-3 text-right">Available Balance</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {filteredAffiliates.map((aff) => (
                        <tr key={aff.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 font-medium text-slate-100">
                            <div>{aff.name}</div>
                            <div className="text-[10px] text-slate-500 font-sans">{aff.email}</div>
                          </td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 text-[11px] font-bold">
                              {aff.affiliateCode}
                            </span>
                            {aff.linksDisabled && (
                              <span className="ml-1 text-[9px] text-rose-400 font-bold uppercase">(Links Off)</span>
                            )}
                          </td>
                          <td className="p-3">
                            <button
                              onClick={() => handleOpenEditAffiliate(aff)}
                              className="flex items-center gap-1.5 text-left group cursor-pointer"
                              title="Click to customize or tweak commission rate for this partner"
                            >
                              <span className="text-emerald-400 font-bold font-mono group-hover:underline">
                                {aff.customCommissionRate !== undefined && aff.customCommissionRate !== null
                                  ? `${aff.customCommissionRate}%`
                                  : `${aff.commissionRate || summary?.settings?.defaultCommissionRate || 15}%`}
                              </span>
                              {aff.customCommissionRate !== undefined && aff.customCommissionRate !== null ? (
                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-950 text-cyan-300 border border-cyan-800 font-mono">
                                  Custom
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-slate-800 text-slate-400 font-mono">
                                  15% Flat
                                </span>
                              )}
                              <Edit3 className="w-3 h-3 text-slate-500 opacity-60 group-hover:opacity-100 group-hover:text-cyan-300 transition-opacity ml-0.5" />
                            </button>
                          </td>
                          <td className="p-3 text-right text-slate-300 font-mono font-medium">
                            {(aff.totalClicks ?? (aff as any).clicksCount ?? 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-slate-300 font-mono">
                            {aff.totalSalesCount || 0}
                          </td>
                          <td className="p-3 text-right text-emerald-400 font-bold font-mono">
                            KES {(aff.totalCommissionEarnedKes || 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-cyan-300 font-bold font-mono">
                            KES {(aff.balanceAvailableKes || 0).toLocaleString()}
                          </td>
                          <td className="p-3 text-center">
                            <button
                              onClick={() => handleToggleStatus(aff)}
                              className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold cursor-pointer ${
                                aff.status === 'active' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                                aff.status === 'suspended' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                                'bg-amber-950 text-amber-400 border border-amber-800'
                              }`}
                              title="Click to toggle active/suspended"
                            >
                              {aff.status}
                            </button>
                          </td>
                          <td className="p-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleOpenEditAffiliate(aff)}
                                className="p-1.5 rounded-lg bg-cyan-950/60 hover:bg-cyan-900 border border-cyan-800/80 text-cyan-300 hover:text-white cursor-pointer transition-colors"
                                title="Edit Partner & Tweak Commission %"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => handleToggleLinks(aff)}
                                className={`p-1.5 rounded-lg border text-xs cursor-pointer ${
                                  aff.linksDisabled ? 'bg-rose-950 border-rose-800 text-rose-300' : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
                                }`}
                                title={aff.linksDisabled ? "Enable Referral Links" : "Disable Referral Links"}
                              >
                                {aff.linksDisabled ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                              </button>

                              <button
                                onClick={() => handleResetPassword(aff)}
                                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 hover:text-white cursor-pointer"
                                title="Reset Password"
                              >
                                <Lock className="w-3.5 h-3.5 text-amber-400" />
                              </button>

                              <button
                                onClick={() => handleDeleteAffiliate(aff)}
                                className="p-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 border border-rose-800/60 text-rose-300 hover:text-white cursor-pointer"
                                title="Delete Affiliate"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: COMMISSIONS LEDGER */}
          {activeSubTab === 'commissions' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="relative flex-1 sm:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                    <input
                      type="text"
                      value={commSearch}
                      onChange={(e) => setCommSearch(e.target.value)}
                      placeholder="Search piece, affiliate, receipt..."
                      className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <select
                    value={commStatusFilter}
                    onChange={(e) => setCommStatusFilter(e.target.value)}
                    className="bg-slate-900 border border-slate-700/80 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-mono focus:outline-none"
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="verified">Verified</option>
                    <option value="pending">Pending</option>
                    <option value="paid">Paid Out</option>
                    <option value="reversed">Reversed</option>
                  </select>
                </div>
              </div>

              {filteredCommissions.length === 0 ? (
                <div className="py-16 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                  No commissions logged matching current filter.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Monograph Title</th>
                        <th className="p-3">Affiliate Partner</th>
                        <th className="p-3 text-right">Sale Amount</th>
                        <th className="p-3 text-right">Rate</th>
                        <th className="p-3 text-right">Commission KES</th>
                        <th className="p-3 text-right">Jake Net Revenue</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {filteredCommissions.map((comm) => (
                        <tr key={comm.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 text-slate-400 whitespace-nowrap">
                            {new Date(comm.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </td>
                          <td className="p-3 font-serif font-semibold text-slate-100 max-w-xs truncate">
                            {comm.articleTitle}
                            {comm.fraudFlag?.flagged && (
                              <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 text-[10px] font-mono" title={comm.fraudFlag.reason}>
                                FLAGGED
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-slate-300">
                            <div>{comm.affiliateName}</div>
                            <span className="text-[10px] text-cyan-400 font-mono font-bold">({comm.affiliateCode})</span>
                          </td>
                          <td className="p-3 text-right text-slate-300">
                            KES {comm.saleAmountKes.toLocaleString()}
                          </td>
                          <td className="p-3 text-right text-slate-400">
                            {comm.commissionRate}%
                          </td>
                          <td className="p-3 text-right font-bold text-emerald-400">
                            KES {comm.commissionAmountKes.toLocaleString()}
                          </td>
                          <td className="p-3 text-right font-bold text-sky-300">
                            KES {(comm.grossCreatorRevenueKes || (comm.saleAmountKes - comm.commissionAmountKes)).toLocaleString()}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                              comm.status === 'verified' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                              comm.status === 'paid' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' :
                              comm.status === 'reversed' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                              'bg-amber-950 text-amber-400 border border-amber-800'
                            }`}>
                              {comm.status}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {comm.status === 'verified' && (
                              <button
                                onClick={async () => {
                                  const reason = prompt("Enter reversal reason (e.g. refund/fraud):");
                                  if (!reason) return;
                                  await api.updateAdminAffiliateCommissionStatus(comm.id, 'reversed', reason);
                                  loadSummary(true);
                                }}
                                className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-800 text-rose-300 text-[10px] font-mono cursor-pointer"
                              >
                                Reverse
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PAYOUTS */}
          {activeSubTab === 'payouts' && (
            <div className="space-y-4 animate-in fade-in">
              <h3 className="text-sm font-serif font-bold text-white">
                Affiliate Payout Requests Queue
              </h3>

              {(!summary?.payouts || summary.payouts.length === 0) ? (
                <div className="py-16 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                  No payout requests recorded.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Date</th>
                        <th className="p-3">Affiliate Partner</th>
                        <th className="p-3">Amount</th>
                        <th className="p-3">Disbursement Destination</th>
                        <th className="p-3">Reference / Safaricom Code</th>
                        <th className="p-3 text-center">Status</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {summary.payouts.map((payout) => (
                        <tr key={payout.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 text-slate-400 whitespace-nowrap">
                            {new Date(payout.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </td>
                          <td className="p-3 text-slate-200">
                            <div className="font-bold">{payout.affiliateName}</div>
                            <span className="text-[10px] text-cyan-400 font-mono font-semibold">({payout.affiliateCode})</span>
                          </td>
                          <td className="p-3 font-bold text-emerald-400 text-sm">
                            KES {payout.amountKes.toLocaleString()}
                          </td>
                          <td className="p-3 text-slate-300">
                            <span className="uppercase font-semibold text-[11px] text-cyan-300">{payout.payoutMethod}</span>
                            {payout.payoutDetails?.mpesaPhone && (
                              <div className="text-slate-400 text-[11px]">Phone: {payout.payoutDetails.mpesaPhone} ({payout.payoutDetails.mpesaName})</div>
                            )}
                            {payout.payoutDetails?.bankAccountNumber && (
                              <div className="text-slate-400 text-[11px]">{payout.payoutDetails.bankName} - {payout.payoutDetails.bankAccountNumber}</div>
                            )}
                          </td>
                          <td className="p-3 text-cyan-300">
                            {payout.paymentReference || <span className="text-slate-500">None</span>}
                          </td>
                          <td className="p-3 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                              payout.status === 'paid' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                              payout.status === 'approved' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' :
                              payout.status === 'rejected' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                              'bg-amber-950 text-amber-400 border border-amber-800'
                            }`}>
                              {payout.status}
                            </span>
                          </td>
                          <td className="p-3 text-right">
                            {payout.status === 'pending' && (
                              <button
                                onClick={() => {
                                  setShowPayoutProcessModal(payout);
                                  setPayoutAction('pay');
                                }}
                                className="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs cursor-pointer"
                              >
                                Disburse / Pay
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: CAMPAIGNS */}
          {activeSubTab === 'campaigns' && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-serif font-bold text-white">
                    Special Promotional Campaigns
                  </h3>
                  <p className="text-xs text-slate-400 font-sans">
                    Create custom commission rate campaigns for specific launches or seasons.
                  </p>
                </div>

                <button
                  onClick={() => setShowCreateCampaignModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Campaign</span>
                </button>
              </div>

              {(!summary?.campaigns || summary.campaigns.length === 0) ? (
                <div className="py-16 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                  No promotional campaigns created yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {summary.campaigns.map((camp) => (
                    <div key={camp.id} className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="px-2 py-0.5 rounded bg-cyan-950 border border-cyan-800 text-cyan-300 font-mono text-xs font-bold">
                          Tag: ?c={camp.code}
                        </span>
                        <button
                          onClick={() => handleDeleteCampaign(camp.id)}
                          className="p-1 text-slate-500 hover:text-rose-400"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div>
                        <h4 className="text-sm font-serif font-bold text-slate-100">{camp.name}</h4>
                        {camp.description && (
                          <p className="text-xs text-slate-400 font-sans mt-0.5">{camp.description}</p>
                        )}
                      </div>

                      <div className="p-3 rounded-lg bg-black/40 border border-slate-800 text-xs font-mono space-y-1">
                        <div className="flex justify-between text-slate-400">
                          <span>Commission Rate:</span>
                          <span className="text-emerald-400 font-bold">{camp.commissionRate}%</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Attribution Window:</span>
                          <span className="text-slate-200">{camp.attributionDays} days</span>
                        </div>
                        <div className="flex justify-between text-slate-400">
                          <span>Clicks / Sales:</span>
                          <span className="text-cyan-300">{camp.clicksCount || 0} clicks / {camp.salesCount || 0} sales</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: SETTINGS */}
          {activeSubTab === 'settings' && settingsForm && (
            <div className="max-w-2xl p-6 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5 animate-in fade-in">
              <div>
                <h3 className="text-base font-serif font-bold text-white">
                  Global Affiliate Program Configuration
                </h3>
                <p className="text-xs text-slate-400 font-sans mt-0.5">
                  Set program defaults, minimum payout thresholds, and self-registration rules.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">
                      Default Commission Rate (%)
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={90}
                      value={settingsForm.defaultCommissionRate}
                      onChange={(e) => setSettingsForm({ ...settingsForm, defaultCommissionRate: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">Applied to all standard monographs</p>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">
                      Minimum Payout Threshold (KES)
                    </label>
                    <input
                      type="number"
                      required
                      min={100}
                      value={settingsForm.minPayoutThresholdKes}
                      onChange={(e) => setSettingsForm({ ...settingsForm, minPayoutThresholdKes: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-cyan-300 font-mono font-bold focus:outline-none focus:border-cyan-500"
                    />
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">Minimum balance before payout request</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">
                      Attribution Cookie Window (Days)
                    </label>
                    <input
                      type="number"
                      required
                      min={1}
                      max={180}
                      value={settingsForm.defaultAttributionDays}
                      onChange={(e) => setSettingsForm({ ...settingsForm, defaultAttributionDays: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">
                      Auto-Approve Delay (Hours)
                    </label>
                    <input
                      type="number"
                      required
                      min={0}
                      max={168}
                      value={settingsForm.autoApproveDelayHours}
                      onChange={(e) => setSettingsForm({ ...settingsForm, autoApproveDelayHours: Number(e.target.value) })}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-2 border-t border-slate-800">
                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsForm.allowSelfRegistration}
                      onChange={(e) => setSettingsForm({ ...settingsForm, allowSelfRegistration: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                    />
                    <span>Allow readers to self-register as affiliates via the website footer</span>
                  </label>

                  <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settingsForm.allowTipsCommission}
                      onChange={(e) => setSettingsForm({ ...settingsForm, allowTipsCommission: e.target.checked })}
                      className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                    />
                    <span>Calculate commission on direct author reader tips (Default: Disabled)</span>
                  </label>
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {savingSettings ? 'Saving Settings...' : 'Save Program Rules'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 7: AUDIT LOG */}
          {activeSubTab === 'audit' && (
            <div className="space-y-4 animate-in fade-in">
              <h3 className="text-sm font-serif font-bold text-white">
                Affiliate Program Security &amp; Activity Audit Log
              </h3>

              {(!summary?.auditLogs || summary.auditLogs.length === 0) ? (
                <div className="py-16 text-center rounded-xl bg-slate-900/40 border border-slate-800 text-slate-400 text-xs">
                  No audit log entries recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="p-3">Timestamp</th>
                        <th className="p-3">Actor</th>
                        <th className="p-3">Action</th>
                        <th className="p-3">Target</th>
                        <th className="p-3">Summary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                      {summary.auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                          <td className="p-3 text-slate-400 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString('en-GB')}
                          </td>
                          <td className="p-3 text-cyan-300 font-bold">
                            {log.actor}
                          </td>
                          <td className="p-3 uppercase font-semibold text-slate-200">
                            {log.action}
                          </td>
                          <td className="p-3 text-slate-400 uppercase">
                            {log.targetType}
                          </td>
                          <td className="p-3 text-slate-300">
                            {log.summary}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* CREATE AFFILIATE MODAL */}
      {showCreateAffiliateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-[#0a0f1d] border border-cyan-700/80 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-serif font-bold text-white">Create New Affiliate Partner</h3>
              <button onClick={() => setShowCreateAffiliateModal(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAffiliate} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Full Name</label>
                <input
                  type="text"
                  required
                  value={newAffName}
                  onChange={(e) => setNewAffName(e.target.value)}
                  placeholder="e.g. Grace Wanjiku"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Email Address</label>
                <input
                  type="email"
                  required
                  value={newAffEmail}
                  onChange={(e) => setNewAffEmail(e.target.value)}
                  placeholder="grace@example.com"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={newAffPhone}
                    onChange={(e) => setNewAffPhone(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Custom Code</label>
                  <input
                    type="text"
                    value={newAffCode}
                    onChange={(e) => setNewAffCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="e.g. grace"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Commission Rate (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={newAffRate}
                      onChange={(e) => setNewAffRate(Number(e.target.value))}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Initial Password</label>
                    <input
                      type="password"
                      required
                      minLength={8}
                      maxLength={256}
                      autoComplete="new-password"
                      value={newAffPassword}
                      onChange={(e) => setNewAffPassword(e.target.value)}
                      placeholder="Create a secure password"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>
                <p className="text-[10px] font-sans text-slate-500">
                  Use 8+ characters with a letter and a number or special character.
                </p>
                {/* Rate Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {[10, 15, 18, 20, 25, 30].map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setNewAffRate(r)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                        newAffRate === r
                          ? 'bg-emerald-600 text-white font-bold'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-700'
                      }`}
                    >
                      {r}%{r === 15 ? ' (Default)' : ''}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateAffiliateModal(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-mono text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingAff}
                  className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {creatingAff ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT AFFILIATE & COMMISSION RATE TWEAKER MODAL */}
      {showEditAffiliateModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-lg bg-[#0a0f1d] border border-cyan-700/80 rounded-2xl p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-serif font-bold text-white flex items-center gap-2">
                  <span>Edit Partner Profile &amp; Commission Rate</span>
                </h3>
                <p className="text-[11px] font-mono text-cyan-400 mt-0.5">
                  Partner Code: {showEditAffiliateModal.affiliateCode}
                </p>
              </div>
              <button 
                onClick={() => setShowEditAffiliateModal(null)} 
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEditAffiliate} className="space-y-4">
              {/* COMMISSION RATE TWEAKER CARD */}
              <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-950/40 via-slate-900/60 to-emerald-950/30 border border-cyan-800/80 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emerald-400" />
                    <span className="text-xs font-mono font-bold text-slate-100">Individual Commission Rate</span>
                  </div>
                  <div className="text-[11px] font-mono">
                    {editAffIsCustomRate ? (
                      <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700 font-bold">
                        Custom Rate: {editAffRate}%
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                        Global Flatbed: {summary?.settings?.defaultCommissionRate || 15}%
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-[11px] text-slate-300 font-sans leading-relaxed">
                  The standard flatbed commission is <strong>15%</strong>. You can tweak and assign a custom commission percentage for this specific partner (e.g. 20%, 25%, or custom). All future sales through their unique referral links will automatically credit at this rate.
                </p>

                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs font-mono text-slate-200 cursor-pointer">
                      <input
                        type="radio"
                        name="commissionMode"
                        checked={!editAffIsCustomRate}
                        onChange={() => setEditAffIsCustomRate(false)}
                        className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                      />
                      <span>Use Flatbed Default (15%)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs font-mono text-slate-200 cursor-pointer">
                      <input
                        type="radio"
                        name="commissionMode"
                        checked={editAffIsCustomRate}
                        onChange={() => setEditAffIsCustomRate(true)}
                        className="rounded border-slate-700 bg-slate-950 text-cyan-500"
                      />
                      <span className="text-emerald-300 font-semibold">Tweak Custom Percentage</span>
                    </label>
                  </div>

                  {editAffIsCustomRate && (
                    <div className="space-y-2 pt-2 animate-in fade-in">
                      <div className="flex items-center gap-3">
                        <div className="relative flex-1">
                          <input
                            type="number"
                            min={1}
                            max={90}
                            step={0.5}
                            value={editAffRate}
                            onChange={(e) => setEditAffRate(Number(e.target.value))}
                            className="w-full bg-slate-950 border border-emerald-600/80 rounded-xl px-4 py-2 text-sm text-emerald-300 font-mono font-bold focus:outline-none focus:border-emerald-400"
                            placeholder="e.g. 20"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400 font-mono font-bold text-xs">
                            % Commission
                          </span>
                        </div>

                        {/* Interactive simulation box */}
                        <div className="p-2.5 rounded-xl bg-black/60 border border-slate-800 text-[11px] font-mono text-slate-300 shrink-0">
                          <span className="text-slate-500 block text-[9px] uppercase">Example (KES 500 Sale)</span>
                          <span className="text-emerald-400 font-bold text-xs">
                            KES {((500 * (editAffRate || 0)) / 100).toFixed(0)}
                          </span>{' '}
                          <span className="text-slate-400">earned</span>
                        </div>
                      </div>

                      {/* Quick Presets */}
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        <span className="text-[10px] font-mono text-slate-400 mr-1">Quick Presets:</span>
                        {[10, 12, 15, 18, 20, 22, 25, 30, 35, 40].map(preset => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => {
                              setEditAffIsCustomRate(true);
                              setEditAffRate(preset);
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-all cursor-pointer ${
                              editAffIsCustomRate && editAffRate === preset
                                ? 'bg-emerald-600 text-white font-bold shadow-sm'
                                : 'bg-slate-800/90 text-slate-300 hover:text-white hover:bg-slate-700'
                            }`}
                          >
                            {preset}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* PARTNER BASIC DETAILS */}
              <div className="space-y-3 pt-1">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Partner Full Name</label>
                  <input
                    type="text"
                    required
                    value={editAffName}
                    onChange={(e) => setEditAffName(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      value={editAffEmail}
                      onChange={(e) => setEditAffEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Phone Number (M-Pesa)</label>
                    <input
                      type="text"
                      value={editAffPhone}
                      onChange={(e) => setEditAffPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Account Status</label>
                    <select
                      value={editAffStatus}
                      onChange={(e) => setEditAffStatus(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-cyan-500"
                    >
                      <option value="active">Active (Links Functional)</option>
                      <option value="suspended">Suspended</option>
                      <option value="pending">Pending Review</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-mono text-slate-300 mb-1">Referral Links Control</label>
                    <label className="flex items-center gap-2 h-9 px-3 rounded-lg bg-slate-950 border border-slate-700 cursor-pointer text-xs font-mono text-slate-300">
                      <input
                        type="checkbox"
                        checked={editAffLinksDisabled}
                        onChange={(e) => setEditAffLinksDisabled(e.target.checked)}
                        className="rounded border-slate-700 bg-slate-900 text-rose-500"
                      />
                      <span className={editAffLinksDisabled ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                        {editAffLinksDisabled ? 'Links Disabled (Killswitch)' : 'Links Enabled (Active)'}
                      </span>
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Author / Admin Private Notes</label>
                  <input
                    type="text"
                    value={editAffNotes}
                    onChange={(e) => setEditAffNotes(e.target.value)}
                    placeholder="e.g. VIP Bookstagrammer, agreed 20% commission on literary monographs"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              {/* ACTION BUTTONS */}
              <div className="pt-3 border-t border-slate-800 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowEditAffiliateModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingEditAff}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-mono text-xs font-semibold shadow-lg shadow-cyan-950/40 cursor-pointer transition-all disabled:opacity-50"
                >
                  {savingEditAff ? 'Saving Changes...' : 'Save Partner & Commission Rate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PROCESS PAYOUT MODAL */}
      {showPayoutProcessModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-[#0a0f1d] border border-emerald-700/80 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-serif font-bold text-white">
                Disburse Affiliate Payout
              </h3>
              <button onClick={() => setShowPayoutProcessModal(null)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-black/50 border border-slate-800 text-xs font-mono space-y-1">
              <div className="flex justify-between text-slate-400">
                <span>Affiliate Partner:</span>
                <span className="text-white font-bold">{showPayoutProcessModal.affiliateName} ({showPayoutProcessModal.affiliateCode})</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Requested Amount:</span>
                <span className="text-emerald-400 font-bold text-sm">KES {showPayoutProcessModal.amountKes.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Method:</span>
                <span className="text-cyan-300 uppercase font-semibold">{showPayoutProcessModal.payoutMethod}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Recipient Details:</span>
                <span className="text-slate-200">
                  {showPayoutProcessModal.payoutDetails?.mpesaPhone || showPayoutProcessModal.payoutDetails?.bankAccountNumber || 'Provided in details'}
                </span>
              </div>
            </div>

            <form onSubmit={handleProcessPayout} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Action</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPayoutAction('pay')}
                    className={`py-2 rounded-xl border text-xs font-mono font-bold ${
                      payoutAction === 'pay' ? 'bg-emerald-950 border-emerald-600 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Confirm Paid
                  </button>
                  <button
                    type="button"
                    onClick={() => setPayoutAction('reject')}
                    className={`py-2 rounded-xl border text-xs font-mono font-bold ${
                      payoutAction === 'reject' ? 'bg-rose-950 border-rose-600 text-rose-300' : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    Reject Request
                  </button>
                </div>
              </div>

              {payoutAction === 'pay' && (
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Safaricom B2C Code / Bank Reference Number
                  </label>
                  <input
                    type="text"
                    required
                    value={payoutRef}
                    onChange={(e) => setPayoutRef(e.target.value)}
                    placeholder="e.g. QK82910482"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Author Notes (Optional)</label>
                <input
                  type="text"
                  value={payoutNotes}
                  onChange={(e) => setPayoutNotes(e.target.value)}
                  placeholder="e.g. Sent via M-Pesa B2C"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPayoutProcessModal(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-mono text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processingPayout}
                  className={`flex-1 py-2 rounded-xl text-slate-950 font-mono font-bold text-xs cursor-pointer disabled:opacity-50 ${
                    payoutAction === 'pay' ? 'bg-emerald-500 hover:bg-emerald-400' : 'bg-rose-500 hover:bg-rose-400 text-white'
                  }`}
                >
                  {processingPayout ? 'Processing...' : payoutAction === 'pay' ? 'Confirm Disbursement' : 'Reject Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CREATE CAMPAIGN MODAL */}
      {showCreateCampaignModal && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
          <div className="w-full max-w-md bg-[#0a0f1d] border border-cyan-700/80 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-serif font-bold text-white">Create Promotional Campaign</h3>
              <button onClick={() => setShowCreateCampaignModal(false)} className="p-1 text-slate-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveCampaign} className="space-y-3">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Campaign Code (URL Tag)</label>
                <input
                  type="text"
                  required
                  value={campCode}
                  onChange={(e) => setCampCode(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                  placeholder="e.g. twitter_promo or summer_drop"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-cyan-300 font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Campaign Name</label>
                <input
                  type="text"
                  required
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                  placeholder="e.g. Critical Essays Autumn Push"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1">Description</label>
                <input
                  type="text"
                  value={campDesc}
                  onChange={(e) => setCampDesc(e.target.value)}
                  placeholder="Targeting Twitter literary circles"
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-100 font-sans focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Commission Rate (%)</label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={campRate}
                    onChange={(e) => setCampRate(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-emerald-400 font-mono font-bold focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">Attribution (Days)</label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={campDays}
                    onChange={(e) => setCampDays(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-cyan-500"
                  />
                </div>
              </div>

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowCreateCampaignModal(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-mono text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCamp}
                  className="flex-1 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {savingCamp ? 'Saving...' : 'Create Campaign'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

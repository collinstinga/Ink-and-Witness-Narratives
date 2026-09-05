import React, { useState, useEffect } from 'react';
import {
  X, 
  Share2, 
  Copy, 
  Check, 
  ExternalLink, 
  DollarSign, 
  TrendingUp, 
  Users, 
  ShoppingBag, 
  Wallet, 
  ArrowUpRight, 
  RefreshCw, 
  LogOut, 
  ShieldCheck, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  Filter, 
  Search, 
  Sparkles, 
  QrCode, 
  Smartphone, 
  Building2, 
  CreditCard, 
  Lock, 
  BookOpen, 
  Send,
  HelpCircle,
  Eye,
  FileText,
  Scale,
  Coins,
  Volume2,
  BellRing
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { 
  AffiliateAccount, 
  AffiliateDashboardData, 
  AffiliateSaleCommission, 
  AffiliatePayoutRequest, 
  Article,
  AffiliateCampaign
} from '../../types.js';
import { api, clearAffiliateToken } from '../../utils/api.js';
import { playCoinDropSound } from '../../utils/coinSound.js';
import { AffiliateTermsViewer } from './AffiliateTermsViewer.js';
import { AFFILIATE_TERMS_CHECKBOXES, AFFILIATE_TERMS_VERSION } from '../../data/affiliateTerms.js';
import { validateAffiliatePasswordForInput } from '../../utils/affiliatePasswordPolicy.js';

interface AffiliateDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: Article[];
  onLogout: () => void;
}

type TabType = 'overview' | 'links' | 'sales' | 'payouts' | 'settings';

export const AffiliateDashboardModal: React.FC<AffiliateDashboardModalProps> = ({
  isOpen,
  onClose,
  articles,
  onLogout
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [data, setData] = useState<AffiliateDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Terms acceptance for existing affiliates who haven't accepted yet
  const [termsChecked, setTermsChecked] = useState<Record<string, boolean>>({});
  const [submittingTerms, setSubmittingTerms] = useState(false);
  const [termsError, setTermsError] = useState('');
  const [termsSuccess, setTermsSuccess] = useState('');

  // Link Builder state
  const [selectedPieceId, setSelectedPieceId] = useState<string>('');
  const [campaignTag, setCampaignTag] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [showQrCode, setShowQrCode] = useState(false);

  // Payout request modal/form state
  const [showPayoutModal, setShowPayoutModal] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [payoutNotes, setPayoutNotes] = useState('');
  const [submittingPayout, setSubmittingPayout] = useState(false);
  const [payoutSuccessMsg, setPayoutSuccessMsg] = useState('');
  const [payoutErrorMsg, setPayoutErrorMsg] = useState('');

  // Profile Settings state
  const [profileName, setProfileName] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const [profilePayoutMethod, setProfilePayoutMethod] = useState<'mpesa' | 'bank' | 'paypal'>('mpesa');
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaName, setMpesaName] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [paypalEmail, setPaypalEmail] = useState('');
  const [updatingProfile, setUpdatingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');

  // Password Change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [updatingPassword, setUpdatingPassword] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Sales Ledger filter
  const [salesSearch, setSalesSearch] = useState('');
  const [salesStatusFilter, setSalesStatusFilter] = useState('ALL');

  // Real-time sale notification & 1-second coin drop sound
  const previousSalesCountRef = React.useRef<number | null>(null);
  const knownSaleIdsRef = React.useRef<Set<string>>(new Set());
  const [newSaleAlert, setNewSaleAlert] = useState<{
    show: boolean;
    articleTitle: string;
    commissionAmountKes: number;
    receiptNumber: string;
    timestamp: string;
    isTest?: boolean;
  } | null>(null);

  const handleToggleTerm = (id: string) => {
    setTermsChecked(prev => ({
      ...prev,
      [id]: !prev[id]
    }));
  };

  const handleCheckAllTerms = () => {
    const allChecked = AFFILIATE_TERMS_CHECKBOXES.every(c => !!termsChecked[c.id]);
    if (allChecked) {
      setTermsChecked({});
    } else {
      const all: Record<string, boolean> = {};
      AFFILIATE_TERMS_CHECKBOXES.forEach(c => {
        all[c.id] = true;
      });
      setTermsChecked(all);
    }
  };

  const allTermsAccepted = AFFILIATE_TERMS_CHECKBOXES.every(c => !!termsChecked[c.id]);

  const handleAcceptDashboardTerms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!allTermsAccepted) {
      setTermsError('You must review and check all 9 required terms before proceeding.');
      return;
    }

    setSubmittingTerms(true);
    setTermsError('');
    try {
      const res = await api.acceptAffiliateTerms({ termsVersion: AFFILIATE_TERMS_VERSION });
      if (res.success) {
        setTermsSuccess('Terms accepted successfully! Your dashboard is now fully unlocked.');
        confetti({
          particleCount: 50,
          spread: 60,
          origin: { y: 0.6 }
        });
        if (res.dashboard) {
          setData(res.dashboard);
        } else {
          loadDashboard();
        }
      }
    } catch (err: any) {
      setTermsError(err.message || 'Failed to accept terms.');
    } finally {
      setSubmittingTerms(false);
    }
  };

  const loadDashboard = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');

    try {
      const res = await api.getAffiliateDashboard();
      setData(res);

      // Detect new sales in real-time and trigger 1-second coin drop notification
      if (res && Array.isArray(res.sales)) {
        const currentSales = res.sales;
        if (previousSalesCountRef.current !== null && currentSales.length > previousSalesCountRef.current) {
          const newSales = currentSales.filter(s => !knownSaleIdsRef.current.has(s.id || (s as any).transactionId));
          if (newSales.length > 0) {
            const latest = newSales[0];
            // Play 1-second coin drop and chime sound effect
            playCoinDropSound(0.85);
            try {
              confetti({ particleCount: 85, spread: 75, origin: { y: 0.35 } });
            } catch {}
            setNewSaleAlert({
              show: true,
              articleTitle: latest.articleTitle || 'Monograph Sale',
              commissionAmountKes: latest.commissionAmountKes || 0,
              receiptNumber: latest.receiptNumber || 'M-Pesa Verified',
              timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            });
            setTimeout(() => {
              setNewSaleAlert(prev => prev?.receiptNumber === (latest.receiptNumber || 'M-Pesa Verified') ? null : prev);
            }, 8000);
          }
        }
        previousSalesCountRef.current = currentSales.length;
        knownSaleIdsRef.current = new Set(currentSales.map(s => s.id || (s as any).transactionId));
      }
      
      // Initialize profile form values
      if (res.affiliate) {
        setProfileName(res.affiliate.name || '');
        setProfilePhone(res.affiliate.phone || '');
        setProfilePayoutMethod(res.affiliate.payoutMethod || 'mpesa');
        if (res.affiliate.payoutDetails) {
          setMpesaPhone(res.affiliate.payoutDetails.mpesaPhone || res.affiliate.phone || '');
          setMpesaName(res.affiliate.payoutDetails.mpesaName || res.affiliate.name || '');
          setBankName(res.affiliate.payoutDetails.bankName || '');
          setBankAccountName(res.affiliate.payoutDetails.bankAccountName || '');
          setBankAccountNumber(res.affiliate.payoutDetails.bankAccountNumber || '');
          setBankBranch(res.affiliate.payoutDetails.bankBranch || '');
          setPaypalEmail(res.affiliate.payoutDetails.paypalEmail || res.affiliate.email || '');
        }
        setPayoutAmount(res.availableBalanceKes || 0);
      }
    } catch (err: any) {
      if (err.message && err.message.includes('expired')) {
        onLogout();
      } else {
        setError(err.message || 'Failed to load affiliate dashboard');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleTestCoinDrop = () => {
    // 1-second bright golden coin drop audio
    playCoinDropSound(0.85);
    try {
      confetti({ particleCount: 65, spread: 70, origin: { y: 0.35 } });
    } catch {}
    const sampleRate = (data?.affiliate as any)?.commissionRate || (data?.affiliate as any)?.customCommissionRate || data?.settings?.defaultCommissionRate || 15;
    const sampleCommission = Math.round((500 * sampleRate) / 100);
    setNewSaleAlert({
      show: true,
      articleTitle: 'Demonstration Monograph Sale',
      commissionAmountKes: sampleCommission,
      receiptNumber: 'TEST-SIMULATION',
      timestamp: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      isTest: true
    });
    setTimeout(() => {
      setNewSaleAlert(prev => prev?.receiptNumber === 'TEST-SIMULATION' ? null : prev);
    }, 6000);
  };

  useEffect(() => {
    if (isOpen) {
      loadDashboard();
      const refreshTimer = setInterval(() => {
        loadDashboard(true);
      }, 15000);
      return () => clearInterval(refreshTimer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const affiliate = data?.affiliate;
  const affiliateCode = affiliate?.affiliateCode || 'partner';
  const commissionRate = affiliate?.commissionRate || data?.settings?.defaultCommissionRate || 15;
  const availableBalance = data?.availableBalanceKes || 0;
  const minThreshold = data?.minPayoutThresholdKes || data?.settings?.minPayoutThresholdKes || 1000;
  const canRequestPayout = availableBalance >= minThreshold;

  // Generate Referral Link in format: https://YOUR-DOMAIN/r/AFFILIATECODE?article=ARTICLE_ID&c=CAMPAIGN_CODE
  const getBaseOrigin = () => {
    if (typeof window !== 'undefined') return window.location.origin;
    return 'https://inkandwitness.com';
  };

  const generateReferralUrl = (pieceId?: string, campaign?: string) => {
    const origin = getBaseOrigin();
    const params = new URLSearchParams();
    if (pieceId && pieceId.trim()) {
      params.set('article', pieceId.trim());
    }
    if (campaign && campaign.trim()) {
      params.set('c', campaign.trim().toLowerCase());
    }
    const qs = params.toString();
    return `${origin}/r/${encodeURIComponent(affiliateCode)}${qs ? `?${qs}` : ''}`;
  };

  const currentGeneratedLink = generateReferralUrl(selectedPieceId, campaignTag);

  const handleCopyLink = (urlToCopy: string) => {
    navigator.clipboard.writeText(urlToCopy);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleRequestPayoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (payoutAmount <= 0) {
      setPayoutErrorMsg('Please specify a valid payout amount.');
      return;
    }
    if (payoutAmount > availableBalance) {
      setPayoutErrorMsg(`Payout amount cannot exceed your available balance of KES ${availableBalance.toLocaleString()}.`);
      return;
    }
    if (payoutAmount < minThreshold) {
      setPayoutErrorMsg(`Minimum payout threshold is KES ${minThreshold.toLocaleString()}.`);
      return;
    }

    setSubmittingPayout(true);
    setPayoutErrorMsg('');
    setPayoutSuccessMsg('');

    try {
      const payoutDetails = {
        mpesaPhone: mpesaPhone || affiliate?.phone,
        mpesaName: mpesaName || affiliate?.name,
        bankName,
        bankAccountName,
        bankAccountNumber,
        bankBranch,
        paypalEmail: paypalEmail || affiliate?.email
      };

      const res = await api.requestAffiliatePayout({
        amount: payoutAmount,
        payoutMethod: profilePayoutMethod,
        payoutDetails,
        notes: payoutNotes.trim() || undefined
      });

      if (res.success) {
        setPayoutSuccessMsg(`Payout request of KES ${payoutAmount.toLocaleString()} submitted! Jake's desk will process it shortly.`);
        confetti({ particleCount: 70, spread: 60, origin: { y: 0.6 } });
        setTimeout(() => {
          setShowPayoutModal(false);
          setPayoutSuccessMsg('');
          loadDashboard(true);
        }, 1500);
      }
    } catch (err: any) {
      setPayoutErrorMsg(err.message || 'Failed to submit payout request.');
    } finally {
      setSubmittingPayout(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingProfile(true);
    setProfileMsg('');

    try {
      const res = await api.updateAffiliateProfile({
        name: profileName.trim(),
        phone: profilePhone.trim(),
        payoutMethod: profilePayoutMethod,
        payoutDetails: {
          mpesaPhone: mpesaPhone.trim() || profilePhone.trim(),
          mpesaName: mpesaName.trim() || profileName.trim(),
          bankName: bankName.trim(),
          bankAccountName: bankAccountName.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankBranch: bankBranch.trim(),
          paypalEmail: paypalEmail.trim()
        }
      });

      if (res.success) {
        setProfileMsg('Profile and payout preferences updated successfully!');
        loadDashboard(true);
        setTimeout(() => setProfileMsg(''), 3000);
      }
    } catch (err: any) {
      setProfileMsg(`Error: ${err.message || 'Failed to update profile'}`);
    } finally {
      setUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword) {
      setPasswordError('Please fill in both current and new password.');
      return;
    }
    const validationError = validateAffiliatePasswordForInput(newPassword, 'New password');
    if (validationError) {
      setPasswordError(validationError);
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setUpdatingPassword(true);
    setPasswordError('');
    setPasswordMsg('');

    try {
      const res = await api.changeAffiliatePassword({
        currentPassword,
        newPassword
      });

      if (res.success) {
        setPasswordMsg('Password changed successfully!');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        setTimeout(() => setPasswordMsg(''), 3000);
      }
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password');
    } finally {
      setUpdatingPassword(false);
    }
  };

  // Filter sales
  const filteredSales = (data?.sales || []).filter((sale) => {
    const matchesSearch = 
      sale.articleTitle.toLowerCase().includes(salesSearch.toLowerCase()) ||
      sale.receiptNumber.toLowerCase().includes(salesSearch.toLowerCase()) ||
      sale.id.toLowerCase().includes(salesSearch.toLowerCase());
    
    const matchesStatus = salesStatusFilter === 'ALL' || sale.status.toLowerCase() === salesStatusFilter.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  return (
    <div 
      id="affiliate-dashboard-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div 
        id="affiliate-dashboard-modal-content"
        className="relative w-full max-w-5xl bg-[#080d1a] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-[#0d1629] to-slate-900 p-5 sm:p-6 border-b border-slate-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-inner shrink-0">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg sm:text-xl font-serif font-bold text-white tracking-wide">
                  {affiliate?.name || 'Affiliate Partner'}
                </h1>
                <span className="px-2 py-0.5 rounded-md bg-cyan-950 border border-cyan-700/80 text-cyan-300 font-mono text-[11px] font-semibold">
                  CODE: {affiliateCode}
                </span>
                <span className={`px-2 py-0.5 rounded-md font-mono text-[10px] font-semibold uppercase ${
                  affiliate?.status === 'active' 
                    ? 'bg-emerald-950 border border-emerald-700 text-emerald-400' 
                    : affiliate?.status === 'suspended'
                    ? 'bg-rose-950 border border-rose-700 text-rose-400'
                    : 'bg-amber-950 border border-amber-700 text-amber-400'
                }`}>
                  {affiliate?.status || 'Active'}
                </span>
                {affiliate?.customCommissionRate ? (
                  <span className="px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-600/80 text-emerald-300 font-mono text-[10px] font-bold flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-emerald-400" />
                    Custom {affiliate.customCommissionRate}% Rate
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                    15% Flatbed Rate
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                Commission Rate: <strong className="text-emerald-400 font-bold">{commissionRate}%</strong> per verified monograph purchase • Attribution: {data?.settings?.attributionDays || 30} Days
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center flex-wrap">
            <button
              onClick={handleTestCoinDrop}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-950/40 hover:bg-amber-900/60 border border-amber-700/60 text-amber-300 hover:text-white text-xs font-mono transition-all cursor-pointer shadow-sm"
              title="Test the 1-second coin drop notification sound"
            >
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              <span>Test Coin Sound</span>
            </button>

            <button
              id="affiliate-refresh-btn"
              onClick={() => loadDashboard(true)}
              disabled={refreshing}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh Analytics"
            >
              <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {affiliate?.acceptedTerms !== false && (
              <button
                id="affiliate-quick-copy-default-btn"
                onClick={() => handleCopyLink(generateReferralUrl())}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/80 text-cyan-300 hover:text-white text-xs font-mono transition-all cursor-pointer shadow-sm"
                title="Copy Default Homepage Referral Link"
              >
                {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedLink ? 'Copied Link!' : 'Copy My Link'}</span>
              </button>
            )}

            <button
              id="affiliate-logout-btn"
              onClick={onLogout}
              className="p-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white transition-colors cursor-pointer"
              title="Sign Out of Affiliate Portal"
            >
              <LogOut className="w-4 h-4" />
            </button>

            <button
              id="affiliate-modal-close-btn"
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer ml-1"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* REAL-TIME 1-SECOND COIN DROP CELEBRATION TOAST */}
        {newSaleAlert && newSaleAlert.show && (
          <div className="mx-4 my-3 p-3.5 rounded-xl bg-gradient-to-r from-amber-950/90 via-yellow-950/80 to-amber-900/90 border-2 border-amber-400/90 shadow-2xl shadow-amber-900/50 flex items-center justify-between gap-3 animate-in slide-in-from-top duration-300">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-amber-400/20 border border-amber-400/60 flex items-center justify-center shrink-0 animate-bounce">
                <Coins className="w-5 h-5 text-amber-300" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold uppercase tracking-wider text-amber-300 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                    {newSaleAlert.isTest ? 'Audio Preview: 1-Second Coin Drop' : 'New Referral Sale Confirmed!'}
                  </span>
                  <span className="text-[10px] font-mono text-amber-200/80 bg-amber-950/80 px-2 py-0.5 rounded border border-amber-600/60">
                    {newSaleAlert.timestamp}
                  </span>
                </div>
                <p className="text-xs text-amber-100 font-sans mt-0.5">
                  Commission earned on <strong>"{newSaleAlert.articleTitle}"</strong>: <span className="font-mono font-bold text-amber-300 text-sm underline decoration-amber-400">+KES {newSaleAlert.commissionAmountKes.toLocaleString()}</span>
                  {newSaleAlert.receiptNumber && <span className="text-[11px] font-mono text-amber-200/70 ml-2">({newSaleAlert.receiptNumber})</span>}
                </p>
              </div>
            </div>
            <button
              onClick={() => setNewSaleAlert(null)}
              className="p-1 rounded-lg text-amber-300/80 hover:text-white hover:bg-amber-900/60 cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Tabs (Only accessible if terms are accepted) */}
        {affiliate?.acceptedTerms !== false && (
          <div className="bg-slate-900/90 border-b border-slate-800 px-5 flex items-center gap-2 overflow-x-auto custom-scrollbar shrink-0">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-3 px-3.5 font-mono text-xs font-semibold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'overview'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              <span>Overview &amp; Stats</span>
            </button>

            <button
              onClick={() => setActiveTab('links')}
              className={`py-3 px-3.5 font-mono text-xs font-semibold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'links'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Share2 className="w-3.5 h-3.5" />
              <span>Link &amp; Campaign Generator</span>
            </button>

            <button
              onClick={() => setActiveTab('sales')}
              className={`py-3 px-3.5 font-mono text-xs font-semibold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'sales'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Sales Ledger ({data?.sales?.length || 0})</span>
            </button>

            <button
              onClick={() => setActiveTab('payouts')}
              className={`py-3 px-3.5 font-mono text-xs font-semibold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'payouts'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>Payouts &amp; Balance</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`py-3 px-3.5 font-mono text-xs font-semibold border-b-2 transition-all whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
                activeTab === 'settings'
                  ? 'border-cyan-400 text-cyan-300 bg-cyan-950/20'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Payout Settings &amp; Security</span>
            </button>
          </div>
        )}

        {/* Tab Content Container */}
        <div className="p-5 sm:p-6 overflow-y-auto custom-scrollbar flex-1 bg-[#080d1a]">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400 font-mono text-xs">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
              <span>Loading your private affiliate analytics...</span>
            </div>
          ) : error ? (
            <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-sans flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400" />
                <span>{error}</span>
              </div>
              <button
                onClick={() => loadDashboard()}
                className="px-3 py-1 bg-rose-900 hover:bg-rose-800 rounded-lg text-white font-mono text-xs"
              >
                Retry
              </button>
            </div>
          ) : affiliate && affiliate.acceptedTerms === false ? (
            /* BLOCKING MODAL: Existing Affiliate Must Fill T&Cs Before Dashboard Operates */
            <div className="max-w-2xl mx-auto py-4 space-y-5 animate-in fade-in">
              <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/50 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-mono font-bold text-amber-300">
                    Action Required: Affiliate Programme Terms &amp; Conditions Update
                  </h3>
                  <p className="text-xs text-slate-300 font-sans mt-1 leading-relaxed">
                    Hello <strong className="text-white">{affiliate.name}</strong>. To continue active participation in the Ink &amp; Witness Affiliate Programme and access your referral links, sales ledger, and payouts, please review and accept our updated Terms &amp; Conditions below.
                  </p>
                </div>
              </div>

              {termsError && (
                <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-300 text-xs font-sans flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <span>{termsError}</span>
                </div>
              )}

              {termsSuccess && (
                <div className="p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/80 text-emerald-300 text-xs font-sans flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <span>{termsSuccess}</span>
                </div>
              )}

              <form onSubmit={handleAcceptDashboardTerms} className="space-y-4">
                <AffiliateTermsViewer
                  checkedMap={termsChecked}
                  onToggleCheck={handleToggleTerm}
                  onCheckAll={handleCheckAllTerms}
                  isDashboardModal={true}
                />

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submittingTerms || !allTermsAccepted}
                    className={`w-full py-3.5 px-4 rounded-xl font-mono text-xs font-semibold tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                      allTermsAccepted
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-60'
                    }`}
                  >
                    {submittingTerms ? (
                      <span>Recording Terms Acceptance...</span>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>{allTermsAccepted ? 'I Accept Terms & Unlock My Dashboard' : 'Review & Check All 9 Terms to Unlock Dashboard'}</span>
                      </>
                    )}
                  </button>
                  {!allTermsAccepted && (
                    <p className="text-[11px] font-mono text-amber-400/90 text-center mt-2">
                      * All 9 required checkboxes must be checked to re-activate your affiliate portal.
                    </p>
                  )}
                </div>
              </form>
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6 animate-in fade-in">
                  {/* KPI Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
                    {/* Clicks */}
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-mono">Total Clicks</span>
                        <Users className="w-4 h-4 text-cyan-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-slate-100">
                        {data?.clicks?.toLocaleString() || 0}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        {data?.uniqueVisitors || 0} unique visitors
                      </p>
                    </div>

                    {/* Sales Count */}
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-mono">Paid Sales</span>
                        <ShoppingBag className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-slate-100">
                        {data?.totalConfirmedSales || 0}
                      </p>
                      <p className="text-[10px] text-emerald-400 font-mono mt-0.5">
                        {data?.clicks ? ((data.totalConfirmedSales / data.clicks) * 100).toFixed(1) : 0}% conv. rate
                      </p>
                    </div>

                    {/* Revenue Generated */}
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-mono">Gross Sales</span>
                        <DollarSign className="w-4 h-4 text-sky-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-sky-300">
                        KES {(data?.totalRevenueGeneratedKes || 0).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Generated for author
                      </p>
                    </div>

                    {/* Earned Commission */}
                    <div className="p-4 rounded-xl bg-emerald-950/40 border border-emerald-800/60">
                      <div className="flex items-center justify-between text-emerald-300 mb-1">
                        <span className="text-[11px] font-mono">Total Earned</span>
                        <Sparkles className="w-4 h-4 text-emerald-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-emerald-400">
                        KES {(data?.commissionEarnedKes || 0).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-emerald-500 font-mono mt-0.5">
                        {commissionRate}% commission
                      </p>
                    </div>

                    {/* Available for Payout */}
                    <div className="p-4 rounded-xl bg-cyan-950/40 border border-cyan-800/60">
                      <div className="flex items-center justify-between text-cyan-300 mb-1">
                        <span className="text-[11px] font-mono">Available Balance</span>
                        <Wallet className="w-4 h-4 text-cyan-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-cyan-300">
                        KES {availableBalance.toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                        Min. KES {minThreshold.toLocaleString()}
                      </p>
                    </div>

                    {/* Paid Out */}
                    <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800/80">
                      <div className="flex items-center justify-between text-slate-400 mb-1">
                        <span className="text-[11px] font-mono">Paid Out</span>
                        <CheckCircle2 className="w-4 h-4 text-slate-400" />
                      </div>
                      <p className="text-xl sm:text-2xl font-bold font-mono text-slate-300">
                        KES {(data?.commissionPaidKes || 0).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                        Disbursed to date
                      </p>
                    </div>
                  </div>

                  {/* Primary Link Card */}
                  <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-cyan-950/30 to-slate-900 border border-cyan-700/50 shadow-lg">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <span className="text-[10px] font-mono uppercase tracking-widest text-cyan-400 font-bold">
                          Your Active Referral Link
                        </span>
                        <h3 className="text-base font-serif font-bold text-white mt-0.5">
                          Share this link anywhere readers congregate
                        </h3>
                        <p className="text-xs text-slate-300 mt-1 max-w-xl">
                          Anyone who visits via this link receives a 30-day attribution cookie. When they purchase any monograph, your {commissionRate}% commission is automatically logged in real-time.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleCopyLink(generateReferralUrl())}
                          className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-2 transition-all shadow-md cursor-pointer"
                        >
                          {copiedLink ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                          <span>{copiedLink ? 'Copied to Clipboard!' : 'Copy Default Link'}</span>
                        </button>
                        <button
                          onClick={() => setActiveTab('links')}
                          className="px-3 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <span>Custom Piece Links</span>
                          <ArrowUpRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-3 p-3 rounded-xl bg-black/60 border border-slate-800 flex items-center justify-between gap-3">
                      <code className="text-xs font-mono text-cyan-300 break-all select-all">
                        {generateReferralUrl()}
                      </code>
                    </div>
                  </div>

                  {/* Payout Banner if ready */}
                  {canRequestPayout && (
                    <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                          <Wallet className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-mono font-semibold text-emerald-300">
                            Available Balance Ready for Payout: KES {availableBalance.toLocaleString()}
                          </p>
                          <p className="text-[11px] text-emerald-400/80">
                            You have met the minimum threshold of KES {minThreshold.toLocaleString()}.
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setPayoutAmount(availableBalance);
                          setShowPayoutModal(true);
                        }}
                        className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs transition-all shadow-md cursor-pointer shrink-0"
                      >
                        Request Payout Now
                      </button>
                    </div>
                  )}

                  {/* Recent Sales Preview */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-serif font-bold text-slate-200">
                        Recent Verified Referral Sales
                      </h4>
                      <button
                        onClick={() => setActiveTab('sales')}
                        className="text-xs font-mono text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                      >
                        <span>View All Sales Ledger ({data?.sales?.length || 0})</span>
                        <ArrowUpRight className="w-3 h-3" />
                      </button>
                    </div>

                    {(!data?.sales || data.sales.length === 0) ? (
                      <div className="py-10 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 text-slate-400 font-sans text-xs">
                        <ShoppingBag className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                        <p className="font-semibold text-slate-300">No referral sales logged yet</p>
                        <p className="text-slate-500 max-w-sm mx-auto mt-1">
                          Share your referral link on Twitter/X, WhatsApp groups, newsletters, or book clubs to start earning commissions!
                        </p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {data.sales.slice(0, 3).map((sale) => (
                          <div key={sale.id} className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-2">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-[10px] font-mono text-slate-500">
                                {new Date(sale.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                                sale.status === 'verified' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                                sale.status === 'paid' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' :
                                sale.status === 'reversed' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                                'bg-amber-950 text-amber-400 border border-amber-800'
                              }`}>
                                {sale.status}
                              </span>
                            </div>

                            <p className="text-xs font-serif font-bold text-slate-100 line-clamp-1">
                              {sale.articleTitle}
                            </p>

                            <div className="flex items-center justify-between text-xs font-mono pt-1 border-t border-slate-800/80">
                              <span className="text-slate-400">Earned:</span>
                              <span className="font-bold text-emerald-400">KES {sale.commissionAmountKes.toLocaleString()} ({sale.commissionRate}%)</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 2: LINK & CAMPAIGN GENERATOR */}
              {activeTab === 'links' && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-5">
                    <div>
                      <h3 className="text-base font-serif font-bold text-white">
                        Custom Link &amp; Campaign Generator
                      </h3>
                      <p className="text-xs text-slate-400 font-sans mt-0.5">
                        Create targeted links for specific monographs, Twitter threads, WhatsApp broadcasts, or email newsletters.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Destination Picker */}
                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1.5">
                          1. Choose Destination Page
                        </label>
                        <select
                          value={selectedPieceId}
                          onChange={(e) => setSelectedPieceId(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500 font-sans"
                        >
                          <option value="">Full Homepage &amp; Catalogue (Default)</option>
                          {articles.map((art) => (
                            <option key={art.id} value={art.id}>
                              {art.title} (KES {art.priceKes || 300})
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Campaign Tag */}
                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1.5">
                          2. Optional Campaign Tag
                        </label>
                        <input
                          type="text"
                          value={campaignTag}
                          onChange={(e) => setCampaignTag(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                          placeholder="e.g. twitter_thread, bookclub, whatsapp"
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-cyan-300 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                        />
                        <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                          Helps you identify which channel generated the sale in your sales ledger.
                        </p>
                      </div>
                    </div>

                    {/* Resulting URL Display */}
                    <div className="p-4 rounded-xl bg-black/60 border border-slate-800 space-y-3">
                      <div className="flex items-center justify-between text-xs font-mono text-slate-400">
                        <span>Generated Trackable URL:</span>
                        <button
                          onClick={() => setShowQrCode(!showQrCode)}
                          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                        >
                          <QrCode className="w-3.5 h-3.5" />
                          <span>{showQrCode ? 'Hide QR Code' : 'Show QR Code'}</span>
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={currentGeneratedLink}
                          className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3.5 py-2 text-xs font-mono text-cyan-300 select-all focus:outline-none"
                        />
                        <button
                          onClick={() => handleCopyLink(currentGeneratedLink)}
                          className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-mono font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0"
                        >
                          {copiedLink ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>

                      {showQrCode && (
                        <div className="pt-3 border-t border-slate-800 flex flex-col items-center justify-center p-4 bg-white rounded-xl text-slate-900 animate-in fade-in">
                          <img
                            src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(currentGeneratedLink)}`}
                            alt="Referral QR Code"
                            className="w-36 h-36"
                          />
                          <p className="text-[11px] font-mono text-slate-600 mt-2">
                            Scan to visit Ink &amp; Witness with your referral attribution
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Social Quick Share */}
                    <div className="pt-2">
                      <span className="block text-xs font-mono text-slate-400 mb-2">
                        Quick Share to Socials:
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Check out Ink & Witness Narratives by Jacob Collins Tinga: ${currentGeneratedLink}`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-emerald-950 border border-emerald-700/80 text-emerald-300 hover:text-white font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Send className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </a>

                        <a
                          href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Essential reading from Ink & Witness Narratives:`)}&url=${encodeURIComponent(currentGeneratedLink)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded-lg bg-sky-950 border border-sky-700/80 text-sky-300 hover:text-white font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <Share2 className="w-3 h-3" />
                          <span>Twitter / X</span>
                        </a>

                        <a
                          href={`mailto:?subject=${encodeURIComponent("Recommended Reading from Ink & Witness")}&body=${encodeURIComponent(`I thought you'd find this piece from Ink & Witness Narratives insightful: ${currentGeneratedLink}`)}`}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-slate-300 hover:text-white font-mono text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                        >
                          <ExternalLink className="w-3 h-3" />
                          <span>Email</span>
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Active Campaigns Tracker if available */}
                  {data?.campaigns && data.campaigns.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-serif font-bold text-slate-200">
                          Active Targeted Campaigns
                        </h4>
                        <span className="text-[11px] font-mono text-cyan-400">
                          {data.campaigns.length} Campaign{data.campaigns.length > 1 ? 's' : ''}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {data.campaigns.map((c) => {
                          const campaignLink = generateReferralUrl(undefined, c.code);
                          return (
                            <div key={c.id || c.code} className="p-4 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <span className="font-mono font-bold text-xs text-white uppercase tracking-wider">
                                    {c.name || c.code}
                                  </span>
                                  <span className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-950 text-cyan-400 border border-cyan-800">
                                    c={c.code}
                                  </span>
                                </div>
                                <button
                                  onClick={() => handleCopyLink(campaignLink)}
                                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-[10px] flex items-center gap-1 transition-colors cursor-pointer"
                                >
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </button>
                              </div>

                              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[11px] font-mono">
                                <div>
                                  <span className="text-slate-500 block text-[10px]">Clicks</span>
                                  <span className="text-slate-200 font-bold">{c.clicksCount || 0}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block text-[10px]">Sales</span>
                                  <span className="text-emerald-400 font-bold">{c.salesCount || 0}</span>
                                </div>
                                <div>
                                  <span className="text-slate-500 block text-[10px]">Earned</span>
                                  <span className="text-cyan-300 font-bold">KES {(c.commissionsKes || 0).toLocaleString()}</span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* List of Published Monographs */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-serif font-bold text-slate-200">
                      High-Performing Monograph Direct Links
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {articles.slice(0, 6).map((art) => {
                        const directUrl = generateReferralUrl(art.id);
                        return (
                          <div key={art.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-xs font-serif font-bold text-slate-200 truncate">
                                {art.title}
                              </p>
                              <p className="text-[10px] font-mono text-emerald-400 mt-0.5">
                                Price: KES {art.priceKes || 300} • Earn KES {Math.round((art.priceKes || 300) * (commissionRate / 100))}
                              </p>
                            </div>
                            <button
                              onClick={() => handleCopyLink(directUrl)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[11px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                            >
                              <Copy className="w-3 h-3" />
                              <span>Copy Link</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: SALES LEDGER */}
              {activeTab === 'sales' && (
                <div className="space-y-4 animate-in fade-in">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-serif font-bold text-white">
                        Verified Referral Sales Ledger
                      </h3>
                      <p className="text-xs text-slate-400 font-sans">
                        Commissions calculated on actual verified reader purchases. Buyer privacy is strictly protected.
                      </p>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <div className="relative flex-1 sm:w-56">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
                        <input
                          type="text"
                          value={salesSearch}
                          onChange={(e) => setSalesSearch(e.target.value)}
                          placeholder="Search piece title / receipt..."
                          className="w-full bg-slate-900 border border-slate-700/80 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <select
                        value={salesStatusFilter}
                        onChange={(e) => setSalesStatusFilter(e.target.value)}
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

                  {filteredSales.length === 0 ? (
                    <div className="py-16 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 text-slate-400 font-sans text-xs">
                      <ShoppingBag className="w-8 h-8 mx-auto text-slate-600 mb-2" />
                      <p className="font-semibold text-slate-300">No matching referral sales found</p>
                      <p className="text-slate-500 mt-1">
                        Transactions will appear here instantly when readers purchase via your referral link.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                      <table className="w-full text-left text-xs font-sans">
                        <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="p-3">Date</th>
                            <th className="p-3">Monograph Title</th>
                            <th className="p-3">Method</th>
                            <th className="p-3 text-right">Sale Amount</th>
                            <th className="p-3 text-right">Rate</th>
                            <th className="p-3 text-right">Your Commission</th>
                            <th className="p-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                          {filteredSales.map((sale) => (
                            <tr key={sale.id} className="hover:bg-slate-800/30 transition-colors">
                              <td className="p-3 text-slate-400 whitespace-nowrap">
                                {new Date(sale.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </td>
                              <td className="p-3 font-serif font-semibold text-slate-100 max-w-xs truncate">
                                {sale.articleTitle}
                                {sale.campaignCode && (
                                  <span className="ml-2 px-1.5 py-0.5 rounded bg-cyan-950 text-cyan-300 text-[10px] font-mono">
                                    tag:{sale.campaignCode}
                                  </span>
                                )}
                              </td>
                              <td className="p-3 text-slate-400 uppercase text-[11px]">
                                {sale.paymentMethod || 'mpesa'}
                              </td>
                              <td className="p-3 text-right text-slate-300">
                                KES {sale.saleAmountKes.toLocaleString()}
                              </td>
                              <td className="p-3 text-right text-slate-400">
                                {sale.commissionRate}%
                              </td>
                              <td className="p-3 text-right font-bold text-emerald-400">
                                KES {sale.commissionAmountKes.toLocaleString()}
                              </td>
                              <td className="p-3 text-center">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                                  sale.status === 'verified' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' :
                                  sale.status === 'paid' ? 'bg-cyan-950 text-cyan-400 border border-cyan-800' :
                                  sale.status === 'reversed' ? 'bg-rose-950 text-rose-400 border border-rose-800' :
                                  'bg-amber-950 text-amber-400 border border-amber-800'
                                }`}>
                                  {sale.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 4: PAYOUTS & BALANCE */}
              {activeTab === 'payouts' && (
                <div className="space-y-6 animate-in fade-in">
                  {/* Balance & Request Banner */}
                  <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-emerald-950/20 to-slate-900 border border-emerald-800/60 flex flex-col sm:flex-row sm:items-center justify-between gap-5">
                    <div className="space-y-1">
                      <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                        Affiliate Earnings Balance
                      </span>
                      <div className="text-3xl font-serif font-bold text-emerald-400">
                        KES {availableBalance.toLocaleString()}
                      </div>
                      <p className="text-xs text-slate-400 font-mono">
                        Minimum Payout Threshold: KES {minThreshold.toLocaleString()} • Payout Method: <strong className="text-slate-200 uppercase">{affiliate?.payoutMethod || 'mpesa'}</strong>
                      </p>
                    </div>

                    <button
                      id="affiliate-open-payout-modal-btn"
                      disabled={!canRequestPayout}
                      onClick={() => {
                        setPayoutAmount(availableBalance);
                        setShowPayoutModal(true);
                      }}
                      className="px-5 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-slate-800 disabled:text-slate-500 text-slate-950 font-mono font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-900/30 cursor-pointer disabled:cursor-not-allowed shrink-0"
                    >
                      <Wallet className="w-4 h-4" />
                      <span>{canRequestPayout ? 'Request Payout' : `KES ${(minThreshold - availableBalance).toLocaleString()} to Threshold`}</span>
                    </button>
                  </div>

                  {/* Payout History Table */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-serif font-bold text-slate-200">
                      Disbursement &amp; Payout Request History
                    </h4>

                    {(!data?.payouts || data.payouts.length === 0) ? (
                      <div className="py-12 text-center rounded-2xl bg-slate-900/40 border border-slate-800/80 text-slate-400 font-sans text-xs">
                        <Wallet className="w-7 h-7 mx-auto text-slate-600 mb-2" />
                        <p className="font-semibold text-slate-300">No payout requests submitted yet</p>
                        <p className="text-slate-500 mt-1">
                          When your balance reaches KES {minThreshold.toLocaleString()}, you can submit a payout request anytime.
                        </p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/50">
                        <table className="w-full text-left text-xs font-sans">
                          <thead className="bg-slate-950/80 text-[11px] font-mono text-slate-400 border-b border-slate-800">
                            <tr>
                              <th className="p-3">Date Requested</th>
                              <th className="p-3">Amount</th>
                              <th className="p-3">Method &amp; Details</th>
                              <th className="p-3">Payment Reference</th>
                              <th className="p-3 text-center">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 font-mono text-xs">
                            {data.payouts.map((payout) => (
                              <tr key={payout.id} className="hover:bg-slate-800/30 transition-colors">
                                <td className="p-3 text-slate-400 whitespace-nowrap">
                                  {new Date(payout.requestedAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </td>
                                <td className="p-3 font-bold text-emerald-400">
                                  KES {payout.amountKes.toLocaleString()}
                                </td>
                                <td className="p-3 text-slate-300">
                                  <span className="uppercase font-semibold text-[11px]">{payout.payoutMethod}</span>
                                  {payout.payoutDetails?.mpesaPhone && (
                                    <span className="text-slate-400 ml-1">({payout.payoutDetails.mpesaPhone})</span>
                                  )}
                                  {payout.payoutDetails?.bankAccountNumber && (
                                    <span className="text-slate-400 ml-1">({payout.payoutDetails.bankName} - {payout.payoutDetails.bankAccountNumber})</span>
                                  )}
                                </td>
                                <td className="p-3 text-cyan-300">
                                  {payout.paymentReference ? (
                                    <span className="px-2 py-0.5 bg-cyan-950/80 rounded border border-cyan-800">
                                      {payout.paymentReference}
                                    </span>
                                  ) : (
                                    <span className="text-slate-500 text-[11px]">Processing...</span>
                                  )}
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
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 5: PAYOUT SETTINGS & SECURITY */}
              {activeTab === 'settings' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
                  {/* Payout & Profile Settings Form */}
                  <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                    <div>
                      <h3 className="text-base font-serif font-bold text-white">
                        Payout Account Preferences
                      </h3>
                      <p className="text-xs text-slate-400 font-sans">
                        Where you want Jake's desk to send your earned commissions.
                      </p>
                    </div>

                    {profileMsg && (
                      <div className="p-3 rounded-xl bg-cyan-950 border border-cyan-800 text-cyan-300 text-xs font-sans">
                        {profileMsg}
                      </div>
                    )}

                    <form onSubmit={handleUpdateProfile} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1">Your Full Name</label>
                        <input
                          type="text"
                          required
                          value={profileName}
                          onChange={(e) => setProfileName(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1">Phone Number</label>
                        <input
                          type="tel"
                          required
                          value={profilePhone}
                          onChange={(e) => setProfilePhone(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1.5">Payout Method</label>
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => setProfilePayoutMethod('mpesa')}
                            className={`p-2 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                              profilePayoutMethod === 'mpesa' ? 'bg-emerald-950 border-emerald-600 text-emerald-300 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'
                            }`}
                          >
                            M-PESA
                          </button>
                          <button
                            type="button"
                            onClick={() => setProfilePayoutMethod('bank')}
                            className={`p-2 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                              profilePayoutMethod === 'bank' ? 'bg-sky-950 border-sky-600 text-sky-300 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'
                            }`}
                          >
                            Bank
                          </button>
                          <button
                            type="button"
                            onClick={() => setProfilePayoutMethod('paypal')}
                            className={`p-2 rounded-xl border text-xs font-mono transition-all cursor-pointer ${
                              profilePayoutMethod === 'paypal' ? 'bg-indigo-950 border-indigo-600 text-indigo-300 font-bold' : 'bg-slate-950 border-slate-800 text-slate-400'
                            }`}
                          >
                            PayPal
                          </button>
                        </div>
                      </div>

                      {profilePayoutMethod === 'mpesa' && (
                        <div className="space-y-2 p-3 rounded-xl bg-black/40 border border-slate-800">
                          <div>
                            <label className="block text-[11px] font-mono text-slate-400 mb-1">M-Pesa Disbursement Number</label>
                            <input
                              type="text"
                              value={mpesaPhone}
                              onChange={(e) => setMpesaPhone(e.target.value)}
                              placeholder="0712 345 678"
                              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-mono text-slate-400 mb-1">Registered M-Pesa Name</label>
                            <input
                              type="text"
                              value={mpesaName}
                              onChange={(e) => setMpesaName(e.target.value)}
                              placeholder="John Mwangi"
                              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {profilePayoutMethod === 'bank' && (
                        <div className="space-y-2 p-3 rounded-xl bg-black/40 border border-slate-800">
                          <div>
                            <label className="block text-[11px] font-mono text-slate-400 mb-1">Bank Name</label>
                            <input
                              type="text"
                              value={bankName}
                              onChange={(e) => setBankName(e.target.value)}
                              placeholder="e.g. NCBA / Standard Chartered"
                              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] font-mono text-slate-400 mb-1">Account Number</label>
                            <input
                              type="text"
                              value={bankAccountNumber}
                              onChange={(e) => setBankAccountNumber(e.target.value)}
                              placeholder="1234567890"
                              className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                            />
                          </div>
                        </div>
                      )}

                      {profilePayoutMethod === 'paypal' && (
                        <div className="p-3 rounded-xl bg-black/40 border border-slate-800">
                          <label className="block text-[11px] font-mono text-slate-400 mb-1">PayPal Email</label>
                          <input
                            type="email"
                            value={paypalEmail}
                            onChange={(e) => setPaypalEmail(e.target.value)}
                            placeholder="paypal@example.com"
                            className="w-full bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                          />
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={updatingProfile}
                        className="w-full py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-mono text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {updatingProfile ? 'Saving Changes...' : 'Save Payout Details'}
                      </button>
                    </form>
                  </div>

                  {/* Security & Password Form */}
                  <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
                    <div>
                      <h3 className="text-base font-serif font-bold text-white">
                        Account Security &amp; Password
                      </h3>
                      <p className="text-xs text-slate-400 font-sans">
                        Update your secret affiliate dashboard password.
                      </p>
                    </div>

                    {passwordError && (
                      <div className="p-3 rounded-xl bg-rose-950 border border-rose-800 text-rose-300 text-xs font-sans">
                        {passwordError}
                      </div>
                    )}

                    {passwordMsg && (
                      <div className="p-3 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs font-sans">
                        {passwordMsg}
                      </div>
                    )}

                    <form onSubmit={handleChangePassword} className="space-y-3.5">
                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1">Current Password</label>
                        <input
                          type="password"
                          required
                          autoComplete="current-password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1">New Password</label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          maxLength={256}
                          autoComplete="new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder="8+ characters, letter and number/symbol"
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-mono text-slate-300 mb-1">Confirm New Password</label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          maxLength={256}
                          autoComplete="new-password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-cyan-500"
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={updatingPassword}
                        className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {updatingPassword ? 'Changing Password...' : 'Update Password'}
                      </button>
                    </form>

                    <div className="pt-4 border-t border-slate-800 text-[11px] font-sans text-slate-400 space-y-1">
                      <p className="font-semibold text-slate-300">Affiliate Isolation Guarantee:</p>
                      <p>
                        Your affiliate account is completely detached from Jake's Writers Portal and has zero administrative privileges over website content or reader transactions.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Payout Request Modal Dialog */}
        {showPayoutModal && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <div className="w-full max-w-md bg-[#0e1626] border border-emerald-700/80 rounded-2xl p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                    <Wallet className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-serif font-bold text-white">
                    Submit Payout Request
                  </h3>
                </div>
                <button
                  onClick={() => setShowPayoutModal(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {payoutErrorMsg && (
                <div className="p-3 rounded-xl bg-rose-950 border border-rose-800 text-rose-300 text-xs">
                  {payoutErrorMsg}
                </div>
              )}

              {payoutSuccessMsg && (
                <div className="p-3 rounded-xl bg-emerald-950 border border-emerald-800 text-emerald-300 text-xs">
                  {payoutSuccessMsg}
                </div>
              )}

              <form onSubmit={handleRequestPayoutSubmit} className="space-y-3.5">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Payout Amount (KES)
                  </label>
                  <input
                    type="number"
                    required
                    min={minThreshold}
                    max={availableBalance}
                    value={payoutAmount}
                    onChange={(e) => setPayoutAmount(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-emerald-400 font-mono focus:outline-none focus:border-emerald-500 font-bold"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-slate-500 mt-1">
                    <span>Available: KES {availableBalance.toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={() => setPayoutAmount(availableBalance)}
                      className="text-cyan-400 hover:underline"
                    >
                      Max (Full Balance)
                    </button>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-black/50 border border-slate-800 text-xs font-mono space-y-1">
                  <div className="text-slate-400 flex justify-between">
                    <span>Destination Method:</span>
                    <span className="text-slate-200 uppercase font-bold">{profilePayoutMethod}</span>
                  </div>
                  <div className="text-slate-400 flex justify-between">
                    <span>Recipient Account:</span>
                    <span className="text-emerald-400">
                      {profilePayoutMethod === 'mpesa' ? (mpesaPhone || affiliate?.phone) : 
                       profilePayoutMethod === 'bank' ? (`${bankName} - ${bankAccountNumber}`) :
                       (paypalEmail || affiliate?.email)}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Notes for Author Desk (Optional)
                  </label>
                  <input
                    type="text"
                    value={payoutNotes}
                    onChange={(e) => setPayoutNotes(e.target.value)}
                    placeholder="e.g. March newsletter referral batch"
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-sans focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="pt-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPayoutModal(false)}
                    className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono text-xs cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingPayout}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-mono font-bold text-xs cursor-pointer disabled:opacity-50"
                  >
                    {submittingPayout ? 'Submitting...' : 'Confirm Request'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

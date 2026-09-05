import React, { useState } from 'react';
import { 
  X, 
  Share2, 
  ShieldCheck, 
  Lock, 
  Mail, 
  Phone, 
  User, 
  ArrowRight, 
  DollarSign, 
  CheckCircle2, 
  AlertCircle, 
  Sparkles, 
  Info,
  CreditCard,
  Building2,
  Smartphone,
  ExternalLink,
  FileText
} from 'lucide-react';
import { api, setAffiliateToken } from '../../utils/api.js';
import { AffiliateAccount } from '../../types.js';
import { AffiliateTermsViewer } from './AffiliateTermsViewer.js';
import { AFFILIATE_TERMS_CHECKBOXES, AFFILIATE_TERMS_VERSION } from '../../data/affiliateTerms.js';
import { validateAffiliatePasswordForInput } from '../../utils/affiliatePasswordPolicy.js';

interface AffiliateAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (affiliate: AffiliateAccount) => void;
}

export const AffiliateAuthModal: React.FC<AffiliateAuthModalProps> = ({
  isOpen,
  onClose,
  onSuccess
}) => {
  const [tab, setTab] = useState<'LOGIN' | 'REGISTER'>('LOGIN');

  // Login form state
  const [loginEmailOrCode, setLoginEmailOrCode] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  // Register form state with draft persistence
  const [name, setName] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_name') || ''; } catch { return ''; }
  });
  const [email, setEmail] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_email') || ''; } catch { return ''; }
  });
  const [phone, setPhone] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_phone') || ''; } catch { return ''; }
  });
  const [preferredCode, setPreferredCode] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_code') || ''; } catch { return ''; }
  });
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [payoutMethod, setPayoutMethod] = useState<'mpesa' | 'bank' | 'paypal'>(() => {
    try { return (sessionStorage.getItem('ink_aff_payout_method') as any) || 'mpesa'; } catch { return 'mpesa'; }
  });
  
  // Payout details
  const [mpesaPhone, setMpesaPhone] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_mpesa_phone') || ''; } catch { return ''; }
  });
  const [mpesaName, setMpesaName] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_mpesa_name') || ''; } catch { return ''; }
  });
  const [bankName, setBankName] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_bank_name') || ''; } catch { return ''; }
  });
  const [bankAccountName, setBankAccountName] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_bank_acc_name') || ''; } catch { return ''; }
  });
  const [bankAccountNumber, setBankAccountNumber] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_bank_acc_num') || ''; } catch { return ''; }
  });
  const [bankBranch, setBankBranch] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_bank_branch') || ''; } catch { return ''; }
  });
  const [paypalEmail, setPaypalEmail] = useState(() => {
    try { return sessionStorage.getItem('ink_aff_paypal_email') || ''; } catch { return ''; }
  });

  // Terms and conditions state (9 checkboxes)
  const [termsChecked, setTermsChecked] = useState<Record<string, boolean>>(() => {
    try {
      const saved = sessionStorage.getItem('ink_affiliate_terms_draft');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Helpers to update and persist form fields
  const handleNameChange = (val: string) => {
    setName(val);
    try { sessionStorage.setItem('ink_aff_name', val); } catch {}
  };
  const handleEmailChange = (val: string) => {
    setEmail(val);
    try { sessionStorage.setItem('ink_aff_email', val); } catch {}
  };
  const handlePhoneChange = (val: string) => {
    setPhone(val);
    try { sessionStorage.setItem('ink_aff_phone', val); } catch {}
  };
  const handlePreferredCodeChange = (val: string) => {
    setPreferredCode(val);
    try { sessionStorage.setItem('ink_aff_code', val); } catch {}
  };
  const handlePayoutMethodChange = (val: 'mpesa' | 'bank' | 'paypal') => {
    setPayoutMethod(val);
    try { sessionStorage.setItem('ink_aff_payout_method', val); } catch {}
  };
  const handleMpesaPhoneChange = (val: string) => {
    setMpesaPhone(val);
    try { sessionStorage.setItem('ink_aff_mpesa_phone', val); } catch {}
  };
  const handleMpesaNameChange = (val: string) => {
    setMpesaName(val);
    try { sessionStorage.setItem('ink_aff_mpesa_name', val); } catch {}
  };
  const handleBankNameChange = (val: string) => {
    setBankName(val);
    try { sessionStorage.setItem('ink_aff_bank_name', val); } catch {}
  };
  const handleBankAccountNameChange = (val: string) => {
    setBankAccountName(val);
    try { sessionStorage.setItem('ink_aff_bank_acc_name', val); } catch {}
  };
  const handleBankAccountNumberChange = (val: string) => {
    setBankAccountNumber(val);
    try { sessionStorage.setItem('ink_aff_bank_acc_num', val); } catch {}
  };
  const handleBankBranchChange = (val: string) => {
    setBankBranch(val);
    try { sessionStorage.setItem('ink_aff_bank_branch', val); } catch {}
  };
  const handlePaypalEmailChange = (val: string) => {
    setPaypalEmail(val);
    try { sessionStorage.setItem('ink_aff_paypal_email', val); } catch {}
  };

  const handleToggleTerm = (id: string) => {
    setTermsChecked(prev => {
      const next = {
        ...prev,
        [id]: !prev[id]
      };
      try {
        sessionStorage.setItem('ink_affiliate_terms_draft', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const handleCheckAllTerms = () => {
    const allChecked = AFFILIATE_TERMS_CHECKBOXES.every(c => Boolean(termsChecked[c.id]));
    let next: Record<string, boolean> = {};
    if (!allChecked) {
      AFFILIATE_TERMS_CHECKBOXES.forEach(c => {
        next[c.id] = true;
      });
    }
    setTermsChecked(next);
    try {
      sessionStorage.setItem('ink_affiliate_terms_draft', JSON.stringify(next));
    } catch {}
  };

  const allTermsAccepted = AFFILIATE_TERMS_CHECKBOXES.every(c => Boolean(termsChecked[c.id]));

  // Clear drafts on successful registration
  const clearRegistrationDrafts = () => {
    try {
      sessionStorage.removeItem('ink_aff_name');
      sessionStorage.removeItem('ink_aff_email');
      sessionStorage.removeItem('ink_aff_phone');
      sessionStorage.removeItem('ink_aff_code');
      sessionStorage.removeItem('ink_aff_payout_method');
      sessionStorage.removeItem('ink_aff_mpesa_phone');
      sessionStorage.removeItem('ink_aff_mpesa_name');
      sessionStorage.removeItem('ink_aff_bank_name');
      sessionStorage.removeItem('ink_aff_bank_acc_name');
      sessionStorage.removeItem('ink_aff_bank_acc_num');
      sessionStorage.removeItem('ink_aff_bank_branch');
      sessionStorage.removeItem('ink_aff_paypal_email');
      sessionStorage.removeItem('ink_affiliate_terms_draft');
    } catch {}
  };

  // Status state
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!loginEmailOrCode.trim() || !loginPassword.trim()) {
      setErrorMessage('Please enter your email/referral code and password.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.affiliateLogin({
        emailOrCode: loginEmailOrCode.trim(),
        password: loginPassword
      });
      if (res.success && res.affiliate) {
        onSuccess(res.affiliate);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !phone.trim() || !password) {
      setErrorMessage('Please fill in all required fields (Name, Email, Phone, and Password).');
      return;
    }

    const passwordError = validateAffiliatePasswordForInput(password);
    if (passwordError) {
      setErrorMessage(passwordError);
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    if (!allTermsAccepted) {
      setErrorMessage('Please review and check all 9 required Affiliate Terms & Conditions before registering.');
      return;
    }

    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await api.affiliateRegister({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        password,
        preferredCode: preferredCode.trim() || undefined,
        payoutMethod,
        payoutDetails: {
          mpesaPhone: mpesaPhone.trim() || phone.trim(),
          mpesaName: mpesaName.trim() || name.trim(),
          bankName: bankName.trim(),
          bankAccountName: bankAccountName.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankBranch: bankBranch.trim(),
          paypalEmail: paypalEmail.trim() || email.trim()
        },
        acceptedTerms: true,
        termsVersion: AFFILIATE_TERMS_VERSION
      });

      if (res.success && res.affiliate) {
        clearRegistrationDrafts();
        setSuccessMessage('Account created successfully! Welcome to the Affiliate Programme.');
        setTimeout(() => {
          onSuccess(res.affiliate);
        }, 600);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div 
      id="affiliate-auth-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div 
        id="affiliate-auth-modal-content"
        className="relative w-full max-w-lg bg-[#0a0f1d] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Decorative Banner */}
        <div className="bg-gradient-to-r from-cyan-950/80 via-slate-900 to-indigo-950/80 p-6 border-b border-slate-800 relative">
          <button
            id="affiliate-auth-close-btn"
            onClick={onClose}
            className="absolute top-4 right-4 p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shadow-inner">
              <Share2 className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-mono tracking-widest text-cyan-400 font-semibold uppercase">
                Ink &amp; Witness Narratives
              </span>
              <h2 className="text-xl font-serif font-bold text-white tracking-wide">
                Affiliates &amp; Referral Partner Portal
              </h2>
            </div>
          </div>

          <p className="text-xs text-slate-300 font-sans leading-relaxed mt-1">
            Promote Jake's paid monographs &amp; critical essays. Earn verified commission on every completed reader purchase with transparent tracking.
          </p>

          {/* Tab Switcher */}
          <div className="flex items-center gap-2 mt-4 pt-2 border-t border-slate-800/60 font-mono text-xs">
            <button
              id="affiliate-tab-login"
              type="button"
              onClick={() => {
                setTab('LOGIN');
                setErrorMessage('');
              }}
              className={`flex-1 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
                tab === 'LOGIN'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              Sign In to Dashboard
            </button>
            <button
              id="affiliate-tab-register"
              type="button"
              onClick={() => {
                setTab('REGISTER');
                setErrorMessage('');
              }}
              className={`flex-1 py-2 rounded-lg font-semibold transition-all cursor-pointer ${
                tab === 'REGISTER'
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              Register as Affiliate
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[75vh] overflow-y-auto custom-scrollbar">
          {errorMessage && (
            <div className="mb-4 p-3 rounded-xl bg-rose-950/70 border border-rose-800/80 text-rose-300 text-xs font-sans flex items-start gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="mb-4 p-3 rounded-xl bg-emerald-950/70 border border-emerald-800/80 text-emerald-300 text-xs font-sans flex items-start gap-2 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{successMessage}</span>
            </div>
          )}

          {tab === 'LOGIN' ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Email Address or Unique Referral Code
                </label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    id="affiliate-login-input"
                    type="text"
                    required
                    value={loginEmailOrCode}
                    onChange={(e) => setLoginEmailOrCode(e.target.value)}
                    placeholder="e.g. partner@example.com or partner"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <input
                    id="affiliate-login-password"
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Enter your affiliate password"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="affiliate-login-submit-btn"
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 hover:from-cyan-500 hover:to-sky-500 text-white font-mono text-xs font-semibold tracking-wider transition-all shadow-lg shadow-cyan-900/30 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <span>Authenticating...</span>
                  ) : (
                    <>
                      <span>Sign In to Affiliate Dashboard</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Full Name <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="affiliate-reg-name"
                    type="text"
                    required
                    value={name}
                    onChange={(e) => handleNameChange(e.target.value)}
                    placeholder="e.g. John Mwangi"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Email Address <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="affiliate-reg-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    placeholder="john@example.com"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Phone Number (M-Pesa/Call) <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="affiliate-reg-phone"
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => handlePhoneChange(e.target.value)}
                    placeholder="0712 345 678"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Preferred Referral Code
                  </label>
                  <input
                    id="affiliate-reg-code"
                    type="text"
                    value={preferredCode}
                    onChange={(e) => handlePreferredCodeChange(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="e.g. jmwangi or lit-reader"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-cyan-300 font-mono placeholder-slate-500 focus:outline-none focus:border-cyan-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-0.5 font-mono">
                    Used in your link: ?ref={preferredCode || 'yourcode'}
                  </p>
                </div>
              </div>

              {/* Payout Method Selection */}
              <div className="pt-1">
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Preferred Payout Method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handlePayoutMethodChange('mpesa')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer text-xs font-mono ${
                      payoutMethod === 'mpesa'
                        ? 'bg-emerald-950/60 border-emerald-600 text-emerald-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-4 h-4 text-emerald-400" />
                    <span>M-PESA (B2C)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePayoutMethodChange('bank')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer text-xs font-mono ${
                      payoutMethod === 'bank'
                        ? 'bg-sky-950/60 border-sky-600 text-sky-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Building2 className="w-4 h-4 text-sky-400" />
                    <span>Bank Transfer</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handlePayoutMethodChange('paypal')}
                    className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 transition-all cursor-pointer text-xs font-mono ${
                      payoutMethod === 'paypal'
                        ? 'bg-indigo-950/60 border-indigo-600 text-indigo-300 font-semibold'
                        : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-4 h-4 text-indigo-400" />
                    <span>PayPal</span>
                  </button>
                </div>
              </div>

              {/* Dynamic Payout Fields */}
              {payoutMethod === 'mpesa' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">M-Pesa Number</label>
                    <input
                      type="text"
                      value={mpesaPhone}
                      onChange={(e) => handleMpesaPhoneChange(e.target.value)}
                      placeholder={phone || "0700 000 000"}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Registered M-Pesa Name</label>
                    <input
                      type="text"
                      value={mpesaName}
                      onChange={(e) => handleMpesaNameChange(e.target.value)}
                      placeholder={name || "John Mwangi"}
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                    />
                  </div>
                </div>
              )}

              {payoutMethod === 'bank' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Bank Name</label>
                    <input
                      type="text"
                      value={bankName}
                      onChange={(e) => handleBankNameChange(e.target.value)}
                      placeholder="e.g. KCB / Equity / NCBA"
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-mono text-slate-400 mb-1">Account Number</label>
                    <input
                      type="text"
                      value={bankAccountNumber}
                      onChange={(e) => handleBankAccountNumberChange(e.target.value)}
                      placeholder="1234567890"
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                    />
                  </div>
                </div>
              )}

              {payoutMethod === 'paypal' && (
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <label className="block text-[11px] font-mono text-slate-400 mb-1">PayPal Email</label>
                  <input
                    type="email"
                    value={paypalEmail}
                    onChange={(e) => handlePaypalEmailChange(e.target.value)}
                    placeholder={email || "paypal@example.com"}
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs text-slate-200 font-mono"
                  />
                </div>
              )}

              {/* Password Fields */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="affiliate-reg-password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={256}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="8+ characters, letter and number/symbol"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono text-slate-300 mb-1">
                    Confirm Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    id="affiliate-reg-confirm-password"
                    type="password"
                    required
                    minLength={8}
                    maxLength={256}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 font-sans"
                  />
                </div>
              </div>

              {/* Terms and Conditions Component */}
              <div className="pt-2">
                <AffiliateTermsViewer
                  checkedMap={termsChecked}
                  onToggleCheck={handleToggleTerm}
                  onCheckAll={handleCheckAllTerms}
                />
              </div>

              <div className="pt-3">
                <button
                  id="affiliate-reg-submit-btn"
                  type="submit"
                  disabled={submitting || !allTermsAccepted}
                  className={`w-full py-3 px-4 rounded-xl font-mono text-xs font-semibold tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer ${
                    allTermsAccepted
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-900/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-60'
                  }`}
                >
                  {submitting ? (
                    <span>Registering Account...</span>
                  ) : (
                    <>
                      <span>{allTermsAccepted ? 'Accept Terms & Complete Registration' : 'Check All 9 Terms to Register'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
                {!allTermsAccepted && (
                  <p className="text-[11px] font-mono text-amber-400/90 text-center mt-2">
                    * The registration button unlocks only when all 9 terms checkboxes are checked.
                  </p>
                )}
              </div>
            </form>
          )}

          {/* Privacy & Scope Disclaimer */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center gap-2 text-[11px] font-sans text-slate-400">
            <ShieldCheck className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              <strong>Private &amp; Isolated:</strong> Affiliate accounts have strictly zero access to Jake's Writers Portal, editorial drafts, or private reader payment credentials.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useState, useEffect, useRef } from 'react';
import { 
  Heart, 
  Smartphone, 
  X, 
  Check, 
  Copy, 
  Loader2, 
  CheckCircle2, 
  AlertCircle, 
  Globe, 
  RefreshCw,
  CreditCard,
  Send,
  Sparkles,
  ArrowRight,
  ShieldCheck
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Article, AuthorProfile, SupportedCurrency, ExchangeRatesData } from '../types.js';
import { api } from '../utils/api.js';

interface TipAuthorModalProps {
  isOpen: boolean;
  onClose: () => void;
  article?: Article | null;
  author?: AuthorProfile | null;
}

type TipStep = 'AMOUNT_SELECT' | 'AWAITING_PIN' | 'SUCCESS' | 'ERROR';
type TipTab = 'STK_PUSH' | 'BUY_GOODS' | 'SEND_MONEY' | 'INTERNATIONAL';

const DEFAULT_SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', defaultPresets: [300, 500, 1000, 2500, 5000] },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸', defaultPresets: [3, 5, 10, 25, 50] },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺', defaultPresets: [3, 5, 10, 25, 50] },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧', defaultPresets: [3, 5, 10, 20, 40] },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', flag: '🇨🇦', defaultPresets: [5, 10, 15, 30, 60] },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺', defaultPresets: [5, 10, 15, 35, 70] },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦', defaultPresets: [50, 100, 200, 500, 1000] },
];

export const TipAuthorModal: React.FC<TipAuthorModalProps> = ({
  isOpen,
  onClose,
  article,
  author
}) => {
  // Navigation & Step States
  const [step, setStep] = useState<TipStep>('AMOUNT_SELECT');
  const [activeTab, setActiveTab] = useState<TipTab>('STK_PUSH');

  // Currency & Rates State
  const [currency, setCurrency] = useState<string>('KES');
  const [currencies, setCurrencies] = useState<SupportedCurrency[]>(DEFAULT_SUPPORTED_CURRENCIES);
  const [kesRates, setKesRates] = useState<Record<string, number>>({
    KES: 1,
    USD: 130.0,
    EUR: 141.5,
    GBP: 165.2,
    CAD: 96.5,
    AUD: 85.0,
    ZAR: 7.2,
  });
  const [rateTimestamp, setRateTimestamp] = useState<string>('');
  const [ratesLoading, setRatesLoading] = useState<boolean>(false);
  const [ratesSource, setRatesSource] = useState<string>('Live Exchange');
  const [minTipKes, setMinTipKes] = useState<number>(300);

  // Amount Selection
  const [selectedPreset, setSelectedPreset] = useState<number>(500);
  const [customAmount, setCustomAmount] = useState<string>('');

  // Payment Execution States
  const [phoneNumber, setPhoneNumber] = useState<string>(() => localStorage.getItem('ink_user_phone') || '');
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [checkoutRequestId, setCheckoutRequestId] = useState<string>('');
  const [paymentCapability, setPaymentCapability] = useState<string>('');
  const [verifiedReceipt, setVerifiedReceipt] = useState<string>('');
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);

  // Copy Feedback
  const [copiedTill, setCopiedTill] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);

  // Polling ref
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [tillNumber, setTillNumber] = useState<string>('');
  const [authorPhone, setAuthorPhone] = useState<string>('');

  // Fetch live exchange rates on mount
  const fetchRates = async (force = false) => {
    try {
      setRatesLoading(true);
      const data: ExchangeRatesData = await api.getExchangeRates(force);
      if (data && data.kesRates) {
        setKesRates(data.kesRates);
        if (data.supportedCurrencies && data.supportedCurrencies.length > 0) {
          setCurrencies(data.supportedCurrencies);
        }
        if (data.timestamp) setRateTimestamp(data.timestamp);
        if (data.source) setRatesSource(data.source);
        if (data.minTipKes) setMinTipKes(data.minTipKes);
      }
    } catch (err) {
      console.warn('Could not refresh exchange rates, using fallback cache:', err);
    } finally {
      setRatesLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchRates();
      api.getMpesaConfig().then(cfg => {
        if (cfg?.tillNumber) setTillNumber(cfg.tillNumber);
        if (cfg?.businessPhone) setAuthorPhone(cfg.businessPhone);
      }).catch(() => {});
      api.getAuthor().then(auth => {
        if (auth?.callPhoneNumber) setAuthorPhone(auth.callPhoneNumber);
        else if (auth?.whatsappNumber) setAuthorPhone(auth.whatsappNumber);
      }).catch(() => {});

      setStep('AMOUNT_SELECT');
      setErrorMessage('');
      setCheckoutRequestId('');
      setPaymentCapability('');
      setVerifiedReceipt('');
      
      // Default to 500 KES or $5 USD
      if (currency === 'KES') setSelectedPreset(500);
      else if (currency === 'USD') setSelectedPreset(5);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Active Currency Metadata
  const activeCurrencyObj = currencies.find(c => c.code === currency) || {
    code: currency,
    name: currency,
    symbol: currency,
    flag: '🌐',
    defaultPresets: [5, 10, 25, 50, 100]
  };

  // Compute Current Effective Amount in Selected Currency
  const currentRateToKes = kesRates[currency] || (currency === 'KES' ? 1 : 130);
  const activePresets = activeCurrencyObj.defaultPresets || [5, 10, 25, 50, 100];
  
  const enteredAmount = customAmount ? parseFloat(customAmount) || 0 : selectedPreset;
  const effectiveOriginalAmount = Math.max(0, enteredAmount);

  // Compute converted KES amount (rounded integer, min minTipKes)
  const convertedKesRaw = currency === 'KES' 
    ? effectiveOriginalAmount 
    : Math.round(effectiveOriginalAmount * currentRateToKes);

  // Compute minimum in selected currency
  const minRequiredInCurrency = currency === 'KES' 
    ? minTipKes 
    : Math.ceil((minTipKes / currentRateToKes) * 10) / 10;

  const isBelowMinimum = convertedKesRaw < minTipKes || effectiveOriginalAmount <= 0;
  const effectiveKesAmount = Math.max(minTipKes, convertedKesRaw);

  const handleCopyTill = () => {
    navigator.clipboard.writeText(tillNumber);
    setCopiedTill(true);
    setTimeout(() => setCopiedTill(false), 2000);
  };

  const handleCopyPhone = () => {
    navigator.clipboard.writeText("+254705275647");
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  // Poll transaction status to verify real backend payment
  const startStatusPolling = (reqId: string, capability: string) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

    pollIntervalRef.current = setInterval(async () => {
      try {
        const tx = await api.getPaymentStatus(reqId, capability);
        if (tx && (tx.status === 'SUCCESS' || tx.status === 'CONFIRMED' || tx.status === 'PAID')) {
          const receipt = (tx.mpesaReceiptNumber || tx.receiptNumber || '').trim();
          if (receipt) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setVerifiedReceipt(receipt);
            setStep('SUCCESS');
            confetti({
              particleCount: 140,
              spread: 85,
              origin: { y: 0.6 }
            });
          }
        } else if (tx && tx.status === 'CANCELLED') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setErrorMessage('Payment prompt was cancelled on your phone. No money was charged.');
          setStep('ERROR');
        } else if (tx && tx.status === 'FAILED') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          const detail = tx.resultDesc || (tx as any).error || 'Safaricom rejected this tip request.';
          setErrorMessage(`Safaricom Notice: ${detail}`);
          setStep('ERROR');
        }
        // Keep polling calmly if status is PENDING or other
      } catch (err) {
        console.warn('Tip poll network check:', err);
      }
    }, 4500);
  };

  // Manual Status Check Trigger
  const handleManualCheckStatus = async () => {
    if (!checkoutRequestId || !paymentCapability) return;
    try {
      setIsCheckingStatus(true);
      setErrorMessage('');
      const tx = await api.getPaymentStatus(checkoutRequestId, paymentCapability);
      if (tx && (tx.status === 'SUCCESS' || tx.status === 'CONFIRMED' || tx.status === 'PAID')) {
        const receipt = (tx.mpesaReceiptNumber || tx.receiptNumber || '').trim();
        if (receipt) {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          setVerifiedReceipt(receipt);
          setStep('SUCCESS');
          confetti({
            particleCount: 140,
            spread: 85,
            origin: { y: 0.6 }
          });
        }
      } else if (tx && tx.status === 'CANCELLED') {
        setErrorMessage('Payment prompt was cancelled on your phone.');
        setStep('ERROR');
      } else if (tx && tx.status === 'FAILED') {
        const detail = tx.resultDesc || (tx as any).error || 'Safaricom rejected this payment.';
        setErrorMessage(`Safaricom Notice: ${detail}`);
        setStep('ERROR');
      } else {
        setErrorMessage('Payment is awaiting confirmation on Safaricom. If you entered your PIN on your phone, please wait a moment.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not verify status with Safaricom.');
    } finally {
      setIsCheckingStatus(false);
    }
  };

  // Initiate M-Pesa STK Push
  const handleInitiateStkTip = async () => {
    const cleanPhone = phoneNumber.trim();
    const digitsOnly = cleanPhone.replace(/[\s\-\+\(\)]/g, '');
    if (!digitsOnly || digitsOnly.length < 9) {
      setErrorMessage('Please enter a valid Safaricom phone number (e.g. 0715601209 or 0110123456).');
      return;
    }

    if (isBelowMinimum) {
      setErrorMessage(`The minimum tip is equivalent to KSh ${minTipKes} (${activeCurrencyObj.symbol} ${minRequiredInCurrency} ${currency}).`);
      return;
    }

    setLoading(true);
    setErrorMessage('');
    localStorage.setItem('ink_user_phone', cleanPhone);

    try {
      const targetArticleId = article ? article.id : 'general_tip';
      const res = await api.initiateStkPush(
        targetArticleId, 
        cleanPhone, 
        effectiveKesAmount, 
        true, // isTip = true (Strict separation from pay-to-read)
        {
          currency,
          originalAmount: effectiveOriginalAmount,
          exchangeRate: currentRateToKes,
          exchangeRateTimestamp: rateTimestamp || new Date().toISOString()
        }
      );

      if (res && res.checkoutRequestId && res.paymentCapability) {
        setCheckoutRequestId(res.checkoutRequestId);
        setPaymentCapability(res.paymentCapability);
        setStep('AWAITING_PIN');
        startStatusPolling(res.checkoutRequestId, res.paymentCapability);
      } else {
        throw new Error('Failed to dispatch M-Pesa push transaction. No CheckoutRequestID returned.');
      }
    } catch (err: any) {
      setCheckoutRequestId('');
      setPaymentCapability('');
      setErrorMessage(err.message || 'Could not initiate M-Pesa tip. Please try again or use direct Till 1618656.');
      setStep('ERROR');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      id="tip-author-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="tip-author-modal-container"
        className="relative w-full max-w-lg bg-[#0d1424] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-5 sm:px-6 py-4 sm:py-5 bg-gradient-to-r from-[#0a0f1d] via-[#0e172a] to-[#0a0f1d] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 shadow-inner">
              <Heart className="w-5 h-5 fill-rose-500/20 text-rose-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-serif font-bold text-base sm:text-lg text-white">
                  Tip the Author
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800/80">
                  Till {tillNumber}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-sans">
                Direct patron contribution to <strong className="text-slate-200 font-medium">{author?.name || "Jake"}</strong>
              </p>
            </div>
          </div>

          <button
            id="close-tip-modal-btn"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/80 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">

          {/* Article Context Indicator */}
          {article && (
            <div className="p-3 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-slate-800/80 border border-slate-700/60 flex items-center justify-center shrink-0">
                <Heart className="w-4 h-4 text-rose-400" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] font-mono text-slate-400 block uppercase tracking-wider">Tipping for piece:</span>
                <p className="text-xs font-semibold text-slate-200 truncate">{article.title}</p>
              </div>
            </div>
          )}

          {step === 'AMOUNT_SELECT' && (
            <>
              {/* Currency Selector Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-sky-400" />
                    <span>Select Currency:</span>
                  </label>

                  <div className="flex items-center gap-2">
                    {currency !== 'KES' && (
                      <span className="text-[11px] font-mono text-sky-300">
                        1 {currency} ≈ {currentRateToKes.toFixed(1)} KES
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => fetchRates(true)}
                      disabled={ratesLoading}
                      className="text-slate-400 hover:text-white p-1 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                      title="Refresh live exchange rate"
                    >
                      <RefreshCw className={`w-3 h-3 ${ratesLoading ? 'animate-spin text-sky-400' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Primary Currencies Tabs (KES, USD, EUR, GBP) */}
                <div className="grid grid-cols-4 gap-1.5 p-1 bg-slate-950 rounded-xl border border-slate-800 text-xs font-mono font-bold">
                  {['KES', 'USD', 'EUR', 'GBP'].map((code) => {
                    const currObj = currencies.find(c => c.code === code) || { flag: '', symbol: code };
                    const isSelected = currency === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          setCurrency(code);
                          setCustomAmount('');
                          const targetObj = currencies.find(c => c.code === code);
                          if (targetObj && targetObj.defaultPresets && targetObj.defaultPresets.length > 1) {
                            setSelectedPreset(targetObj.defaultPresets[1]);
                          }
                        }}
                        className={`py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                          isSelected
                            ? 'bg-sky-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                        }`}
                      >
                        <span>{currObj.flag}</span>
                        <span>{code}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Additional World Currencies dropdown if desired */}
                <div className="flex items-center justify-end pt-0.5">
                  <select
                    value={['KES', 'USD', 'EUR', 'GBP'].includes(currency) ? '' : currency}
                    onChange={(e) => {
                      if (e.target.value) {
                        setCurrency(e.target.value);
                        setCustomAmount('');
                        const targetObj = currencies.find(c => c.code === e.target.value);
                        if (targetObj && targetObj.defaultPresets) {
                          setSelectedPreset(targetObj.defaultPresets[1] || targetObj.defaultPresets[0]);
                        }
                      }
                    }}
                    className="text-[11px] font-mono bg-slate-900 border border-slate-800 text-slate-300 rounded-lg px-2.5 py-1 focus:outline-none focus:border-sky-500 cursor-pointer"
                  >
                    <option value="">More currencies (CAD, AUD, ZAR...)</option>
                    {currencies.filter(c => !['KES', 'USD', 'EUR', 'GBP'].includes(c.code)).map(c => (
                      <option key={c.code} value={c.code}>
                        {c.flag} {c.code} ({c.name})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preset Amounts Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-mono text-slate-300">
                    Choose Tip Amount <span className="text-slate-400">({activeCurrencyObj.symbol} {minRequiredInCurrency} min)</span>:
                  </label>
                  <span className="text-[11px] font-mono text-emerald-400">
                    M-Pesa Till 1618656
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {activePresets.map((amount) => {
                    const isSelected = selectedPreset === amount && !customAmount;
                    const convertedApprox = currency === 'KES' ? amount : Math.round(amount * currentRateToKes);
                    return (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          setSelectedPreset(amount);
                          setCustomAmount('');
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-rose-950/40 border-rose-500 text-white shadow-md shadow-rose-950/40 ring-1 ring-rose-500'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={`text-sm font-mono font-bold ${isSelected ? 'text-rose-300' : 'text-white'}`}>
                            {activeCurrencyObj.symbol} {amount}
                          </span>
                        </div>
                        {currency !== 'KES' && (
                          <p className="text-[10px] font-mono text-slate-400">
                            ≈ KSh {convertedApprox.toLocaleString()}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>

                {/* Custom Amount Input */}
                <div className="mt-2.5">
                  <div className="relative">
                    <span className="absolute left-3.5 top-2.5 text-xs font-mono font-bold text-slate-400">
                      {activeCurrencyObj.symbol}
                    </span>
                    <input
                      type="number"
                      value={customAmount}
                      onChange={(e) => setCustomAmount(e.target.value)}
                      min={minRequiredInCurrency}
                      step={currency === 'KES' ? '50' : '1'}
                      placeholder={`Enter custom amount in ${currency} (min ${activeCurrencyObj.symbol} ${minRequiredInCurrency})`}
                      className="w-full pl-10 pr-24 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-xs focus:outline-none focus:border-rose-500 transition-colors"
                    />
                    <span className="absolute right-3 top-2.5 text-[11px] font-mono text-slate-500">
                      Min {activeCurrencyObj.symbol} {minRequiredInCurrency}
                    </span>
                  </div>
                </div>
              </div>

              {/* Conversion Breakdown Box (User Requirement 4) */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-sky-900/40 space-y-1.5 font-mono text-xs">
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-slate-400">Selected Contribution:</span>
                  <span className="font-bold text-white text-sm">
                    {activeCurrencyObj.symbol} {effectiveOriginalAmount.toLocaleString()} {currency}
                  </span>
                </div>

                {currency !== 'KES' && (
                  <div className="flex items-center justify-between text-sky-300 text-[11px] pt-1 border-t border-slate-800">
                    <span>Live M-Pesa Conversion:</span>
                    <span className="font-bold">
                      {currency} {effectiveOriginalAmount} ≈ KSh {effectiveKesAmount.toLocaleString()}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between text-emerald-400 font-semibold text-xs pt-1 border-t border-slate-800">
                  <span>You will pay via M-Pesa:</span>
                  <span className="font-bold text-emerald-300 text-sm">
                    KSh {effectiveKesAmount.toLocaleString()}
                  </span>
                </div>
              </div>

              {/* Payment Mode Selector Tabs */}
              <div className="space-y-2">
                <label className="text-xs font-mono text-slate-400 block">
                  Select Payment Method:
                </label>
                <div className="grid grid-cols-4 p-1 bg-slate-950 rounded-xl border border-slate-800 text-[10px] font-mono">
                  <button
                    type="button"
                    onClick={() => setActiveTab('STK_PUSH')}
                    className={`py-2 px-1 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      activeTab === 'STK_PUSH'
                        ? 'bg-rose-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Smartphone className="w-3 h-3" />
                    <span className="truncate">STK Push</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('BUY_GOODS')}
                    className={`py-2 px-1 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      activeTab === 'BUY_GOODS'
                        ? 'bg-emerald-600 text-slate-950 shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <CreditCard className="w-3 h-3" />
                    <span className="truncate">Till 1618656</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('SEND_MONEY')}
                    className={`py-2 px-1 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      activeTab === 'SEND_MONEY'
                        ? 'bg-teal-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Send className="w-3 h-3" />
                    <span className="truncate">Send Money</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('INTERNATIONAL')}
                    className={`py-2 px-1 rounded-lg font-bold transition-all cursor-pointer flex items-center justify-center gap-1 ${
                      activeTab === 'INTERNATIONAL'
                        ? 'bg-amber-500 text-slate-950 shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Globe className="w-3 h-3" />
                    <span className="truncate">Int'l Remit</span>
                  </button>
                </div>
              </div>

              {/* METHOD 1: Instant M-Pesa STK Push */}
              {activeTab === 'STK_PUSH' && (
                <div className="space-y-3 pt-1">
                  <div>
                    <label className="text-xs font-mono text-slate-300 block mb-1">
                      Your Safaricom M-Pesa Phone Number:
                    </label>
                    <input
                      id="tip-mpesa-phone-input"
                      type="text"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="e.g. 0705275647 or 0712345678"
                      className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-rose-500"
                    />
                    <p className="text-[11px] text-slate-400 font-mono mt-1">
                      A prompt will pop up on your phone for <strong className="text-emerald-400">KSh {effectiveKesAmount.toLocaleString()}</strong> to <strong className="text-slate-200">Till {tillNumber}</strong>.
                    </p>
                  </div>

                  {errorMessage && (
                    <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    id="submit-tip-stk-btn"
                    type="button"
                    onClick={handleInitiateStkTip}
                    disabled={loading || isBelowMinimum}
                    className="w-full py-3.5 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-bold text-xs font-mono tracking-wider shadow-lg shadow-rose-950/60 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {loading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Heart className="w-4 h-4 fill-white" />
                    )}
                    <span>
                      Send Tip: {activeCurrencyObj.symbol} {effectiveOriginalAmount} (KSh {effectiveKesAmount.toLocaleString()})
                    </span>
                  </button>
                </div>
              )}

              {/* METHOD 2: Lipa na M-Pesa Buy Goods Till 1618656 */}
              {activeTab === 'BUY_GOODS' && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-emerald-500/30 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-[10px] font-mono text-emerald-400 block uppercase">
                        M-Pesa Buy Goods Till
                      </span>
                      <h4 className="font-serif font-bold text-base text-white">
                        {author?.name || "Jake"} / Ink & Witness
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-xl text-emerald-300 tracking-wider">
                        {tillNumber}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyTill}
                        className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        title="Copy Till Number"
                      >
                        {copiedTill ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
                    <p className="text-slate-400 font-semibold uppercase">Steps on your phone:</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-300">
                      <li>Go to <strong className="text-white">Lipa na M-Pesa</strong> &gt; <strong className="text-white">Buy Goods and Services</strong></li>
                      <li>Enter Till: <strong className="text-emerald-400">{tillNumber}</strong></li>
                      <li>Enter Amount: <strong className="text-white">KSh {effectiveKesAmount.toLocaleString()}</strong> &amp; enter your PIN</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* METHOD 3: Send Money to Phone */}
              {activeTab === 'SEND_MONEY' && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-teal-500/30 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-[10px] font-mono text-teal-400 block uppercase">
                        Author Mobile Line
                      </span>
                      <h4 className="font-serif font-bold text-base text-white">
                        {author?.name || "Jake"}
                      </h4>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-base text-teal-300 tracking-wider">
                        {authorPhone}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopyPhone}
                        className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-teal-500 text-slate-300 hover:text-white transition-colors cursor-pointer"
                        title="Copy Phone Number"
                      >
                        {copiedPhone ? <Check className="w-4 h-4 text-teal-400" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px] text-slate-300">
                    <p className="text-slate-400 font-semibold uppercase">Steps to Send Money:</p>
                    <ol className="list-decimal list-inside space-y-1 text-slate-300">
                      <li>Go to <strong className="text-white">Send Money</strong> on M-Pesa</li>
                      <li>Enter Phone: <strong className="text-teal-400">{authorPhone}</strong> (+254705275647)</li>
                      <li>Enter Amount: <strong className="text-white">KSh {effectiveKesAmount.toLocaleString()}</strong> &amp; enter PIN</li>
                    </ol>
                  </div>
                </div>
              )}

              {/* METHOD 4: International Remittance / Card */}
              {activeTab === 'INTERNATIONAL' && (
                <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/30 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                    <div>
                      <span className="text-[10px] font-mono text-amber-400 block uppercase">
                        International Remittance / Card
                      </span>
                      <h4 className="font-serif font-bold text-base text-white">
                        Direct to Kenya M-Pesa
                      </h4>
                    </div>

                    <span className="px-2.5 py-1 rounded bg-amber-950/80 border border-amber-800/80 text-amber-300 font-mono font-bold text-xs">
                      {activeCurrencyObj.symbol} {effectiveOriginalAmount} {currency}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 space-y-1.5">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Recipient Name:</span>
                      <strong className="text-white">{author?.name || "Jacob Collins Tinga"}</strong>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Buy Goods Till (Kenya):</span>
                      <strong className="text-emerald-400">{tillNumber}</strong>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Recipient Mobile Phone:</span>
                      <strong className="text-emerald-400">+254 705 275 647</strong>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-400">Mobile Wallet:</span>
                      <strong className="text-sky-300">Safaricom M-Pesa</strong>
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed font-sans">
                    Use any remittance app (Sendwave, WorldRemit, Remitly, Wise, TapTap Send) or card to send directly to Till <strong className="text-emerald-300">{tillNumber}</strong> or phone <strong className="text-emerald-300">+254705275647</strong>.
                  </p>

                  <div className="pt-1 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleCopyPhone}
                      className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-bold text-xs font-mono transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      {copiedPhone ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                      <span>Copy International Number (+254705275647)</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP: AWAITING PIN */}
          {step === 'AWAITING_PIN' && (
            <div className="p-5 rounded-2xl bg-slate-950 border border-rose-500/40 space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-rose-950/80 border border-rose-500/50 flex items-center justify-center mx-auto text-rose-400 animate-pulse">
                <Smartphone className="w-6 h-6" />
              </div>

              <div>
                <h4 className="font-serif font-bold text-lg text-white">
                  STK Push sent. Check your phone for the official M-PESA prompt.
                </h4>
                <p className="text-xs text-slate-300 font-sans mt-1">
                  A prompt was dispatched to <strong className="text-rose-300 font-mono">{phoneNumber}</strong> for <strong className="text-emerald-300 font-mono">KSh {effectiveKesAmount.toLocaleString()}</strong>.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 text-center font-mono text-xs space-y-3">
                <div className="flex items-center justify-center gap-2 text-rose-400 font-semibold py-1">
                  <Loader2 className="w-4 h-4 animate-spin text-rose-400" />
                  <span>Waiting for Safaricom confirmation...</span>
                </div>

                <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
                  Enter your private 4-digit M-Pesa PIN <strong>on your phone</strong> to authorize this tip.
                </p>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Never enter PIN online</span>
                  </span>

                  <button
                    type="button"
                    onClick={handleManualCheckStatus}
                    disabled={isCheckingStatus}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/90 hover:bg-rose-500 text-white font-mono text-[11px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1"
                  >
                    {isCheckingStatus ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    <span>Check Status</span>
                  </button>
                </div>
              </div>

              <div className="pt-1 flex items-center justify-between text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setStep('AMOUNT_SELECT')}
                  className="text-slate-400 hover:text-white underline cursor-pointer"
                >
                  ← Change Number / Amount
                </button>
                <button
                  type="button"
                  onClick={handleInitiateStkTip}
                  disabled={loading}
                  className="text-rose-400 hover:text-rose-300 font-bold cursor-pointer"
                >
                  Resend Prompt
                </button>
              </div>
            </div>
          )}

          {/* STEP: ERROR */}
          {step === 'ERROR' && (
            <div className="p-5 rounded-2xl bg-slate-950 border border-rose-500/40 text-center space-y-4">
              <div className="w-12 h-12 rounded-full bg-rose-950 border border-rose-500/60 flex items-center justify-center mx-auto text-rose-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-lg text-white">Payment Unconfirmed</h4>
                <p className="text-xs text-slate-300 font-sans mt-1">
                  {errorMessage || 'Transaction could not be completed at this time.'}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('AMOUNT_SELECT')}
                  className="flex-1 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-200 font-mono text-xs cursor-pointer"
                >
                  Try Again
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('BUY_GOODS');
                    setStep('AMOUNT_SELECT');
                  }}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold font-mono text-xs cursor-pointer"
                >
                  Use Till {tillNumber} Directly
                </button>
              </div>
            </div>
          )}

          {/* STEP: SUCCESS (User Requirement 10) */}
          {step === 'SUCCESS' && (
            <div className="p-6 rounded-2xl bg-slate-950 border border-emerald-500/40 text-center space-y-4 animate-in zoom-in-95">
              <div className="w-14 h-14 rounded-full bg-emerald-950 border border-emerald-500/60 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-950/60">
                <CheckCircle2 className="w-8 h-8" />
              </div>

              <div className="space-y-1.5">
                <h4 className="font-serif font-bold text-xl text-white">
                  Thank You for Supporting Ink &amp; Witness
                </h4>
                <p className="text-xs text-slate-300 font-sans max-w-sm mx-auto leading-relaxed">
                  Your generous patron contribution of <strong className="text-emerald-400">KSh {effectiveKesAmount.toLocaleString()}</strong> ({activeCurrencyObj.symbol} {effectiveOriginalAmount} {currency}) directly empowers {author?.name || "Jake"}'s independent research and long-form writing.
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-xs font-mono text-slate-300 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Verified Receipt:</span>
                  <span className="text-emerald-400 font-bold">{verifiedReceipt || "MPESA-CONFIRMED"}</span>
                </div>
                {article && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Monograph:</span>
                    <span className="text-slate-200 font-semibold truncate max-w-[200px]">{article.title}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Destination:</span>
                  <span className="text-slate-200">M-Pesa Buy Goods Till {tillNumber}</span>
                </div>
              </div>

              <div className="pt-2">
                <button
                  id="tip-success-return-btn"
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-bold text-xs font-mono tracking-wider transition-all cursor-pointer shadow-md shadow-emerald-950"
                >
                  Return to Reading
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer info banner */}
        <div className="px-6 py-3 bg-[#080d19] border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <span className="flex items-center gap-1 text-slate-400">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Safaricom M-Pesa Till {tillNumber}</span>
          </span>
          <span className="text-slate-400">
            Minimum tip: KSh {minTipKes}
          </span>
        </div>
      </div>
    </div>
  );
};

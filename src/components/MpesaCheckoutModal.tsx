import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Smartphone, 
  ShieldCheck, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  BookOpen, 
  RefreshCw, 
  Check, 
  Clock,
  KeyRound,
  ArrowRight
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { Article, MpesaConfig } from '../types.js';
import { api, savePurchasedToken } from '../utils/api.js';

interface MpesaCheckoutModalProps {
  article: Article | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: (article: Article, token: string, receipt: string) => void;
  onOpenSupport?: () => void;
}

type CheckoutStep = 'INPUT' | 'AWAITING_PIN' | 'AWAITING_CONFIRMATION' | 'SUCCESS' | 'CANCELLED' | 'ERROR';

export const MpesaCheckoutModal: React.FC<MpesaCheckoutModalProps> = ({
  article,
  isOpen,
  onClose,
  onPaymentSuccess,
  onOpenSupport
}) => {
  // M-PESA phone number state
  const [phoneNumber, setPhoneNumber] = useState(() => localStorage.getItem('ink_user_phone') || '');
  
  // Payment Stepper & Processing States
  const [step, setStep] = useState<CheckoutStep>('INPUT');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState('');
  const [mpesaReceipt, setMpesaReceipt] = useState('');
  const [downloadToken, setDownloadToken] = useState('');
  const [copiedTill, setCopiedTill] = useState(false);
  const [isManualChecking, setIsManualChecking] = useState(false);
  const [showManualTillGuide, setShowManualTillGuide] = useState(false);

  // Time remaining for prompt validity (45 seconds for Safaricom STK Push)
  const [secondsRemaining, setSecondsRemaining] = useState(45);
  const [manualReceiptInput, setManualReceiptInput] = useState('');
  const [isVerifyingManualReceipt, setIsVerifyingManualReceipt] = useState(false);
  const [manualReceiptError, setManualReceiptError] = useState('');

  // Refs for timers and active status
  const countdownTimerRef = useRef<any>(null);
  const pollIntervalRef = useRef<any>(null);

  // M-Pesa Active Config from Server
  const [mpesaConfig, setMpesaConfig] = useState<MpesaConfig>({
    paymentType: 'till',
    shortcode: '',
    tillNumber: '1618656',
    tillName: 'Ink & Witness / Jake',
    accountReference: 'INKWITNESS',
    env: 'production',
    defaultPriceKes: 1050,
  });

  // Load config on open
  useEffect(() => {
    if (isOpen) {
      api.getMpesaConfig().then(cfg => {
        if (cfg) setMpesaConfig(cfg);
      }).catch(err => console.warn('Could not load mpesa config:', err));
    }
  }, [isOpen]);

  // Initialization when modal opens with an article
  useEffect(() => {
    if (isOpen && article) {
      setStep('INPUT');
      setCheckoutRequestId('');
      setErrorMessage('');
      setLoading(false);
      setCopiedTill(false);
      setShowManualTillGuide(false);
      setSecondsRemaining(45);
      setManualReceiptInput('');
      setManualReceiptError('');
      setIsVerifyingManualReceipt(false);
    }
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [isOpen, article]);

  const basePriceKes = article?.priceKes || mpesaConfig.defaultPriceKes || 1050;
  const currentTillNumber = mpesaConfig.tillNumber || '1618656';
  const currentTillName = mpesaConfig.tillName || 'Ink & Witness / Jake';

  const triggerSuccessNotification = () => {
    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.55 }
    });
  };

  // Robust live polling loop while in AWAITING_PIN or AWAITING_CONFIRMATION
  useEffect(() => {
    if ((step !== 'AWAITING_PIN' && step !== 'AWAITING_CONFIRMATION') || !checkoutRequestId || !article) {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      return;
    }

    let isSubscribed = true;

    // 1. Countdown timer
    if (step === 'AWAITING_PIN') {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        setSecondsRemaining(prev => {
          if (prev <= 1) {
            clearInterval(countdownTimerRef.current);
            // Transition to awaiting confirmation without declaring failure!
            setStep('AWAITING_CONFIRMATION');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    // 2. Continuous backend status polling (every 2.5s)
    const checkStatus = async () => {
      if (!article || !isSubscribed || !checkoutRequestId) return;

      try {
        const status = await api.getPaymentStatus(checkoutRequestId);
        if (!isSubscribed) return;

        const isSuccess = status.status === 'SUCCESS' || status.status === 'CONFIRMED' || status.status === 'PAID';
        if (isSuccess) {
          const verifiedReceipt = (status.mpesaReceiptNumber || status.receiptNumber || '').trim();
          const verifiedToken = status.downloadToken;

          if (verifiedReceipt && verifiedToken) {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);

            setMpesaReceipt(verifiedReceipt);
            setDownloadToken(verifiedToken);
            savePurchasedToken(article.id, verifiedToken, verifiedReceipt, phoneNumber);
            
            triggerSuccessNotification();
            setStep('SUCCESS');
            onPaymentSuccess(article, verifiedToken, verifiedReceipt);
            
            // Automatically close modal after brief visual confirmation
            setTimeout(() => {
              if (isSubscribed) {
                onClose();
              }
            }, 800);
          }
        } else if (status.status === 'CANCELLED') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          setErrorMessage('Payment request was cancelled on your mobile handset. No money was charged.');
          setStep('CANCELLED');
        } else if (status.status === 'FAILED') {
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          const detail = status.resultDesc || (status as any).error || 'Safaricom could not complete this payment request.';
          setErrorMessage(`Safaricom Notice: ${detail}`);
          setStep('ERROR');
        } else if (status.status === 'TIMED_OUT') {
          // If genuinely reported timed out by Safaricom
          setStep('AWAITING_CONFIRMATION');
        }
        // If status is PENDING or other, KEEP POLLING calmly. Do NOT fail!
      } catch (err) {
        // Transient network drops during poll are silently ignored so polling continues
      }
    };

    // Status poll with gentle interval
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    pollIntervalRef.current = setInterval(checkStatus, 4500);

    return () => {
      isSubscribed = false;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [step, checkoutRequestId, article, phoneNumber, onClose, onPaymentSuccess]);

  if (!isOpen || !article) return null;

  const handleCopyTillNumber = () => {
    navigator.clipboard.writeText(currentTillNumber);
    setCopiedTill(true);
    setTimeout(() => setCopiedTill(false), 2000);
  };

  // 1. Initiate Real STK Push via backend -> LIVE Daraja
  const handleInitiateSTK = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanPhone = phoneNumber.trim();
    const digitsOnly = cleanPhone.replace(/[\s\-\+\(\)]/g, '');
    if (!digitsOnly || digitsOnly.length < 9) {
      setErrorMessage('Please enter a valid Safaricom mobile number (e.g. 0715 601 209 or 0110 123 456).');
      return;
    }

    try {
      setLoading(true);
      setErrorMessage('');
      localStorage.setItem('ink_user_phone', cleanPhone);
      
      const res = await api.initiateStkPush(article.id, cleanPhone, basePriceKes);
      if (!res || !res.checkoutRequestId) {
        throw new Error(res?.error || 'Safaricom did not return a valid CheckoutRequestID.');
      }
      setCheckoutRequestId(res.checkoutRequestId);
      setSecondsRemaining(45);
      setStep('AWAITING_PIN');
    } catch (err: any) {
      setCheckoutRequestId('');
      setErrorMessage(err.message || 'Failed to initiate M-Pesa STK Push. Please verify your phone number and try again.');
      setStep('INPUT');
    } finally {
      setLoading(false);
    }
  };

  // Manual trigger to immediately query Safaricom status
  const handleManualCheckStatus = async () => {
    if (!checkoutRequestId) return;
    try {
      setIsManualChecking(true);
      setErrorMessage('');
      const status = await api.getPaymentStatus(checkoutRequestId);
      const isSuccess = status.status === 'SUCCESS' || status.status === 'CONFIRMED' || status.status === 'PAID';
      
      if (isSuccess) {
        const receipt = (status.mpesaReceiptNumber || status.receiptNumber || '').trim();
        const token = status.downloadToken;
        if (receipt && token) {
          setMpesaReceipt(receipt);
          setDownloadToken(token);
          savePurchasedToken(article.id, token, receipt, phoneNumber);
          triggerSuccessNotification();
          setStep('SUCCESS');
          onPaymentSuccess(article, token, receipt);
          setTimeout(() => {
            onClose();
          }, 800);
          return;
        }
      } else if (status.status === 'CANCELLED') {
        setErrorMessage('Payment was cancelled on your phone handset. No money was charged.');
        setStep('CANCELLED');
        return;
      } else if (status.status === 'FAILED') {
        const detail = status.resultDesc || (status as any).error || 'Safaricom could not complete this payment request.';
        setErrorMessage(`Safaricom Notice: ${detail}`);
        setStep('ERROR');
        return;
      }

      setErrorMessage('Payment is awaiting confirmation on Safaricom. If you already entered your PIN on your handset, please wait a moment.');
    } catch (err: any) {
      setErrorMessage(err.message || 'Could not connect to verify status. Please retry.');
    } finally {
      setIsManualChecking(false);
    }
  };

  // Manual Receipt Verification (e.g., if user already received SMS with code like SH12345678)
  const handleVerifyManualReceipt = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = manualReceiptInput.trim().toUpperCase();
    if (!cleanCode || cleanCode.length < 5) {
      setManualReceiptError('Please enter a valid M-Pesa receipt number from your Safaricom SMS (e.g., SH12345678).');
      return;
    }

    try {
      setIsVerifyingManualReceipt(true);
      setManualReceiptError('');
      const res = await api.verifyPaymentByReference(cleanCode, phoneNumber);
      if (res.verified && res.token) {
        savePurchasedToken(article.id, res.token, res.receipt || cleanCode, phoneNumber);
        setMpesaReceipt(res.receipt || cleanCode);
        setDownloadToken(res.token);
        triggerSuccessNotification();
        setStep('SUCCESS');
        onPaymentSuccess(article, res.token, res.receipt || cleanCode);
        setTimeout(() => {
          onClose();
        }, 800);
      } else {
        setManualReceiptError('Receipt could not be verified yet. Please ensure payment has completed on your phone or check the code.');
      }
    } catch (err: any) {
      setManualReceiptError(err.message || 'Could not verify receipt. Please check your SMS and try again.');
    } finally {
      setIsVerifyingManualReceipt(false);
    }
  };

  const formatTimer = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div 
      id="mpesa-checkout-modal"
      className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative w-full max-w-xl rounded-3xl bg-[#0d1424] border border-slate-700/80 shadow-2xl overflow-hidden my-4 max-h-[94vh] flex flex-col">
        
        {/* Top Header Bar */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-[#111c33] to-slate-900 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-950 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <h4 className="font-display font-bold text-sm text-white tracking-wider flex items-center gap-2">
                <span>SAFARICOM M-PESA STK PUSH</span>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
                  Instant Unlock
                </span>
              </h4>
              <p className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5">
                <span>Ink &amp; Witness • Written by Jake</span>
                <span className="text-slate-600">•</span>
                <span className="text-emerald-400">Official Safaricom Daraja</span>
              </p>
            </div>
          </div>

          <button
            id="close-checkout-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-5 sm:p-7 overflow-y-auto">
          
          {/* Item Summary Card */}
          <div className="mb-5 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 flex items-start justify-between gap-4">
            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-sky-400">
                {article.category}
              </span>
              <h5 className="font-display font-bold text-sm sm:text-base text-slate-100 line-clamp-2">
                {article.title}
              </h5>
              <p className="text-xs text-slate-400 font-serif italic">
                By Jake (@its_bigboy_jake)
              </p>
            </div>

            <div className="text-right shrink-0">
              <span className="text-[10px] font-mono text-slate-400 uppercase block">Amount</span>
              <span className="font-display font-bold text-lg text-emerald-400">
                KES {basePriceKes}
              </span>
            </div>
          </div>

          {/* MAIN FORM STEP */}
          {step === 'INPUT' && (
            <div className="space-y-5">
              <form onSubmit={handleInitiateSTK} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono font-medium text-slate-300 mb-2">
                    Safaricom Phone Number:
                  </label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 font-mono text-xs">
                      🇰🇪 +254
                    </div>
                    <input
                      id="mpesa-phone-input"
                      type="tel"
                      value={phoneNumber}
                      onChange={(e) => setPhoneNumber(e.target.value)}
                      placeholder="07XX XXX XXX or 01XX XXX XXX"
                      className="w-full pl-20 pr-4 py-3.5 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                      required
                    />
                  </div>
                  <p className="text-[11px] text-slate-400 font-mono mt-1.5">
                    Enter your Safaricom mobile number. Safaricom will send an official STK prompt to your phone to authorize KES {basePriceKes}.
                  </p>
                </div>

                {errorMessage && (
                  <div className="p-3 rounded-xl bg-red-950/60 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold text-sm tracking-wide shadow-lg shadow-emerald-950/60 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Sending STK Push to Phone...</span>
                    </>
                  ) : (
                    <>
                      <Smartphone className="w-4 h-4" />
                      <span>Pay KES {basePriceKes} with M-Pesa</span>
                    </>
                  )}
                </button>

                <div className="flex items-center justify-center gap-2 text-[11px] font-mono text-slate-400 text-center">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>Direct Safaricom Daraja STK Push • PIN is entered ONLY on your handset</span>
                </div>
              </form>

              {/* Manual Till Backup Info Toggle */}
              <div className="pt-3 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => setShowManualTillGuide(!showManualTillGuide)}
                  className="w-full text-left text-[11px] font-mono text-slate-500 hover:text-slate-400 flex items-center justify-between cursor-pointer py-1"
                >
                  <span>Manual Buy Goods / Till fallback details</span>
                  <span>{showManualTillGuide ? '▲ Hide' : '▼ View Till No'}</span>
                </button>

                {showManualTillGuide && (
                  <div className="mt-2 p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Buy Goods Till:</span>
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">{currentTillNumber}</span>
                        <button
                          type="button"
                          onClick={handleCopyTillNumber}
                          className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                        >
                          {copiedTill ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-slate-500">Till Name:</span>
                      <span className="text-slate-300">{currentTillName}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 2: AWAITING PIN (M-PESA ACTIVE POLLING) */}
          {step === 'AWAITING_PIN' && (
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-gradient-to-br from-emerald-950/80 via-slate-900 to-slate-950 border border-emerald-500/50 text-center space-y-4 shadow-xl">
                
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border border-emerald-400 flex items-center justify-center mx-auto text-emerald-400 animate-pulse">
                  <Smartphone className="w-7 h-7" />
                </div>

                <div>
                  <h4 className="font-display font-bold text-lg text-white">
                    STK Push sent. Check your phone now.
                  </h4>
                  <p className="text-xs text-slate-300 mt-1.5 font-sans">
                    A Safaricom prompt for <strong className="text-emerald-400 font-mono">KES {basePriceKes}</strong> was sent to <strong className="text-emerald-400 font-mono">{phoneNumber}</strong>.
                  </p>
                </div>

                {/* Live Daraja Status Indicator & Timer */}
                <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/40 text-center font-mono text-xs space-y-3">
                  <div className="flex items-center justify-center gap-2 text-emerald-400 font-semibold py-1">
                    <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                    <span>Waiting for Safaricom confirmation...</span>
                  </div>

                  {/* Visual timer countdown */}
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Prompt valid for {formatTimer(secondsRemaining)}</span>
                  </div>

                  <p className="text-[11px] text-slate-400 font-sans leading-relaxed">
                    Please enter your private 4-digit M-Pesa PIN <strong>on your phone handset</strong> to authorize this transaction. Your monograph will unlock automatically as soon as Safaricom confirms.
                  </p>

                  <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-[10px] text-emerald-500/80 font-mono flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Never enter PIN in browser</span>
                    </span>

                    <button
                      type="button"
                      onClick={handleManualCheckStatus}
                      disabled={isManualChecking}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-mono text-[11px] font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                    >
                      {isManualChecking ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                      <span>Check Status</span>
                    </button>
                  </div>
                </div>

                {errorMessage && (
                  <div className="p-2.5 rounded-lg bg-emerald-950/50 border border-emerald-800 text-emerald-200 text-[11px] font-mono">
                    {errorMessage}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between text-xs font-mono pt-1">
                <button
                  type="button"
                  onClick={() => setStep('INPUT')}
                  className="text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  ← Change Number
                </button>
                <button
                  type="button"
                  onClick={() => handleInitiateSTK()}
                  disabled={loading}
                  className="text-emerald-400 hover:text-emerald-300 font-bold cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Resending...' : 'Resend STK Push'}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2B: AWAITING CONFIRMATION / DELAYED RECEIPT RESOLUTION */}
          {step === 'AWAITING_CONFIRMATION' && (
            <div className="space-y-4">
              <div className="p-6 rounded-2xl bg-slate-900/95 border border-sky-500/40 text-center space-y-4 shadow-xl">
                <div className="w-12 h-12 rounded-full bg-sky-500/20 border border-sky-400 flex items-center justify-center mx-auto text-sky-400">
                  <RefreshCw className="w-6 h-6 animate-spin" style={{ animationDuration: '6s' }} />
                </div>

                <div>
                  <h4 className="font-display font-bold text-base sm:text-lg text-white">
                    Still Waiting for Safaricom Network
                  </h4>
                  <p className="text-xs text-slate-300 mt-1 font-sans">
                    If you entered your PIN on your phone, Safaricom may take a few moments to broadcast the confirmation SMS.
                  </p>
                </div>

                {/* Instant Verification by Receipt Form */}
                <form onSubmit={handleVerifyManualReceipt} className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-left space-y-3">
                  <label className="block text-xs font-mono text-slate-300">
                    Already paid? Enter M-Pesa Receipt Code to unlock:
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                        <KeyRound className="w-4 h-4" />
                      </div>
                      <input
                        type="text"
                        value={manualReceiptInput}
                        onChange={(e) => setManualReceiptInput(e.target.value.toUpperCase())}
                        placeholder="e.g. SH12345678"
                        className="w-full pl-9 pr-3 py-2.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-xs uppercase focus:outline-none focus:border-sky-500"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={isVerifyingManualReceipt || !manualReceiptInput.trim()}
                      className="px-4 py-2.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-mono text-xs font-bold disabled:opacity-50 cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      {isVerifyingManualReceipt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ArrowRight className="w-3.5 h-3.5" />}
                      <span>Unlock</span>
                    </button>
                  </div>
                  {manualReceiptError && (
                    <p className="text-[11px] text-red-400 font-mono">{manualReceiptError}</p>
                  )}
                </form>

                <div className="flex items-center justify-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleManualCheckStatus}
                    disabled={isManualChecking}
                    className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-mono text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isManualChecking ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    <span>Check Status Again</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleInitiateSTK()}
                    disabled={loading}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    Resend STK Push
                  </button>
                </div>
              </div>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => setStep('INPUT')}
                  className="text-xs font-mono text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  ← Back to number input
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: SUCCESS STATE (AUTOMATIC UNLOCK) */}
          {step === 'SUCCESS' && (
            <div className="space-y-6 text-center">
              <div className="p-6 rounded-3xl bg-gradient-to-br from-emerald-950/90 via-slate-900 to-slate-950 border border-emerald-500/50 shadow-2xl space-y-4">
                
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center mx-auto text-emerald-400 animate-bounce">
                  <CheckCircle2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 font-bold">
                    Payment Verified &amp; Confirmed
                  </span>
                  <h4 className="font-display font-bold text-xl sm:text-2xl text-white">
                    Monograph Unlocked Automatically
                  </h4>
                  <p className="text-xs text-slate-300 font-sans">
                    M-PESA Receipt: <strong className="text-emerald-400 font-mono">{mpesaReceipt}</strong>
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950 border border-emerald-500/30 text-xs font-mono text-slate-300 text-left space-y-1">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Piece:</span>
                    <span className="text-white truncate max-w-[200px]">{article.title}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Method:</span>
                    <span className="text-slate-200 font-bold">Safaricom M-PESA STK Push</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Amount Paid:</span>
                    <span className="text-emerald-400 font-bold">KES {basePriceKes}.00</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Access:</span>
                    <span className="text-emerald-400">Permanent Reader Access</span>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => {
                      onClose();
                    }}
                    className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-950/80"
                  >
                    <BookOpen className="w-4 h-4" />
                    <span>Read Unlocked Monograph Now</span>
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* STEP 4: CANCELLED OR ERROR STATE */}
          {(step === 'CANCELLED' || step === 'ERROR') && (
            <div className="space-y-5 text-center">
              <div className="p-6 rounded-3xl bg-slate-900/90 border border-slate-700/80 space-y-4">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 border border-amber-400 flex items-center justify-center mx-auto text-amber-400">
                  <AlertCircle className="w-6 h-6" />
                </div>

                <div>
                  <h4 className="font-display font-bold text-lg text-white">
                    {step === 'CANCELLED' ? 'Prompt Cancelled' : 'Payment Notice'}
                  </h4>
                  <p className="text-xs text-slate-300 mt-1">
                    {errorMessage || 'The payment prompt was cancelled or could not be completed.'}
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-slate-950 border border-slate-800 text-xs font-mono text-left space-y-2">
                  <div className="text-slate-400 text-[11px]">
                    Alternative: Pay manually via M-Pesa Buy Goods Till:
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Till Number:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-emerald-400 font-bold">{currentTillNumber}</span>
                      <button
                        type="button"
                        onClick={handleCopyTillNumber}
                        className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:text-white cursor-pointer"
                      >
                        {copiedTill ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-500">Till Name:</span>
                    <span className="text-slate-300">{currentTillName}</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setErrorMessage('');
                      setStep('INPUT');
                    }}
                    className="flex-1 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-mono text-xs font-bold transition-colors cursor-pointer"
                  >
                    Try Again with M-Pesa
                  </button>
                  {onOpenSupport && (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSupport();
                      }}
                      className="flex-1 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-mono text-xs font-bold border border-slate-700 transition-colors cursor-pointer"
                    >
                      Reader Help Desk
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

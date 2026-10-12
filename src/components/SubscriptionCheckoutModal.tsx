import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';

import type { PaymentTransaction, SubscriptionPlan } from '../types.js';
import { api } from '../utils/api.js';

type CheckoutStep = 'input' | 'waiting' | 'confirming' | 'success' | 'error';

export interface SubscriptionCheckoutModalProps {
  plan: SubscriptionPlan | null;
  isOpen: boolean;
  onClose: () => void;
  onPaymentSuccess: (transaction: PaymentTransaction) => void | Promise<void>;
}

const KES_FORMATTER = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 });

function durationLabel(months: number): string {
  if (months === 12) return '1 year';
  if (months > 12 && months % 12 === 0) return `${months / 12} years`;
  return `${months} months`;
}

function isSettled(transaction: PaymentTransaction): boolean {
  return ['SUCCESS', 'CONFIRMED', 'PAID'].includes(transaction.status);
}

function isTerminalFailure(transaction: PaymentTransaction): boolean {
  return ['FAILED', 'CANCELLED', 'TIMEOUT', 'TIMED_OUT', 'EXPIRED'].includes(transaction.status);
}

export const SubscriptionCheckoutModal: React.FC<SubscriptionCheckoutModalProps> = ({
  plan,
  isOpen,
  onClose,
  onPaymentSuccess,
}) => {
  const [phoneNumber, setPhoneNumber] = useState(() => {
    try {
      return localStorage.getItem('ink_user_phone') || '';
    } catch {
      return '';
    }
  });
  const [step, setStep] = useState<CheckoutStep>('input');
  const [errorMessage, setErrorMessage] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState('');
  const [paymentCapability, setPaymentCapability] = useState('');
  const [secondsRemaining, setSecondsRemaining] = useState(45);
  const [isStarting, setIsStarting] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [confirmedTransaction, setConfirmedTransaction] = useState<PaymentTransaction | null>(null);
  const completionHandledRef = useRef(false);

  useEffect(() => {
    if (!isOpen || !plan) return;
    setStep('input');
    setErrorMessage('');
    setCheckoutRequestId('');
    setPaymentCapability('');
    setSecondsRemaining(45);
    setIsStarting(false);
    setIsChecking(false);
    setConfirmedTransaction(null);
    completionHandledRef.current = false;
  }, [isOpen, plan?.id]);

  const handleConfirmed = useCallback(async (transaction: PaymentTransaction) => {
    if (completionHandledRef.current) return;
    if (!transaction.subscriptionExpiresAt) {
      setStep('confirming');
      setErrorMessage('Payment is confirmed. Finalizing your account access now…');
      return;
    }
    completionHandledRef.current = true;
    setConfirmedTransaction(transaction);
    setErrorMessage('');
    setStep('success');
    await onPaymentSuccess(transaction);
  }, [onPaymentSuccess]);

  const checkStatus = useCallback(async () => {
    if (!checkoutRequestId || !paymentCapability || completionHandledRef.current) return;
    const transaction = await api.getPaymentStatus(checkoutRequestId, paymentCapability);
    if (isSettled(transaction)) {
      await handleConfirmed(transaction);
      return;
    }
    if (isTerminalFailure(transaction)) {
      const cancelled = transaction.status === 'CANCELLED';
      setErrorMessage(
        transaction.resultDesc || (cancelled
          ? 'The M-Pesa request was cancelled. No Reader Pass was activated.'
          : 'Safaricom did not confirm this payment. No Reader Pass was activated.'),
      );
      setStep('error');
    }
  }, [checkoutRequestId, paymentCapability, handleConfirmed]);

  useEffect(() => {
    if (!isOpen || !checkoutRequestId || !paymentCapability || !['waiting', 'confirming'].includes(step)) {
      return;
    }

    let active = true;
    const poll = window.setInterval(() => {
      if (!active) return;
      void checkStatus().catch(() => {
        // A temporary connection loss must not turn an unverified payment into a failure.
      });
    }, 4500);
    void checkStatus().catch(() => {});

    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [isOpen, checkoutRequestId, paymentCapability, step, checkStatus]);

  useEffect(() => {
    if (step !== 'waiting') return;
    const countdown = window.setInterval(() => {
      setSecondsRemaining(previous => {
        if (previous <= 1) {
          window.clearInterval(countdown);
          setStep('confirming');
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => window.clearInterval(countdown);
  }, [step]);

  if (!isOpen || !plan) return null;

  const startPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleanPhone = phoneNumber.trim();
    const digits = cleanPhone.replace(/[\s\-+()]/g, '');
    if (digits.length < 9) {
      setErrorMessage('Enter a valid Safaricom number, for example 0715 601 209.');
      return;
    }

    try {
      setIsStarting(true);
      setErrorMessage('');
      const result = await api.initiateSubscriptionCheckout(plan, cleanPhone);
      try {
        localStorage.setItem('ink_user_phone', cleanPhone);
      } catch {
        // Remembering the phone is optional; checkout remains account-bound on the server.
      }
      setCheckoutRequestId(result.checkoutRequestId);
      setPaymentCapability(result.paymentCapability);
      setSecondsRemaining(45);
      setStep(result.reconciliationPending ? 'confirming' : 'waiting');
    } catch (error: any) {
      setErrorMessage(error?.message || 'M-Pesa could not start this payment. Please retry.');
      setStep('input');
    } finally {
      setIsStarting(false);
    }
  };

  const manuallyCheck = async () => {
    try {
      setIsChecking(true);
      setErrorMessage('');
      await checkStatus();
      if (!completionHandledRef.current) {
        setErrorMessage('Payment is still awaiting Safaricom confirmation. Keep this window open if you entered your PIN.');
      }
    } catch (error: any) {
      setErrorMessage(error?.message || 'Status could not be checked just now. Automatic checking will continue.');
    } finally {
      setIsChecking(false);
    }
  };

  const expiresAt = confirmedTransaction?.subscriptionExpiresAt
    ? new Date(confirmedTransaction.subscriptionExpiresAt)
    : null;

  return (
    <div
      className="fixed inset-0 z-[75] flex items-center justify-center overflow-y-auto bg-black/85 p-3 backdrop-blur-md sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-pass-checkout-title"
    >
      <div className="my-4 w-full max-w-lg overflow-hidden rounded-3xl border border-slate-700/80 bg-[#0d1424] shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 bg-slate-950/70 px-5 py-4 sm:px-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-sky-400">Secure Reader Pass</p>
            <h2 id="reader-pass-checkout-title" className="mt-1 font-display text-xl font-bold text-white">
              {plan.name}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Reader Pass checkout"
            className="rounded-full border border-slate-700 p-2 text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 p-5 sm:p-6">
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500">Access period</p>
              <p className="mt-1 flex items-center gap-2 font-semibold text-slate-100">
                <CalendarDays className="h-4 w-4 text-sky-400" aria-hidden="true" />
                {durationLabel(plan.durationMonths)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-slate-500">One payment</p>
              <p className="mt-1 font-display text-xl font-bold text-emerald-300">KSh {KES_FORMATTER.format(plan.priceKes)}</p>
            </div>
          </div>

          {step === 'input' ? (
            <form onSubmit={startPayment} className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-400">
                M-Pesa sends a prompt to your phone. Access is activated only after Safaricom confirms that payment was received.
              </p>
              <label className="block text-xs font-semibold text-slate-300">
                Safaricom phone number
                <span className="mt-2 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 focus-within:border-sky-500">
                  <Smartphone className="h-4 w-4 text-slate-500" aria-hidden="true" />
                  <input
                    type="tel"
                    autoComplete="tel"
                    value={phoneNumber}
                    onChange={event => setPhoneNumber(event.target.value)}
                    placeholder="0715 601 209"
                    className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-600"
                  />
                </span>
              </label>
              <button
                type="submit"
                disabled={isStarting}
                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:cursor-wait disabled:opacity-60"
              >
                {isStarting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                {isStarting ? 'Connecting to M-Pesa…' : `Pay KSh ${KES_FORMATTER.format(plan.priceKes)}`}
              </button>
            </form>
          ) : null}

          {step === 'waiting' || step === 'confirming' ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-sky-800 bg-sky-950/60 text-sky-300">
                {step === 'waiting'
                  ? <Smartphone className="h-6 w-6" aria-hidden="true" />
                  : <Clock3 className="h-6 w-6" aria-hidden="true" />}
              </div>
              <div>
                <h3 className="font-display text-xl font-bold text-white">
                  {step === 'waiting' ? 'Check your phone' : 'Waiting for confirmation'}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {step === 'waiting'
                    ? `Enter your M-Pesa PIN. The prompt remains active for about ${secondsRemaining} seconds.`
                    : 'If you entered your PIN, do not pay again. We will keep checking the payment safely.'}
                </p>
              </div>
              <button
                type="button"
                onClick={manuallyCheck}
                disabled={isChecking}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-sky-600 disabled:opacity-60"
              >
                <RefreshCw className={`h-4 w-4 ${isChecking ? 'animate-spin' : ''}`} aria-hidden="true" />
                Check payment status
              </button>
            </div>
          ) : null}

          {step === 'success' ? (
            <div className="space-y-4 text-center" role="status">
              <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-400" aria-hidden="true" />
              <div>
                <h3 className="font-display text-2xl font-bold text-white">Reader Pass active</h3>
                <p className="mt-2 text-sm text-slate-300">
                  Your full published library is now available on this reader account.
                </p>
                {expiresAt ? (
                  <p className="mt-2 text-xs text-emerald-300">
                    Active until {expiresAt.toLocaleDateString('en-KE', { dateStyle: 'long' })}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-slate-950 hover:bg-sky-400"
              >
                Open my library
              </button>
            </div>
          ) : null}

          {errorMessage ? (
            <div
              role={step === 'error' ? 'alert' : 'status'}
              className={`flex items-start gap-2 rounded-xl border px-3 py-3 text-xs leading-relaxed ${
                step === 'error'
                  ? 'border-rose-800 bg-rose-950/50 text-rose-200'
                  : 'border-amber-800 bg-amber-950/40 text-amber-200'
              }`}
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{errorMessage}</span>
            </div>
          ) : null}

          {step === 'error' ? (
            <button
              type="button"
              onClick={() => {
                setStep('input');
                setErrorMessage('');
                setCheckoutRequestId('');
                setPaymentCapability('');
              }}
              className="w-full rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-200 hover:border-sky-600"
            >
              Try again
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
};

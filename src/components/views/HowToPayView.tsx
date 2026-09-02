import React, { useState } from 'react';
import { 
  Smartphone, 
  CreditCard, 
  CheckCircle2, 
  AlertTriangle, 
  HelpCircle, 
  ArrowRight, 
  Lock, 
  ShieldCheck, 
  Copy, 
  Check, 
  Globe, 
  Heart, 
  BookOpen,
  MessageSquare,
  Sparkles,
  BookmarkCheck,
  Clock
} from 'lucide-react';

interface HowToPayViewProps {
  onExplorePieces: () => void;
  onOpenSupport?: () => void;
}

const TILL_NUMBER = "1618656";

export const HowToPayView: React.FC<HowToPayViewProps> = ({
  onExplorePieces,
  onOpenSupport
}) => {
  const [copiedTill, setCopiedTill] = useState(false);
  const [activeTab, setActiveTab] = useState<'mpesa' | 'card' | 'till'>('mpesa');

  const handleCopyTill = () => {
    navigator.clipboard.writeText(TILL_NUMBER);
    setCopiedTill(true);
    setTimeout(() => setCopiedTill(false), 2500);
  };

  const mpesaSteps = [
    {
      step: "01",
      title: "Select 'Pay to Read' on any piece",
      desc: "Open any monograph preview and click the 'Pay to Read' button to open the secure reader checkout drawer."
    },
    {
      step: "02",
      title: "Choose M-PESA & enter phone number",
      desc: "Select the M-PESA option and enter your Kenyan mobile number (07XX or 01XX) registered for Safaricom M-PESA."
    },
    {
      step: "03",
      title: "Check phone screen for STK Push prompt",
      desc: "An official Safaricom M-PESA prompt will pop up on your handset displaying the merchant and piece amount in KES."
    },
    {
      step: "04",
      title: "Enter your private M-PESA PIN",
      desc: "Enter your PIN securely on your mobile device to approve the payment directly through Safaricom Daraja."
    },
    {
      step: "05",
      title: "Instant verification & reading access",
      desc: "Once confirmed by the Safaricom network, the full text unlocks immediately in your personal online Library across all your devices."
    }
  ];

  const cardSteps = [
    {
      step: "01",
      title: "Choose 'International Card' checkout",
      desc: "For readers outside Kenya without M-PESA, select the Card option. You will never be asked for an M-PESA number."
    },
    {
      step: "02",
      title: "Select your preferred currency",
      desc: "Choose from USD ($), EUR (€), GBP (£), CAD ($), AUD ($), or KES. The live exchange rate is displayed transparently."
    },
    {
      step: "03",
      title: "Enter your Card credentials",
      desc: "Enter your 16-digit Visa, Mastercard, or American Express number, expiration date, and CVC security code."
    },
    {
      step: "04",
      title: "Instant bank authorization",
      desc: "Your card is charged securely with 256-bit SSL encryption, and your piece unlocks on your screen within seconds."
    }
  ];

  const tillSteps = [
    {
      step: "01",
      title: "Open your M-PESA Menu or Safaricom App",
      desc: "Go to Lipa na M-PESA on your phone and choose 'Buy Goods and Services'."
    },
    {
      step: "02",
      title: `Enter Till Number: ${TILL_NUMBER}`,
      desc: `Enter Till Number 1618656 (Ink & Witness / Jake) and the piece amount.`
    },
    {
      step: "03",
      title: "Enter your PIN & receive Safaricom SMS",
      desc: "Enter your PIN securely on your handset. Safaricom will confirm the transaction immediately."
    },
    {
      step: "04",
      title: "Automatic or Self-Service Restoration",
      desc: "Transactions confirmed via Daraja unlock access automatically. You can also restore any past completed purchase anytime in Reader Support."
    }
  ];

  return (
    <div id="how-to-pay-view" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-20 sm:pt-36 sm:pb-28">
      
      {/* Header */}
      <div className="text-center mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-emerald-400 mb-4 shadow-inner">
          <BookOpen className="w-3.5 h-3.5 text-emerald-400" />
          <span>READER PAYMENT GUIDE</span>
        </div>
        <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight">
          How to Read &amp; Pay
        </h1>
        <p className="text-slate-300 text-sm sm:text-base sm:leading-relaxed mt-4 max-w-2xl mx-auto font-sans">
          Ink &amp; Witness Narratives supports Kenyan M-PESA customers and international readers worldwide with zero friction and instant, verified access.
        </p>
      </div>

      {/* Two Routes Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-16">
        <div className="p-6 sm:p-8 rounded-3xl bg-[#0a1120] border border-emerald-900/60 shadow-xl relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-950 border border-emerald-800 flex items-center justify-center text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-emerald-400 block">Kenya &amp; East Africa</span>
              <h3 className="font-display font-bold text-xl text-white">M-PESA Direct STK Push</h3>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-4">
            Fast, secure checkout in Kenyan Shillings (KES). Enter your phone number and approve the prompt directly on your handset screen.
          </p>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 bg-emerald-950/40 px-3 py-2 rounded-xl border border-emerald-800/40">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>Till 1618656 fallback available</span>
          </div>
        </div>

        <div className="p-6 sm:p-8 rounded-3xl bg-[#0a1120] border border-blue-900/60 shadow-xl relative overflow-hidden">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-blue-950 border border-blue-800 flex items-center justify-center text-blue-400">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-blue-400 block">International Readers</span>
              <h3 className="font-display font-bold text-xl text-white">Visa, Mastercard &amp; Amex</h3>
            </div>
          </div>
          <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-4">
            Pay from anywhere in the world using standard debit or credit cards in USD, EUR, GBP, CAD, AUD, or KES. No M-PESA required.
          </p>
          <div className="flex items-center gap-2 text-xs font-mono text-blue-300 bg-blue-950/40 px-3 py-2 rounded-xl border border-blue-800/40">
            <Globe className="w-4 h-4 shrink-0 text-blue-400" />
            <span>Real-time multi-currency conversions</span>
          </div>
        </div>
      </div>

      {/* Interactive Step-by-Step Walkthrough */}
      <div className="mb-16">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-8">
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Step-by-Step Payment Instructions
            </h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Select your payment method below to see detailed instructions:
            </p>
          </div>

          <div className="flex p-1 rounded-2xl bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setActiveTab('mpesa')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'mpesa' 
                  ? 'bg-emerald-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              M-PESA STK Push
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('card')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'card' 
                  ? 'bg-blue-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              International Card
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('till')}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === 'till' 
                  ? 'bg-amber-600 text-white shadow-md' 
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Buy Goods Till 1618656
            </button>
          </div>
        </div>

        {/* Step Cards Grid */}
        <div className="space-y-4">
          {(activeTab === 'mpesa' ? mpesaSteps : activeTab === 'card' ? cardSteps : tillSteps).map((st, idx) => (
            <div 
              key={idx}
              className="p-5 sm:p-6 rounded-2xl bg-[#0c1322] border border-slate-800/80 flex items-start gap-4 sm:gap-6 hover:border-slate-700 transition-colors"
            >
              <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-slate-900 border border-slate-700/80 text-white font-mono font-bold text-sm sm:text-base flex items-center justify-center shrink-0">
                {st.step}
              </div>
              <div className="space-y-1">
                <h4 className="font-display font-bold text-base sm:text-lg text-white">
                  {st.title}
                </h4>
                <p className="text-xs sm:text-sm text-slate-300 font-sans leading-relaxed">
                  {st.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Till copy box if active tab is Till */}
        {activeTab === 'till' && (
          <div className="mt-6 p-6 rounded-3xl bg-amber-950/40 border border-amber-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-amber-400 block mb-1">
                Official Buy Goods Till
              </span>
              <p className="font-mono text-2xl font-bold text-amber-200">
                {TILL_NUMBER}
              </p>
              <p className="text-xs text-amber-300/80 mt-1">
                Merchant Name: Ink &amp; Witness / Jake
              </p>
            </div>
            <button
              type="button"
              onClick={handleCopyTill}
              className="w-full sm:w-auto px-5 py-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-lg shadow-amber-950/40"
            >
              {copiedTill ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>{copiedTill ? 'Till Copied to Clipboard' : 'Copy Till Number'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Difference between Tipping and Unlocking Section */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-slate-800 mb-16 space-y-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-950 border border-purple-800 flex items-center justify-center text-purple-400">
            <Heart className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-display font-bold text-xl text-white">
              Tipping vs. Paying to Read
            </h3>
            <p className="text-xs text-slate-400 font-mono">Important clarification for patrons</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950 border border-emerald-800 text-[11px] font-mono text-emerald-400">
              <Lock className="w-3 h-3" />
              <span>PAY TO READ (PURCHASE)</span>
            </div>
            <h4 className="font-bold text-white text-sm pt-1">Unlocks Full Monographs</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              When you click <strong>Pay to Read</strong> on a locked piece, your payment registers permanent in-browser reading access in your personal Library.
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-950/80 border border-slate-800 space-y-2">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-950 border border-purple-800 text-[11px] font-mono text-purple-400">
              <Heart className="w-3 h-3" />
              <span>PATRON TIP (GIFT)</span>
            </div>
            <h4 className="font-bold text-white text-sm pt-1">Voluntary Patronage</h4>
            <p className="text-xs text-slate-300 leading-relaxed">
              When you click the <strong>Tip</strong> button, you are sending a voluntary appreciation gift to support Jake's independent writing. Tips do not unlock locked monographs.
            </p>
          </div>
        </div>
      </div>

      {/* Reader Guarantees */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-16">
        <div className="p-6 rounded-2xl bg-[#0a1120] border border-slate-800 text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">Independent Verification</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Pieces unlock only when confirmed by the payment ledger. You receive an official receipt.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-[#0a1120] border border-slate-800 text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400">
            <Clock className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">Permanent Library Access</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Your purchases remain permanently saved in your account library so you can return anytime.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-[#0a1120] border border-slate-800 text-center space-y-2">
          <div className="w-10 h-10 mx-auto rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-purple-400">
            <BookmarkCheck className="w-5 h-5" />
          </div>
          <h4 className="font-bold text-white text-sm">Cross-Device Web Reading</h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            Every unlocked piece is formatted for seamless online reading across your mobile and desktop devices.
          </p>
        </div>
      </div>

      {/* Bottom CTA & Support Link */}
      <div className="text-center p-8 rounded-3xl bg-[#0d1527] border border-slate-800 space-y-4">
        <h3 className="font-display font-bold text-xl sm:text-2xl text-white">
          Ready to explore the monographs?
        </h3>
        <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto">
          Immerse yourself in Jake's examined lived experiences of power, intimacy, loss, and statecraft.
        </p>
        <div className="flex items-center justify-center flex-wrap gap-4 pt-2">
          <button
            type="button"
            onClick={onExplorePieces}
            className="px-6 py-3 rounded-xl bg-white hover:bg-slate-200 text-slate-950 font-semibold text-sm inline-flex items-center gap-2 transition-colors shadow-lg"
          >
            <span>Explore All Pieces</span>
            <ArrowRight className="w-4 h-4" />
          </button>
          {onOpenSupport && (
            <button
              type="button"
              onClick={onOpenSupport}
              className="px-6 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 font-semibold text-sm inline-flex items-center gap-2 transition-colors border border-slate-800"
            >
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              <span>Contact Jake for Help</span>
            </button>
          )}
        </div>
      </div>

    </div>
  );
};

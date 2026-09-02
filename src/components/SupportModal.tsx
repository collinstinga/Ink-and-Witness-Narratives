import React, { useState } from 'react';
import { 
  X, 
  HelpCircle, 
  Phone, 
  MessageCircle, 
  Mail, 
  Copy, 
  Check, 
  ExternalLink, 
  ShieldCheck, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle, 
  ChevronDown, 
  ChevronUp, 
  Smartphone, 
  Clock, 
  BookOpen, 
  FileText,
  LifeBuoy
} from 'lucide-react';
import { AuthorProfile } from '../types.js';
import { api, savePurchasedToken } from '../utils/api.js';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  author: AuthorProfile | null;
  onUnlockedSuccess?: (articleId: string) => void;
}

export const SupportModal: React.FC<SupportModalProps> = ({
  isOpen,
  onClose,
  author,
  onUnlockedSuccess
}) => {
  const [activeSection, setActiveSection] = useState<'contact' | 'verify' | 'faq'>('contact');
  const [copiedTill, setCopiedTill] = useState(false);
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState(false);

  // Self-service verification state
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyPhone, setVerifyPhone] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ success: boolean; message: string; articleTitle?: string } | null>(null);

  // FAQ accordion state
  const [expandedFaq, setExpandedFaq] = useState<number | null>(0);

  if (!isOpen) return null;

  const tillNumber = "1618656";
  const authorPhone = author?.callPhoneNumber || author?.whatsappNumber || "0705275647";
  const rawWhatsApp = (author?.whatsappNumber || "0705275647").replace(/[^0-9]/g, '');
  const formattedWhatsApp = rawWhatsApp.startsWith('254') ? rawWhatsApp : rawWhatsApp.startsWith('0') ? `254${rawWhatsApp.substring(1)}` : `254${rawWhatsApp}`;
  const authorEmail = author?.contactEmail || "collinstinga@gmail.com";
  const authorName = author?.name || "Jacob Collins Tinga";

  const handleCopyTill = () => {
    navigator.clipboard.writeText(tillNumber);
    setCopiedTill(true);
    setTimeout(() => setCopiedTill(false), 2000);
  };

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(authorPhone);
    setCopiedPhone(true);
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(authorEmail);
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  };

  const handleManualVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verifyCode.trim()) {
      setVerifyResult({
        success: false,
        message: 'Please enter your M-Pesa transaction reference (e.g., SDF89KLM21).'
      });
      return;
    }

    try {
      setVerifying(true);
      setVerifyResult(null);

      const res = await api.verifyPaymentByReference(verifyCode.trim().toUpperCase(), verifyPhone.trim());
      
      if (res.verified && res.articleId) {
        // Store token locally so piece unlocks immediately
        if (res.token) {
          savePurchasedToken(res.articleId, res.token, res.receipt || verifyCode.trim().toUpperCase(), verifyPhone.trim() || '254705275647');
        }
        setVerifyResult({
          success: true,
          message: `Payment verified! Monograph "${res.articleTitle || 'Selected Piece'}" has been unlocked on your device.`,
          articleTitle: res.articleTitle
        });
        if (onUnlockedSuccess) {
          onUnlockedSuccess(res.articleId);
        }
      } else {
        setVerifyResult({
          success: false,
          message: res.message || 'Could not verify transaction reference. If you paid recently, please message Jake on WhatsApp with your M-Pesa SMS for instant unlock.'
        });
      }
    } catch (err: any) {
      setVerifyResult({
        success: false,
        message: err.message || 'Verification service temporarily unavailable. Please reach out to Jake via WhatsApp or phone.'
      });
    } finally {
      setVerifying(false);
    }
  };

  const faqs = [
    {
      q: "I sent payment via M-Pesa but the piece didn't unlock automatically. What do I do?",
      a: "Occasionally, telecom network delays may slow down the Daraja notification. You can use the 'Self-Service Verification' tab above and paste your 10-character M-Pesa transaction code (e.g. SDF89KLM21). You can also click the WhatsApp button to message Jake directly for instant manual activation."
    },
    {
      q: "How long do I keep access to a piece after paying?",
      a: "Every unlocked monograph is permanently saved to your reader Library on your account, accessible for reading across all your devices."
    },
    {
      q: "Can I pay using International Cards (Visa / Mastercard) outside Kenya?",
      a: "Yes! When opening the payment drawer, select 'International Card'. You can pay in USD, EUR, GBP, CAD, or AUD without needing an M-Pesa account."
    },
    {
      q: "What is the difference between 'Pay to Read' and 'Tip the Author'?",
      a: "'Pay to Read' purchases and permanently unlocks a monograph in your online Library. 'Tip the Author' is a voluntary appreciation gift to support Jake's independent writing and does not unlock pieces."
    },
    {
      q: "How do I read on multiple devices (phone and laptop)?",
      a: "If you unlocked a monograph on your phone and wish to read it on your laptop, simply open the 'Self-Service Verification' tab on your laptop, enter your M-Pesa transaction reference and phone number, and it will unlock instantly."
    }
  ];

  return (
    <div 
      id="support-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        id="support-modal-dialog"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-[#090e1a] border border-slate-800 rounded-3xl shadow-2xl shadow-black/80 overflow-hidden flex flex-col my-auto max-h-[90vh]"
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-[#070b14]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-950/80 border border-cyan-800/80 flex items-center justify-center text-cyan-400">
              <LifeBuoy className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg sm:text-xl text-white">
                Reader Support &amp; Help Desk
              </h2>
              <p className="text-xs text-slate-400 font-sans">
                Direct assistance from author {authorName} &amp; payment verification
              </p>
            </div>
          </div>

          <button
            id="close-support-modal-btn"
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Section Navigation Tabs */}
        <div className="px-6 pt-4 pb-2 border-b border-slate-800/80 bg-[#070b14]/50 flex items-center gap-2 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveSection('contact')}
            className={`px-4 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeSection === 'contact'
                ? 'bg-cyan-950/90 text-cyan-200 border border-cyan-800/80 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <MessageCircle className="w-3.5 h-3.5 text-cyan-400" />
            <span>Contact Jake Direct</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('verify')}
            className={`px-4 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeSection === 'verify'
                ? 'bg-emerald-950/90 text-emerald-200 border border-emerald-800/80 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>Self-Service Unlock</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveSection('faq')}
            className={`px-4 py-2 rounded-xl text-xs font-mono transition-all cursor-pointer whitespace-nowrap flex items-center gap-2 ${
              activeSection === 'faq'
                ? 'bg-purple-950/90 text-purple-200 border border-purple-800/80 font-bold'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5 text-purple-400" />
            <span>FAQs &amp; Guides</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 font-sans">
          
          {/* SECTION 1: DIRECT CONTACT */}
          {activeSection === 'contact' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              
              <div className="p-4 rounded-2xl bg-cyan-950/30 border border-cyan-800/40 text-xs text-cyan-300/90 leading-relaxed">
                Have a question about a monograph, need help with M-Pesa or card checkout, or want to discuss private bespoke writing? Connect with Jake directly:
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                
                {/* WhatsApp Direct */}
                <a
                  href={`https://wa.me/${formattedWhatsApp}?text=${encodeURIComponent("Hello Jake, I'm reading Ink & Witness and need assistance with a piece/payment.")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-4 rounded-2xl bg-[#0e1726] border border-emerald-800/60 hover:border-emerald-500 text-white transition-all group flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-emerald-950 border border-emerald-700/80 flex items-center justify-center text-emerald-400">
                      <MessageCircle className="w-4 h-4" />
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-emerald-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">WhatsApp Chat</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Fastest response for payment help</p>
                    <p className="text-xs font-mono text-emerald-400 mt-2">+{formattedWhatsApp}</p>
                  </div>
                </a>

                {/* Direct Phone Call */}
                <a
                  href={`tel:${authorPhone}`}
                  className="p-4 rounded-2xl bg-[#0e1726] border border-sky-800/60 hover:border-sky-500 text-white transition-all group flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-sky-950 border border-sky-700/80 flex items-center justify-center text-sky-400">
                      <Phone className="w-4 h-4" />
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-sky-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Call Author</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Direct phone line</p>
                    <p className="text-xs font-mono text-sky-400 mt-2">{authorPhone}</p>
                  </div>
                </a>

                {/* Direct Email */}
                <a
                  href={`mailto:${authorEmail}?subject=${encodeURIComponent("Ink & Witness Reader Inquiry")}`}
                  className="p-4 rounded-2xl bg-[#0e1726] border border-slate-800 hover:border-slate-700 text-white transition-all group flex flex-col justify-between space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-indigo-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Email Address</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Formal inquiries &amp; archive copies</p>
                    <p className="text-xs font-mono text-indigo-300 mt-2 truncate">{authorEmail}</p>
                  </div>
                </a>

                {/* Safaricom Till Number Card */}
                <div className="p-4 rounded-2xl bg-[#0e1726] border border-amber-800/60 text-white flex flex-col justify-between space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="w-9 h-9 rounded-xl bg-amber-950 border border-amber-700/80 flex items-center justify-center text-amber-400">
                      <Smartphone className="w-4 h-4" />
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyTill}
                      className="px-2 py-1 rounded bg-amber-950 hover:bg-amber-900 text-amber-300 text-[10px] font-mono flex items-center gap-1 border border-amber-800 cursor-pointer"
                    >
                      {copiedTill ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedTill ? 'Copied' : 'Copy Till'}</span>
                    </button>
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Buy Goods Till</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Lipa na M-Pesa Merchant</p>
                    <p className="text-sm font-mono font-bold text-amber-400 mt-2">{tillNumber}</p>
                  </div>
                </div>

              </div>

            </div>
          )}

          {/* SECTION 2: SELF-SERVICE UNLOCK */}
          {activeSection === 'verify' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-800/40 text-xs text-emerald-300/90 leading-relaxed space-y-1">
                <p className="font-bold text-emerald-200">Already paid via M-Pesa or Buy Goods Till {tillNumber}?</p>
                <p>Enter your 10-character M-Pesa receipt code below to instantly link and unlock your monograph on this browser.</p>
              </div>

              <form onSubmit={handleManualVerify} className="space-y-4">
                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                    M-Pesa Transaction Code *
                  </label>
                  <input
                    type="text"
                    value={verifyCode}
                    onChange={(e) => setVerifyCode(e.target.value.toUpperCase())}
                    placeholder="e.g. SDF89KLM21 or TJ230489"
                    maxLength={15}
                    required
                    className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 uppercase tracking-widest"
                  />
                </div>

                <div>
                  <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">
                    Phone Number (Optional)
                  </label>
                  <input
                    type="tel"
                    value={verifyPhone}
                    onChange={(e) => setVerifyPhone(e.target.value)}
                    placeholder="e.g. 0705275647"
                    className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={verifying}
                  className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg shadow-emerald-950/50 disabled:opacity-50"
                >
                  {verifying ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verifying with Ledger...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Verify &amp; Unlock Monograph</span>
                    </>
                  )}
                </button>
              </form>

              {/* Result Notice */}
              {verifyResult && (
                <div className={`p-4 rounded-2xl text-xs flex items-start gap-3 ${
                  verifyResult.success
                    ? 'bg-emerald-950/90 border border-emerald-700 text-emerald-200'
                    : 'bg-rose-950/90 border border-rose-700 text-rose-200'
                }`}>
                  {verifyResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <div className="space-y-1">
                    <p className="font-bold">{verifyResult.success ? "Success!" : "Verification Note"}</p>
                    <p className="leading-relaxed">{verifyResult.message}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 3: FAQS */}
          {activeSection === 'faq' && (
            <div className="space-y-3 animate-in fade-in duration-150">
              {faqs.map((faq, index) => {
                const isExpanded = expandedFaq === index;
                return (
                  <div
                    key={index}
                    className="rounded-2xl bg-[#0c1322] border border-slate-800 overflow-hidden transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedFaq(isExpanded ? null : index)}
                      className="w-full p-4 text-left font-sans text-xs font-bold text-slate-200 hover:text-white flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <span className="leading-snug">{faq.q}</span>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-purple-400 shrink-0" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
                      )}
                    </button>
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 text-xs text-slate-400 leading-relaxed border-t border-slate-800/60 font-sans">
                        {faq.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 sm:p-5 border-t border-slate-800 bg-[#070b14] flex items-center justify-between text-xs font-mono text-slate-500">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Direct Author Ledger Support</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};

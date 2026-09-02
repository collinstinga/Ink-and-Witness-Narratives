import React, { useState } from 'react';
import { 
  MessageSquare, 
  PhoneCall, 
  Instagram, 
  HelpCircle, 
  ShieldCheck, 
  CheckCircle2, 
  Copy, 
  Check, 
  ExternalLink, 
  ArrowRight, 
  AlertCircle,
  Clock,
  Sparkles,
  BookOpen,
  Send,
  LifeBuoy
} from 'lucide-react';
import { AuthorProfile } from '../../types.js';

interface SupportViewProps {
  author: AuthorProfile | null;
  onExplorePieces?: () => void;
  onOpenHowToPay?: () => void;
}

export const SupportView: React.FC<SupportViewProps> = ({
  author,
  onExplorePieces,
  onOpenHowToPay
}) => {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState('');
  const [userContact, setUserContact] = useState('');
  const [category, setCategory] = useState('Payment / Unlocking Issue');
  const [formSent, setFormSent] = useState(false);

  const whatsappNumber = author?.whatsappNumber || '0715601209';
  const callNumber = author?.callPhoneNumber || '0715601209';
  const cleanPhoneForWa = whatsappNumber.replace(/^0/, '254').replace(/[^0-9]/g, '');
  const instagramHandle = author?.instagram || 'its_bigboy_jake';
  const instagramUrl = author?.instagramUrl || `https://www.instagram.com/${instagramHandle}/`;

  const copyToClipboard = (text: string, fieldId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField(null), 2500);
  };

  const handleCreateWhatsAppLink = () => {
    const message = encodeURIComponent(
      `Hello Jake,\n\nI need assistance with Ink & Witness Narratives.\nTopic: ${category}\nDetails: ${userQuery || 'I would like help with unlocking/reading.'}\nMy Contact: ${userContact || 'Reader'}`
    );
    window.open(`https://wa.me/${cleanPhoneForWa}?text=${message}`, '_blank');
  };

  const faqItems = [
    {
      q: "I paid via M-PESA but my piece didn't unlock immediately?",
      a: "If your network delayed the M-PESA callback or you completed authorization, simply click 'Check Status' in the payment window. The system will query Safaricom Daraja LIVE to confirm your payment, or you can contact Jake on WhatsApp with your Safaricom receipt code for instant assistance."
    },
    {
      q: "I am paying from outside Kenya and do not have M-PESA?",
      a: "Select the 'International Card' option in the checkout window. You can pay securely with any Visa, Mastercard, American Express, or Apple Pay card in your chosen currency (USD, EUR, GBP, CAD, etc.)."
    },
    {
      q: "How long do I keep access after unlocking a piece?",
      a: "Unlocking grants permanent in-browser reading access in your personal Library, accessible across your logged-in devices anytime."
    },
    {
      q: "I changed phones or cleared my browser cache—how do I restore my purchase?",
      a: "Contact Jake directly on WhatsApp with your M-Pesa transaction code or card receipt number, and a replacement access pass will be generated for your new device right away."
    }
  ];

  return (
    <div id="support-contact-view" className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-28 pb-20 sm:pt-36 sm:pb-28">
      
      {/* Header */}
      <div className="text-center mb-12 sm:mb-16">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-blue-950/60 border border-blue-800/60 text-xs font-mono text-blue-400 mb-4 shadow-inner">
          <LifeBuoy className="w-3.5 h-3.5 text-blue-400" />
          <span className="tracking-wide">READER DESK &amp; ASSISTANCE</span>
        </div>
        <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-bold text-white tracking-tight">
          Need a hand?
        </h1>
        <p className="text-slate-300 text-sm sm:text-base sm:leading-relaxed mt-4 max-w-2xl mx-auto font-sans">
          Direct reader support for Ink &amp; Witness Narratives. If you experience payment issues, trouble unlocking or accessing a monograph, technical glitches, or have questions about the website, Jake is available directly.
        </p>
      </div>

      {/* Main Direct Contact Cards (3 Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5 sm:gap-6 mb-16">
        
        {/* WhatsApp Card */}
        <div className="relative p-6 sm:p-7 rounded-3xl bg-[#0d1527] border border-emerald-900/60 hover:border-emerald-500/60 transition-all duration-300 shadow-xl flex flex-col justify-between group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-emerald-950/80 border border-emerald-800/80 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
              <MessageSquare className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-emerald-400 block mb-1">
                Fastest Response
              </span>
              <h3 className="font-display font-bold text-xl text-white">
                WhatsApp Direct
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                Chat directly with Jake for prompt resolution with M-PESA confirmations, unlocking codes, or access issues.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-emerald-300">
                {whatsappNumber}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(whatsappNumber, 'wa')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Copy WhatsApp Number"
              >
                {copiedField === 'wa' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <a
            href={`https://wa.me/${cleanPhoneForWa}?text=Hello%20Jake%2C%20I%20need%20assistance%20with%20Ink%20%26%20Witness%20Narratives.`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/40"
          >
            <span>Open WhatsApp Chat</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

        {/* Direct Call Card */}
        <div className="relative p-6 sm:p-7 rounded-3xl bg-[#0d1527] border border-blue-900/60 hover:border-blue-500/60 transition-all duration-300 shadow-xl flex flex-col justify-between group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-blue-950/80 border border-blue-800/80 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
              <PhoneCall className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-blue-400 block mb-1">
                Direct Telephone
              </span>
              <h3 className="font-display font-bold text-xl text-white">
                Direct Phone Call
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                For urgent reader inquiries or immediate telephone assistance regarding monograph purchases.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-blue-300">
                {callNumber}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(callNumber, 'phone')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Copy Phone Number"
              >
                {copiedField === 'phone' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <a
            href={`tel:${callNumber}`}
            className="mt-6 w-full py-3 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-blue-950/40"
          >
            <PhoneCall className="w-4 h-4" />
            <span>Call Jake Directly</span>
          </a>
        </div>

        {/* Instagram DM Card */}
        <div className="relative p-6 sm:p-7 rounded-3xl bg-[#0d1527] border border-rose-900/60 hover:border-rose-500/60 transition-all duration-300 shadow-xl flex flex-col justify-between group">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-950/80 border border-rose-800/80 flex items-center justify-center text-rose-400 group-hover:scale-105 transition-transform">
              <Instagram className="w-6 h-6" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-widest text-rose-400 block mb-1">
                Social Desk
              </span>
              <h3 className="font-display font-bold text-xl text-white">
                Instagram Direct
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
                Connect for general inquiries, feedback on monographs, editorial questions, or publishing queries.
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between">
              <span className="font-mono text-sm font-semibold text-rose-300">
                @{instagramHandle}
              </span>
              <button
                type="button"
                onClick={() => copyToClipboard(`@${instagramHandle}`, 'ig')}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                title="Copy Handle"
              >
                {copiedField === 'ig' ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <a
            href={instagramUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full py-3 px-4 rounded-xl bg-gradient-to-r from-rose-600 to-amber-600 hover:from-rose-500 hover:to-amber-500 text-white font-medium text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-rose-950/40"
          >
            <span>Message @{instagramHandle}</span>
            <ExternalLink className="w-4 h-4" />
          </a>
        </div>

      </div>

      {/* Reassurance Banner */}
      <div className="p-6 sm:p-8 rounded-3xl bg-slate-900/90 border border-slate-800 mb-16 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-2xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Every Payment Verified</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              If an STK push was debited, your monograph is guaranteed unlocked or refunded immediately.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-2xl bg-blue-950/80 border border-blue-800/80 text-blue-400 shrink-0">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Personal Attention</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              No automated bot responses. Jake personally reviews and resolves all reader queries.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <div className="p-2.5 rounded-2xl bg-amber-950/80 border border-amber-800/80 text-amber-400 shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <h4 className="font-bold text-white text-sm">Need Step-by-Step Help?</h4>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Read our full payment guide with illustrations for M-PESA and International Card checkout.
            </p>
            {onOpenHowToPay && (
              <button
                type="button"
                onClick={onOpenHowToPay}
                className="mt-2 text-xs font-semibold text-amber-300 hover:text-amber-200 inline-flex items-center gap-1"
              >
                <span>View How to Pay</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Inquiry Form Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-16">
        <div className="lg:col-span-6 space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-mono text-slate-400">
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span>SEND A DIRECT INQUIRY</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
            What can we assist you with?
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 leading-relaxed">
            Fill out this quick form to dispatch your inquiry directly to Jake's desk on WhatsApp, or send your M-Pesa receipt for instant manual verification.
          </p>

          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-2">
            <p className="font-semibold text-white">Common things we help with:</p>
            <ul className="space-y-1 text-slate-400 list-disc list-inside">
              <li>M-PESA prompt didn't pop up on your phone</li>
              <li>Entering manual Buy Goods Till confirmation codes</li>
              <li>International Card payments in USD / EUR / GBP</li>
              <li>Recovering unlocked pieces across devices</li>
              <li>General questions regarding monograph licensing</li>
            </ul>
          </div>
        </div>

        <div className="lg:col-span-6 p-6 sm:p-8 rounded-3xl bg-[#0a1120] border border-slate-800 shadow-xl space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">
              Assistance Category
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
            >
              <option>Payment / Unlocking Issue</option>
              <option>M-PESA STK Push Help</option>
              <option>International Card Payment</option>
              <option>Lost Access Token / Device Migration</option>
              <option>Library Reader Access Assistance</option>
              <option>General Question about Ink &amp; Witness</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">
              Your Phone Number or Email (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. 0712345678 or reader@domain.com"
              value={userContact}
              onChange={(e) => setUserContact(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-600 font-mono"
            />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-400 mb-1.5">
              Explain your issue / paste M-Pesa transaction code
            </label>
            <textarea
              rows={4}
              placeholder="Describe the issue or paste your M-Pesa receipt code (e.g. QK892104AB)..."
              value={userQuery}
              onChange={(e) => setUserQuery(e.target.value)}
              className="w-full px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 placeholder:text-slate-600 font-sans"
            />
          </div>

          <button
            type="button"
            onClick={handleCreateWhatsAppLink}
            className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors shadow-lg shadow-emerald-950/50"
          >
            <Send className="w-4 h-4" />
            <span>Send Direct via WhatsApp</span>
          </button>
        </div>
      </div>

      {/* Frequently Asked Questions */}
      <div className="space-y-4">
        <h2 className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-6 flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-blue-400" />
          <span>Frequently Asked Questions</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {faqItems.map((item, idx) => (
            <div key={idx} className="p-5 sm:p-6 rounded-2xl bg-[#0d1424]/90 border border-slate-800/90 space-y-2">
              <h3 className="font-display font-bold text-base text-white">
                {item.q}
              </h3>
              <p className="text-xs sm:text-sm text-slate-300 leading-relaxed font-sans">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

import React from 'react';
import { 
  Smartphone, 
  KeyRound, 
  BookOpen, 
  ShieldCheck, 
  HelpCircle, 
  CheckCircle, 
  Zap,
  Lock
} from 'lucide-react';

export const MpesaGuideSection: React.FC = () => {
  return (
    <section 
      id="mpesa-guide"
      className="py-16 bg-[#0c1220] border-t border-slate-800/80 relative"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-xs font-mono text-emerald-400 mb-3">
            <Smartphone className="w-3.5 h-3.5" />
            <span>SAFARICOM DARAJA INTEGRATION</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl font-bold text-white tracking-tight">
            How M-Pesa Access Works
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm mt-2 font-sans">
            Direct author patronage powered by Kenya’s premier mobile financial network.
          </p>
        </div>

        {/* 3 Step Protocol */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
          
          {/* Step 1 */}
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 relative">
            <div className="w-8 h-8 rounded-full bg-sky-950 border border-sky-600/50 text-sky-400 font-mono font-bold text-xs flex items-center justify-center mb-4">
              01
            </div>
            <h3 className="font-display font-bold text-base text-slate-100 mb-1.5">
              Select Monograph
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              Choose any piece from Jake's archive. Review the preview paragraphs and click <strong className="text-slate-300">Unlock via M-Pesa</strong>.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 relative">
            <div className="w-8 h-8 rounded-full bg-emerald-950 border border-emerald-600/50 text-emerald-400 font-mono font-bold text-xs flex items-center justify-center mb-4">
              02
            </div>
            <h3 className="font-display font-bold text-base text-slate-100 mb-1.5">
              Enter Safaricom PIN
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              An instant STK Push prompt appears on your mobile screen. Confirm the exact amount in KES and input your private M-Pesa PIN.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 relative">
            <div className="w-8 h-8 rounded-full bg-blue-950 border border-blue-600/50 text-blue-400 font-mono font-bold text-xs flex items-center justify-center mb-4">
              03
            </div>
            <h3 className="font-display font-bold text-base text-slate-100 mb-1.5">
              Instant Unlock &amp; Library
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed font-sans">
              The full monograph unlocks instantly on screen and is permanently registered to your reader Library for online access across your devices.
            </p>
          </div>

        </div>

        {/* Security & FAQ Banner */}
        <div className="mt-10 p-5 rounded-2xl bg-slate-950/60 border border-slate-800/80 max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>256-Bit Encrypted • Direct-to-Author • Permanent Account Storage</span>
          </div>
          <div>
            <span>Official Author: <strong className="text-sky-400">Jake (@its_bigboy_jake)</strong></span>
          </div>
        </div>

      </div>
    </section>
  );
};

import React, { useState } from 'react';
import { Lock, Mail, KeyRound, ArrowRight, ShieldCheck, AlertCircle, Eye, EyeOff, BookOpen } from 'lucide-react';
import { api } from '../../utils/api.js';

interface WriterLoginProps {
  onSuccess: (token: string) => void;
  onCancel: () => void;
}

export const WriterLogin: React.FC<WriterLoginProps> = ({ onSuccess, onCancel }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please enter your administrator email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await api.authLogin(email.trim(), password);
      if (res.success && res.user) {
        if (res.user.role !== 'admin') {
          setError('Access restricted to administrators. Client accounts cannot access the Writer Studio.');
          return;
        }
        const sessionToken = (res as any).token || (res as any).sessionId || res.user.sessionId || res.user.id || 'admin_session';
        onSuccess(sessionToken);
      } else {
        setError(res.error || 'Invalid credentials. Access denied.');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a11] text-slate-100 flex items-center justify-center p-4 sm:p-6 relative overflow-hidden">
      {/* Subtle Background Glows */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-sky-900/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-amber-900/10 rounded-full blur-3xl pointer-events-none" />

      <div className="w-full max-w-md bg-[#0f172a]/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-6 sm:p-8 relative z-10">
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 flex items-center justify-center shadow-lg">
            <Lock className="w-6 h-6 text-sky-400" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-950/80 border border-sky-800/60 text-[11px] font-mono uppercase tracking-widest text-sky-300 mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Private Author Workspace</span>
          </div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight">
            Ink &amp; Witness Studio
          </h1>
          <p className="text-xs text-slate-400 mt-1.5">
            Administrator Authentication (Email &amp; Argon2id Encrypted Password)
          </p>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mb-6 p-3.5 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-300">Access Denied</p>
              <p className="mt-0.5 text-rose-200/90 leading-relaxed">{error}</p>
            </div>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
              Admin Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type="email"
                id="admin-login-email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="admin@inkwitness.com"
                autoFocus
                autoComplete="email"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#080d1a] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-sans"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
              Admin Password
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                id="admin-login-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="••••••••••••"
                autoComplete="current-password"
                className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#080d1a] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-sans"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mt-1.5 font-sans">
              Protected by server-side HttpOnly cookie session.
            </p>
          </div>

          <button
            type="submit"
            id="admin-login-submit-btn"
            disabled={loading}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-950/50 hover:shadow-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Authenticating Administrator...</span>
              </span>
            ) : (
              <span className="flex items-center gap-2">
                <span>Unlock Writer Studio</span>
                <ArrowRight className="w-4 h-4" />
              </span>
            )}
          </button>
        </form>

        {/* Footer info & return */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <button
            type="button"
            id="btn-return-public-publication"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (onCancel) {
                onCancel();
              }
              if (window.location.hash.startsWith('#writer') || window.location.hash.startsWith('#sign-in')) {
                window.location.hash = '#home';
              }
            }}
            className="text-slate-300 hover:text-white transition-colors flex items-center gap-2 cursor-pointer font-medium hover:underline underline-offset-4 bg-slate-850 hover:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700/60"
            title="Exit Writer Studio and return to public website"
          >
            <BookOpen className="w-4 h-4 text-sky-400" />
            <span>Return to Public Publication</span>
          </button>

          <span className="text-[11px] font-mono text-slate-500">
            Ink &amp; Witness v3.0
          </span>
        </div>

      </div>
    </div>
  );
};

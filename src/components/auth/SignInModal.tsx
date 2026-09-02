import React, { useState } from 'react';
import { 
  Lock, 
  Mail, 
  KeyRound, 
  User, 
  ArrowRight, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  X, 
  Eye, 
  EyeOff, 
  BookOpen, 
  Sparkles,
  Shield,
  Layers
} from 'lucide-react';
import { api } from '../../utils/api.js';
import { User as UserType } from '../../types.js';

interface SignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (user: UserType) => void;
  initialMode?: 'signin' | 'register';
  currentUser?: UserType | null;
  onOpenWriterStudio?: () => void;
  onLogout?: () => void;
}

export const SignInModal: React.FC<SignInModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'signin',
  currentUser,
  onOpenWriterStudio,
  onLogout
}) => {
  const [mode, setMode] = useState<'signin' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  if (currentUser) {
    return (
      <div 
        id="sign-in-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
      >
        <div className="relative w-full max-w-md bg-[#0c1220] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden my-6">
          <div className="relative px-6 pt-6 pb-4 flex items-center justify-between border-b border-slate-800/80">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-900/60 to-slate-900 border border-sky-600/40 flex items-center justify-center text-sky-400 shadow-md">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display font-bold text-lg text-white tracking-wide">
                  INK &amp; WITNESS
                </h2>
                <p className="text-[11px] font-mono text-slate-400">
                  Active Session Detected
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="p-4 rounded-2xl bg-sky-950/40 border border-sky-800/50 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-sky-600 text-white flex items-center justify-center font-bold text-sm">
                {currentUser.name ? currentUser.name[0].toUpperCase() : currentUser.email[0].toUpperCase()}
              </div>
              <div>
                <p className="text-white font-semibold">{currentUser.name || currentUser.email}</p>
                <p className="text-xs text-sky-300 font-mono">
                  {currentUser.role === 'admin' ? '✓ Administrator Account' : '✓ Verified Member Account'}
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              {currentUser.role === 'admin' && onOpenWriterStudio ? (
                <button
                  id="modal-enter-writer-studio-btn"
                  onClick={() => {
                    onClose();
                    onOpenWriterStudio();
                  }}
                  className="w-full py-3.5 px-4 rounded-2xl bg-gradient-to-r from-sky-600 via-sky-500 to-cyan-500 hover:from-sky-500 hover:to-cyan-400 text-white font-mono text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-sky-950/60 cursor-pointer transition-all"
                >
                  <Sparkles className="w-4 h-4 text-amber-300" />
                  <span>Enter Writer Studio (Author Portal)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : null}

              {onLogout && (
                <button
                  id="modal-switch-account-btn"
                  onClick={() => {
                    onLogout();
                  }}
                  className="w-full py-3 px-4 rounded-2xl bg-slate-900/90 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white font-mono text-xs font-medium flex items-center justify-center gap-2 cursor-pointer transition-all"
                >
                  <span>Sign Out / Switch Account</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    if (!email.trim() || !password.trim()) {
      setError('Please provide both email and password.');
      return;
    }

    setLoading(true);

    try {
      if (mode === 'signin') {
        const res = await api.authLogin(email.trim(), password);
        if (res.success && res.user) {
          setSuccessMsg(`Welcome back, ${res.user.name || res.user.email}!`);
          setTimeout(() => {
            onSuccess(res.user!);
          }, 400);
        } else {
          setError(res.error || 'Authentication failed. Please check your credentials.');
        }
      } else {
        const res = await api.authRegister(email.trim(), password, name.trim());
        if (res.success && res.user) {
          setSuccessMsg('Account created successfully! Logging you in...');
          setTimeout(() => {
            onSuccess(res.user!);
          }, 400);
        } else {
          setError(res.error || 'Registration failed. Please try again.');
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      id="sign-in-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <div className="relative w-full max-w-md bg-[#0c1220] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden my-6">
        
        {/* Subtle Ambient Background */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-sky-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="relative px-6 pt-6 pb-4 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-900/60 to-slate-900 border border-sky-600/40 flex items-center justify-center text-sky-400 shadow-md">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-white tracking-wide">
                INK &amp; WITNESS
              </h2>
              <p className="text-[11px] font-mono text-slate-400">
                Secure Member &amp; Author Portal
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher: Sign In vs Register */}
        <div className="px-6 pt-5">
          <div className="grid grid-cols-2 p-1 rounded-2xl bg-slate-900/90 border border-slate-800">
            <button
              type="button"
              id="auth-tab-signin"
              onClick={() => {
                setMode('signin');
                setError(null);
              }}
              className={`py-2 px-3 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                mode === 'signin'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              id="auth-tab-register"
              onClick={() => {
                setMode('register');
                setError(null);
              }}
              className={`py-2 px-3 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                mode === 'register'
                  ? 'bg-sky-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Create Account
            </button>
          </div>
        </div>

        {/* Form Body */}
        <div className="p-6">
          {error && (
            <div className="mb-4 p-3.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-200 text-xs flex items-start gap-2.5 animate-in fade-in">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-rose-300">Authentication Error</p>
                <p className="mt-0.5 text-rose-200/90 leading-relaxed">{error}</p>
              </div>
            </div>
          )}

          {successMsg && (
            <div className="mb-4 p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-800 text-emerald-200 text-xs flex items-start gap-2.5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <p className="leading-relaxed font-medium">{successMsg}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  Full Name
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                  <input
                    type="text"
                    id="auth-name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Jacob Collins"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#070b14] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-sans"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type="email"
                  id="auth-email-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="reader@inkwitness.com"
                  required
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#070b14] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-sans"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300">
                  Password
                </label>
              </div>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="auth-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Min 8 chars, 1 uppercase, 1 number' : '••••••••••••'}
                  required
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#070b14] border border-slate-700 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 font-sans"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-3 text-slate-500 hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === 'register' && (
                <p className="text-[11px] text-slate-400 mt-1 font-sans">
                  Must contain at least 8 characters, one uppercase letter, and one number.
                </p>
              )}
            </div>

            <button
              type="submit"
              id="auth-submit-btn"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-gradient-to-r from-sky-600 to-cyan-600 hover:from-sky-500 hover:to-cyan-500 text-white font-medium text-sm flex items-center justify-center gap-2 shadow-lg shadow-sky-950/50 hover:shadow-sky-500/20 transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Processing...</span>
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <span>{mode === 'signin' ? 'Sign In to Account' : 'Create Reader Account'}</span>
                  <ArrowRight className="w-4 h-4" />
                </span>
              )}
            </button>
          </form>

          {/* Security Notice */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-mono text-slate-500">
            <div className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5 text-slate-400" />
              <span>Argon2id Encrypted &amp; HttpOnly Sessions</span>
            </div>
            <span>v3.0.0</span>
          </div>

        </div>

      </div>
    </div>
  );
};

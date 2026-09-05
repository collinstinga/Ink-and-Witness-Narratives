import React, { useState, useEffect } from 'react';
import { 
  Sliders, 
  User, 
  CreditCard, 
  Save, 
  Check, 
  AlertCircle, 
  Sparkles,
  Download,
  Database,
  Building2,
  Image as ImageIcon,
  Layers,
  Globe,
  Key,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Zap,
  Smartphone,
  History,
  RotateCcw,
  Upload,
  FileJson,
  CheckCircle2,
  Lock
} from 'lucide-react';
import { Article, AuthorProfile, MpesaConfig } from '../../types.js';
import { api } from '../../utils/api.js';
import { PhotosAndBrandingSection } from './PhotosAndBrandingSection.js';

interface WriterSettingsProps {
  author: AuthorProfile;
  mpesaConfig: MpesaConfig;
  pieces?: Article[];
  onAuthorUpdated: (updated: AuthorProfile) => void;
  onMpesaUpdated: (updated: MpesaConfig) => void;
  onPiecesUpdated?: (updated: Article[]) => void;
}

type SettingsSubTab = 'photos' | 'profile' | 'mpesa' | 'backup';

export const WriterSettings: React.FC<WriterSettingsProps> = ({
  author,
  mpesaConfig,
  pieces = [],
  onAuthorUpdated,
  onMpesaUpdated,
  onPiecesUpdated
}) => {
  const [activeTab, setActiveTab] = useState<SettingsSubTab>('photos');

  // Author Profile Form State
  const [name, setName] = useState(author.name || 'Jake');
  const [handle, setHandle] = useState(author.handle || 'its_bigboy_jake');
  const [title, setTitle] = useState(author.title || 'Cultural Commentator, Strategist & Essayist');
  const [bio, setBio] = useState(author.bio || '');
  const [extendedBio, setExtendedBio] = useState(author.extendedBio || '');
  const [location, setLocation] = useState(author.location || 'Nairobi, Kenya • Global Reach');
  const [featuredQuote, setFeaturedQuote] = useState(author.featuredQuote || '');
  const [instagramUrl, setInstagramUrl] = useState(author.instagramUrl || 'https://www.instagram.com/its_bigboy_jake/');
  const [avatarUrl, setAvatarUrl] = useState(author.avatarUrl || '');

  // M-Pesa Form State
  const [storeNumber, setStoreNumber] = useState(mpesaConfig.storeNumber || '');
  const [tillNumber, setTillNumber] = useState(mpesaConfig.tillNumber || '');
  const [tillName, setTillName] = useState(mpesaConfig.tillName || 'Ink & Witness / Jake');
  const [paybillNumber, setPaybillNumber] = useState(mpesaConfig.paybillNumber || '');
  const [shortcode, setShortcode] = useState(mpesaConfig.shortcode || '');
  const [accountReference, setAccountReference] = useState(mpesaConfig.accountReference || 'INK_WITNESS');
  const [defaultPriceKes, setDefaultPriceKes] = useState(mpesaConfig.defaultPriceKes || 1050);
  const [paymentType, setPaymentType] = useState<'till' | 'paybill'>(mpesaConfig.paymentType || 'till');
  const [env, setEnv] = useState<'sandbox' | 'production'>(mpesaConfig.env || 'production');
  const [mpesaConsumerKey, setMpesaConsumerKey] = useState('');
  const [mpesaConsumerSecret, setMpesaConsumerSecret] = useState('');
  const [mpesaPasskey, setMpesaPasskey] = useState('');
  const [mpesaHasKey, setMpesaHasKey] = useState(mpesaConfig.hasConsumerKey || false);
  const [mpesaHasSecret, setMpesaHasSecret] = useState(mpesaConfig.hasConsumerSecret || false);
  const [mpesaHasPasskey, setMpesaHasPasskey] = useState(mpesaConfig.hasPasskey || false);
  const [testingMpesa, setTestingMpesa] = useState(false);
  const [mpesaTestResult, setMpesaTestResult] = useState<{ status: 'success' | 'error'; message: string } | null>(null);

  const [savingAuthor, setSavingAuthor] = useState(false);
  const [savingMpesa, setSavingMpesa] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [authorSuccess, setAuthorSuccess] = useState(false);
  const [mpesaSuccess, setMpesaSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backup & Snapshot State
  const [snapshots, setSnapshots] = useState<Array<{ filename: string; sizeBytes: number; createdAt: string; formattedDate: string }>>([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [savingPermanently, setSavingPermanently] = useState(false);
  const [restoringSnapshot, setRestoringSnapshot] = useState<string | null>(null);
  const [snapshotSuccess, setSnapshotSuccess] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  // Load configs when tabs are opened
  useEffect(() => {
    if (activeTab === 'mpesa') {
      loadMpesaConfig();
    }
    if (activeTab === 'backup') {
      loadSnapshots();
    }
  }, [activeTab]);

  const loadMpesaConfig = async () => {
    try {
      const res = await api.getAdminMpesaConfig();
      if (res.success && res.config) {
        const c = res.config;
        setStoreNumber(c.storeNumber || '');
        setTillNumber(c.tillNumber || '');
        setTillName(c.tillName || 'Ink & Witness / Jake');
        setPaybillNumber(c.paybillNumber || '');
        setShortcode(c.shortcode || '');
        setAccountReference(c.accountReference || 'INK_WITNESS');
        setDefaultPriceKes(c.defaultPriceKes || 1050);
        setPaymentType(c.paymentType || 'till');
        setEnv(c.env || 'production');
        setMpesaHasKey(c.hasConsumerKey || false);
        setMpesaHasSecret(c.hasConsumerSecret || false);
        setMpesaHasPasskey(c.hasPasskey || false);
        setMpesaConsumerKey(c.consumerKey || '');
        setMpesaConsumerSecret(c.consumerSecret || '');
        setMpesaPasskey(c.passkey || '');
      }
    } catch (err: any) {
      console.warn("Failed to load M-Pesa admin settings:", err);
    }
  };

  const handleSaveAuthor = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingAuthor(true);
    setError(null);
    setAuthorSuccess(false);

    try {
      const payload: Partial<AuthorProfile> = {
        name,
        handle,
        title,
        bio,
        extendedBio,
        location,
        featuredQuote,
        instagramUrl,
        avatarUrl
      };
      const updated = await api.updateAuthorProfile(payload);
      onAuthorUpdated(updated);
      setAuthorSuccess(true);
      setTimeout(() => setAuthorSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update profile.');
    } finally {
      setSavingAuthor(false);
    }
  };

  const handleSaveMpesa = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalDefaultPrice = Number(defaultPriceKes);
    if (isNaN(finalDefaultPrice) || finalDefaultPrice < 1) {
      setError("The default monograph price must be at least KES 1.");
      return;
    }

    setSavingMpesa(true);
    setError(null);
    setMpesaSuccess(false);

    try {
      const payload: any = {
        storeNumber,
        tillNumber,
        tillName,
        paybillNumber,
        shortcode,
        accountReference,
        defaultPriceKes: finalDefaultPrice,
        paymentType,
        env
      };

      if (mpesaConsumerKey.trim() && !mpesaConsumerKey.includes('••••')) {
        payload.consumerKey = mpesaConsumerKey.trim();
      }
      if (mpesaConsumerSecret.trim() && !mpesaConsumerSecret.includes('••••')) {
        payload.consumerSecret = mpesaConsumerSecret.trim();
      }
      if (mpesaPasskey.trim() && !mpesaPasskey.includes('••••')) {
        payload.passkey = mpesaPasskey.trim();
      }

      const updated = await api.updateMpesaConfig(payload);
      onMpesaUpdated(updated);
      setMpesaSuccess(true);
      await loadMpesaConfig();
      setTimeout(() => setMpesaSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update M-Pesa configuration.');
    } finally {
      setSavingMpesa(false);
    }
  };

  const handleTestMpesa = async () => {
    setTestingMpesa(true);
    setMpesaTestResult(null);
    try {
      const payload: any = { env };
      if (mpesaConsumerKey.trim() && !mpesaConsumerKey.includes('••••')) {
        payload.consumerKey = mpesaConsumerKey.trim();
      }
      if (mpesaConsumerSecret.trim() && !mpesaConsumerSecret.includes('••••')) {
        payload.consumerSecret = mpesaConsumerSecret.trim();
      }

      const res = await api.testMpesaConnection(payload);
      setMpesaTestResult({
        status: 'success',
        message: res.message || 'Successfully generated OAuth token from Safaricom Daraja API!'
      });
    } catch (err: any) {
      setMpesaTestResult({
        status: 'error',
        message: err.message || 'Authentication failed. Please verify your Consumer Key, Consumer Secret, and Environment.'
      });
    } finally {
      setTestingMpesa(false);
    }
  };

  const loadSnapshots = async () => {
    setLoadingSnapshots(true);
    try {
      const res = await api.getSnapshots();
      if (res.success && res.snapshots) {
        setSnapshots(res.snapshots);
      }
    } catch (err: any) {
      console.warn("Failed to load snapshots:", err);
    } finally {
      setLoadingSnapshots(false);
    }
  };

  const handleCreateSnapshot = async () => {
    setCreatingSnapshot(true);
    setSnapshotSuccess(null);
    setSnapshotError(null);
    try {
      const res = await api.createSnapshot('manual_admin');
      if (res.success) {
        setSnapshotSuccess(`Created point-in-time snapshot (${res.piecesCount} pieces saved).`);
        await loadSnapshots();
      }
    } catch (err: any) {
      setSnapshotError(err.message || 'Failed to create snapshot.');
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleSavePermanently = async () => {
    setSavingPermanently(true);
    setSnapshotSuccess(null);
    setSnapshotError(null);
    try {
      const res = await api.savePermanently('settings_backup_action');
      if (res.success) {
        setSnapshotSuccess(`Baseline Permanently Saved: All ${res.piecesCount} monographs, authors, and configs flushed to disk and synchronized to Cloud Firestore.`);
        await loadSnapshots();
        setTimeout(() => setSnapshotSuccess(null), 5000);
      } else {
        setSnapshotError(res.message || 'Failed to save baseline permanently.');
      }
    } catch (err: any) {
      setSnapshotError(err.message || 'Error occurred while saving baseline permanently.');
    } finally {
      setSavingPermanently(false);
    }
  };

  const handleRestoreSnapshot = async (filename: string) => {
    if (!window.confirm(`Are you sure you want to restore the website from snapshot "${filename}"? A safety backup of the current state will be taken automatically before restoring.`)) {
      return;
    }
    setRestoringSnapshot(filename);
    setSnapshotSuccess(null);
    setSnapshotError(null);
    try {
      const res = await api.restoreSnapshot({ filename });
      if (res.success) {
        setSnapshotSuccess(`Successfully restored ${res.piecesCount} monographs and configurations from snapshot.`);
        await loadSnapshots();
        // Refresh local author / pieces
        if (onPiecesUpdated) {
          const updatedArticles = await api.getAdminArticles();
          onPiecesUpdated(updatedArticles);
        }
        const updatedAuthor = await api.getAuthor();
        onAuthorUpdated(updatedAuthor);
      }
    } catch (err: any) {
      setSnapshotError(err.message || 'Failed to restore snapshot.');
    } finally {
      setRestoringSnapshot(null);
    }
  };

  const handleFileUploadRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm(`Upload and restore from "${file.name}"? A safety backup of the current state will be taken automatically.`)) {
      e.target.value = '';
      return;
    }

    setRestoringSnapshot('upload');
    setSnapshotSuccess(null);
    setSnapshotError(null);

    try {
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const jsonContent = JSON.parse(event.target?.result as string);
          const res = await api.restoreSnapshot({ archive: jsonContent });
          if (res.success) {
            setSnapshotSuccess(`Successfully restored ${res.piecesCount} pieces from uploaded archive.`);
            await loadSnapshots();
            if (onPiecesUpdated) {
              const updatedArticles = await api.getAdminArticles();
              onPiecesUpdated(updatedArticles);
            }
            const updatedAuthor = await api.getAuthor();
            onAuthorUpdated(updatedAuthor);
          }
        } catch (parseErr: any) {
          setSnapshotError(parseErr.message || 'Invalid JSON file structure.');
        } finally {
          setRestoringSnapshot(null);
          e.target.value = '';
        }
      };
      reader.readAsText(file);
    } catch (err: any) {
      setSnapshotError(err.message || 'Failed to read backup file.');
      setRestoringSnapshot(null);
      e.target.value = '';
    }
  };

  const handleExportBackup = async () => {
    setExporting(true);
    try {
      const token = localStorage.getItem('ink_admin_token');
      const res = await fetch('/api/admin/export', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!res.ok) throw new Error('Failed to download backup');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ink-and-witness-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: any) {
      setError(err.message || 'Failed to export backup JSON.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-8">
      
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-serif font-bold text-white tracking-tight">
            Writer Settings
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Manage public branding, author bio showcase, and Safaricom Till payment rails.
          </p>
        </div>

        {/* Sub-Tabs Selector */}
        <div className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-900 border border-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('photos')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'photos'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Photos &amp; Branding</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'profile'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>Author Profile</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('mpesa')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'mpesa'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5" />
            <span>M-Pesa (Kenya)</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-medium transition-colors flex items-center gap-2 cursor-pointer ${
              activeTab === 'backup'
                ? 'bg-sky-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Backup</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 1. Photos & Branding Tab */}
      {activeTab === 'photos' && (
        <PhotosAndBrandingSection
          author={author}
          pieces={pieces}
          onAuthorUpdated={onAuthorUpdated}
          onPiecesUpdated={onPiecesUpdated}
        />
      )}

      {/* 2. Author Profile Tab */}
      {activeTab === 'profile' && (
        <div className="p-6 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-6 max-w-3xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/80 text-sky-400">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Author Profile Details</h2>
                <p className="text-[11px] text-slate-400">Displayed across all published monographs and showcases</p>
              </div>
            </div>

            {authorSuccess && (
              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                Saved
              </span>
            )}
          </div>

          <form onSubmit={handleSaveAuthor} className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-slate-400 mb-1">Author Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-mono text-slate-400 mb-1">Instagram Handle</label>
                <input
                  type="text"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-slate-400 mb-1">Headline &amp; Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500"
              />
            </div>

            <div>
              <label className="block font-mono text-slate-400 mb-1">Short Bio</label>
              <textarea
                rows={2}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-sans"
              />
            </div>

            <div>
              <label className="block font-mono text-slate-400 mb-1">Extended Biography</label>
              <textarea
                rows={3}
                value={extendedBio}
                onChange={(e) => setExtendedBio(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-sans"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block font-mono text-slate-400">
                  Homepage Tagline &amp; Featured Quote
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFeaturedQuote('“I write because the heart keeps a ledger the tongue is too proud to read.”')}
                    className="text-[10px] text-sky-400 hover:text-sky-300 underline font-mono cursor-pointer"
                  >
                    Reset to Default Tagline
                  </button>
                  <button
                    type="button"
                    onClick={() => setFeaturedQuote('')}
                    className="text-[10px] text-slate-500 hover:text-slate-400 underline font-mono cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <input
                type="text"
                value={featuredQuote}
                onChange={(e) => setFeaturedQuote(e.target.value)}
                placeholder="“I write because the heart keeps a ledger the tongue is too proud to read.”"
                className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 italic"
              />
              <p className="text-[11px] text-slate-500 mt-1 font-sans">
                This tagline appears directly beneath the INK &amp; WITNESS title on the homepage.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-slate-400 mb-1">Location</label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-mono text-slate-400 mb-1">Instagram URL</label>
                <input
                  type="url"
                  value={instagramUrl}
                  onChange={(e) => setInstagramUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-mono text-slate-400 mb-1">Custom Avatar URL (Direct Link)</label>
              <input
                type="url"
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
                placeholder="https://..."
                className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={savingAuthor}
              className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm mt-4"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingAuthor ? 'Saving Profile...' : 'Save Author Profile'}</span>
            </button>
          </form>
        </div>
      )}

      {/* 3. M-Pesa Gateway Tab */}
      {activeTab === 'mpesa' && (
        <div className="p-6 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-6 max-w-3xl">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-400">
                <Building2 className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Safaricom Daraja M-Pesa Gateway Configuration</h2>
                <p className="text-[11px] text-slate-400">Manage Buy Goods Till, Paybill, and automated Daraja STK Push credentials</p>
              </div>
            </div>

            {mpesaSuccess && (
              <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" />
                Saved &amp; Synced
              </span>
            )}
          </div>

          {/* Secure Credentials Notice */}
          <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-900/60 text-[11px] text-emerald-200 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold text-white">Secure M-Pesa Rails &amp; Daraja STK Push</p>
              <p className="text-slate-300 leading-relaxed">
                Credentials entered here are securely processed server-side. For automated Instant STK Push, provide your Safaricom Daraja Consumer Key, Secret, and Passkey. Manual SMS code verification continues to work seamlessly as a reliable fallback.
              </p>
            </div>
          </div>

          <form onSubmit={handleSaveMpesa} className="space-y-5 text-xs">
            {/* Payment Channel Type */}
            <div>
              <label className="block font-mono text-slate-400 mb-1.5">Payment Channel Rail</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentType('till')}
                  className={`p-2.5 rounded-xl border text-xs font-mono transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                    paymentType === 'till'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <Smartphone className="w-3.5 h-3.5" />
                  <span>Buy Goods Till (Store &amp; Till)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentType('paybill')}
                  className={`p-2.5 rounded-xl border text-xs font-mono transition-colors cursor-pointer flex items-center justify-center gap-2 ${
                    paymentType === 'paybill'
                      ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-300'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" />
                  <span>Paybill Number</span>
                </button>
              </div>
            </div>

            {/* Till Mode Fields */}
            {paymentType === 'till' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-slate-400 mb-1">M-Pesa Store Number (Head Office)</label>
                  <input
                    type="text"
                    value={storeNumber}
                    onChange={(e) => setStoreNumber(e.target.value)}
                    placeholder="Enter Store / Head Office number"
                    className="w-full px-3 py-2.5 rounded-lg bg-[#080d1a] border border-slate-700 text-sky-400 font-mono text-sm font-bold focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Store / HO: <span className="text-slate-300 font-mono">{storeNumber || 'Not configured'}</span>
                  </p>
                </div>

                <div>
                  <label className="block font-mono text-slate-400 mb-1">Buy Goods Till Number</label>
                  <input
                    type="text"
                    value={tillNumber}
                    onChange={(e) => setTillNumber(e.target.value)}
                    placeholder="Enter Buy Goods Till number"
                    className="w-full px-3 py-2.5 rounded-lg bg-[#080d1a] border border-slate-700 text-emerald-400 font-mono text-sm font-bold focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Till No: <span className="text-slate-300 font-mono">{tillNumber || 'Not configured'}</span>
                  </p>
                </div>
              </div>
            )}

            {/* Paybill Mode Fields */}
            {paymentType === 'paybill' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-slate-400 mb-1">Paybill Business Number</label>
                  <input
                    type="text"
                    value={paybillNumber}
                    onChange={(e) => setPaybillNumber(e.target.value)}
                    placeholder="Enter PayBill business number"
                    className="w-full px-3 py-2.5 rounded-lg bg-[#080d1a] border border-slate-700 text-emerald-400 font-mono text-sm font-bold focus:outline-none focus:border-emerald-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Business Paybill: <span className="text-slate-300 font-mono">{paybillNumber || 'Not configured'}</span>
                  </p>
                </div>

                <div>
                  <label className="block font-mono text-slate-400 mb-1">Account Reference</label>
                  <input
                    type="text"
                    value={accountReference}
                    onChange={(e) => setAccountReference(e.target.value)}
                    placeholder="INK_WITNESS"
                    className="w-full px-3 py-2.5 rounded-lg bg-[#080d1a] border border-slate-700 text-sky-400 font-mono text-sm font-bold focus:outline-none focus:border-sky-500"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Ref: <span className="text-slate-300 font-mono">{accountReference}</span>
                  </p>
                </div>
              </div>
            )}

            {/* General Fields */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-mono text-slate-400 mb-1">Registered Business / Till Name</label>
                <input
                  type="text"
                  value={tillName}
                  onChange={(e) => setTillName(e.target.value)}
                  placeholder="Ink & Witness / Jake"
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-white focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block font-mono text-slate-400 mb-1">Default Monograph Price (KES)</label>
                <input
                  type="number"
                  min={1}
                  step={10}
                  value={defaultPriceKes}
                  onChange={(e) => setDefaultPriceKes(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-[#080d1a] border border-slate-700 text-emerald-400 font-mono font-bold focus:outline-none focus:border-emerald-500"
                />
                <p className="text-[10px] text-slate-500 mt-1 font-mono">
                  Default price for newly created paid monographs (e.g. KES 1,050). Minimum: KES 1.
                </p>
              </div>
            </div>

            {/* LIVE Daraja Environment Notice */}
            <div className="p-3.5 rounded-xl bg-emerald-950/40 border border-emerald-800/50 text-xs text-emerald-200 flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-white">Safaricom LIVE / Production Daraja Integration</p>
                <p className="text-slate-300 text-[11px] leading-relaxed">
                  Direct API connection to <strong className="text-emerald-400 font-mono">api.safaricom.co.ke</strong>. Credentials remain backend-only. Request acceptance does not prove handset delivery; the checkout waits for Safaricom's status or callback before reporting success.
                </p>
              </div>
            </div>

            {/* Daraja STK Push API Credentials Vault */}
            <div className="p-4 rounded-xl bg-[#080d1a] border border-slate-800 space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-emerald-400" />
                  <h3 className="font-semibold text-white text-xs">LIVE Daraja API Credentials (STK Push)</h3>
                </div>
                <div className="flex items-center gap-2">
                  {mpesaHasKey && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-[10px] font-mono text-emerald-400">
                      Key Active
                    </span>
                  )}
                  {mpesaHasSecret && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-[10px] font-mono text-emerald-400">
                      Secret Active
                    </span>
                  )}
                  {mpesaHasPasskey && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800 text-[10px] font-mono text-emerald-400">
                      Passkey Active
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-slate-400 mb-1">Live Consumer Key</label>
                  <input
                    type="text"
                    value={mpesaConsumerKey}
                    onChange={(e) => setMpesaConsumerKey(e.target.value)}
                    placeholder={mpesaHasKey ? "•••••••••••••••• (Leave unchanged to keep)" : "Enter Live Consumer Key"}
                    className="w-full px-3 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-mono text-slate-400 mb-1">Live Consumer Secret</label>
                  <input
                    type="password"
                    value={mpesaConsumerSecret}
                    onChange={(e) => setMpesaConsumerSecret(e.target.value)}
                    placeholder={mpesaHasSecret ? "•••••••••••••••• (Leave unchanged to keep)" : "Enter Live Consumer Secret"}
                    className="w-full px-3 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block font-mono text-slate-400 mb-1">Live Online Passkey (Lipa Na M-Pesa Online)</label>
                  <input
                    type="password"
                    value={mpesaPasskey}
                    onChange={(e) => setMpesaPasskey(e.target.value)}
                    placeholder={mpesaHasPasskey ? "•••••••••••••••• (Leave unchanged to keep)" : "Enter Live Daraja Passkey"}
                    className="w-full px-3 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block font-mono text-slate-400 mb-1">Business Shortcode / Store Number</label>
                  <input
                    type="text"
                    value={shortcode}
                    onChange={(e) => setShortcode(e.target.value)}
                    placeholder="Enter the registered business shortcode"
                    className="w-full px-3 py-2 rounded-lg bg-[#0b1120] border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              {/* Live Webhook Callback Endpoint */}
              <div className="p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-400">
                <span className="text-slate-500 block mb-0.5">Live Daraja Production HTTPS Callback URL:</span>
                <span className="text-emerald-400 select-all font-bold">
                  {typeof window !== 'undefined' ? `${window.location.origin}/api/mpesa/callback` : '/api/mpesa/callback'}
                </span>
              </div>

              {/* Daraja Test Connection Button */}
              <div className="pt-2 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleTestMpesa}
                  disabled={testingMpesa}
                  className="px-3.5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-800/60 font-mono text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${testingMpesa ? 'animate-spin' : ''}`} />
                  <span>{testingMpesa ? 'Testing OAuth...' : 'Test Safaricom Daraja OAuth'}</span>
                </button>

                {mpesaTestResult && (
                  <div className={`p-2 rounded-lg text-[11px] font-mono flex items-center gap-1.5 ${
                    mpesaTestResult.status === 'success'
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-300'
                      : 'bg-rose-950/80 border border-rose-800 text-rose-300'
                  }`}>
                    {mpesaTestResult.status === 'success' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                    )}
                    <span>{mpesaTestResult.message}</span>
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={savingMpesa}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm mt-2"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingMpesa ? 'Saving Gateway...' : 'Save & Sync M-Pesa Settings'}</span>
            </button>
          </form>
        </div>
      )}

      {/* 4. Backup & Export Tab */}
      {activeTab === 'backup' && (
        <div className="space-y-6 max-w-3xl">
          {/* Status Banners */}
          {snapshotSuccess && (
            <div className="p-4 rounded-xl bg-emerald-950/70 border border-emerald-800 text-emerald-200 text-xs flex items-center gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{snapshotSuccess}</span>
            </div>
          )}

          {snapshotError && (
            <div className="p-4 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-200 text-xs flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{snapshotError}</span>
            </div>
          )}

          {/* Permanent Baseline & Multi-Tier Persistence Architecture */}
          <div className="p-6 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-sky-950/80 border border-sky-800/80 text-sky-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Permanent Baseline &amp; Multi-Tier Storage</h2>
                  <p className="text-[11px] text-slate-400">Continuous cloud persistence, atomic disk cache &amp; automated snapshots</p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-[10px] font-mono font-medium flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                Baseline Protected
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-mono text-sky-400 font-semibold uppercase tracking-wider block">Primary Storage</span>
                <p className="text-xs font-medium text-white">Google Cloud Firestore</p>
                <p className="text-[11px] text-slate-400">Permanent database syncing all pieces, licenses, &amp; settings</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-mono text-indigo-400 font-semibold uppercase tracking-wider block">Local Cache</span>
                <p className="text-xs font-medium text-white">Atomic JSON Store</p>
                <p className="text-[11px] text-slate-400">Instant-read memory cache with safe temporary file write commits</p>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800/80 space-y-1">
                <span className="text-[10px] font-mono text-emerald-400 font-semibold uppercase tracking-wider block">Protection</span>
                <p className="text-xs font-medium text-white">Rolling Snapshots</p>
                <p className="text-[11px] text-slate-400">Automated baseline preservation and point-in-time rollbacks</p>
              </div>
            </div>

            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-slate-400">
                Synchronizes all active in-memory monographs, articles, author data, and gateway configs straight to Cloud Firestore and creates an immutable disk recovery point.
              </p>
              <button
                type="button"
                id="settings-save-permanently-btn"
                onClick={handleSavePermanently}
                disabled={savingPermanently}
                className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer shadow-md shrink-0"
              >
                <ShieldCheck className={`w-4 h-4 ${savingPermanently ? 'animate-spin' : ''}`} />
                <span>{savingPermanently ? 'Saving Baseline Permanently...' : 'Save Permanently to Cloud'}</span>
              </button>
            </div>
          </div>

          {/* Point-in-Time Snapshots & Rollback Recovery */}
          <div className="p-6 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-indigo-950/80 border border-indigo-800/80 text-indigo-400">
                  <History className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-white">Point-in-Time Snapshots</h2>
                  <p className="text-[11px] text-slate-400">Instant restore points created automatically and on-demand</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCreateSnapshot}
                disabled={creatingSnapshot}
                className="px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm shrink-0"
              >
                <Database className={`w-3.5 h-3.5 ${creatingSnapshot ? 'animate-spin' : ''}`} />
                <span>{creatingSnapshot ? 'Creating Snapshot...' : 'Create Snapshot Now'}</span>
              </button>
            </div>

            {loadingSnapshots ? (
              <div className="py-6 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Loading recovery snapshots...</span>
              </div>
            ) : snapshots.length === 0 ? (
              <p className="text-xs text-slate-500 py-4 text-center">
                No snapshots saved yet. Click "Create Snapshot Now" to save a permanent restore point.
              </p>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {snapshots.map((snap) => (
                  <div
                    key={snap.filename}
                    className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileJson className="w-4 h-4 text-indigo-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-mono text-[11px] text-slate-200 truncate">{snap.filename}</p>
                        <p className="text-[10px] text-slate-500">{snap.formattedDate} • {(snap.sizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRestoreSnapshot(snap.filename)}
                      disabled={restoringSnapshot === snap.filename}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-indigo-950 hover:text-indigo-300 text-slate-300 border border-slate-700 font-medium text-[11px] flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50 shrink-0"
                    >
                      <RotateCcw className={`w-3 h-3 ${restoringSnapshot === snap.filename ? 'animate-spin' : ''}`} />
                      <span>{restoringSnapshot === snap.filename ? 'Restoring...' : 'Restore'}</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Export & Upload Archive */}
          <div className="p-6 rounded-2xl bg-[#0b1120] border border-slate-800 space-y-4">
            <div className="flex items-center gap-2.5 pb-3 border-b border-slate-800">
              <div className="p-2 rounded-lg bg-emerald-950/80 border border-emerald-800/80 text-emerald-400">
                <Download className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-white">Manual Export &amp; File Import</h2>
                <p className="text-[11px] text-slate-400">Download a portable JSON archive or upload an existing backup</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <button
                type="button"
                onClick={handleExportBackup}
                disabled={exporting}
                className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-sky-400 border border-sky-800/60 font-medium text-xs flex items-center justify-center gap-2 transition-colors disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{exporting ? 'Generating JSON...' : 'Download JSON Archive'}</span>
              </button>

              <label className="w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-400 border border-emerald-800/60 font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm">
                <Upload className="w-3.5 h-3.5" />
                <span>{restoringSnapshot === 'upload' ? 'Restoring File...' : 'Upload & Restore JSON'}</span>
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={handleFileUploadRestore}
                  disabled={restoringSnapshot !== null}
                />
              </label>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

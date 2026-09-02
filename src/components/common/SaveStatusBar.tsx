import React from 'react';
import { Save, Check, AlertCircle, Loader2 } from 'lucide-react';

interface SaveStatusBarProps {
  onSave: () => void | Promise<void>;
  isDirty: boolean;
  isSaving: boolean;
  lastSavedAt: string | null;
  errorMessage?: string | null;
  saveButtonText?: string;
  className?: string;
  idPrefix?: string;
  disabled?: boolean;
}

export const SaveStatusBar: React.FC<SaveStatusBarProps> = ({
  onSave,
  isDirty,
  isSaving,
  lastSavedAt,
  errorMessage,
  saveButtonText = 'SAVE CHANGES',
  className = '',
  idPrefix = 'save-status',
  disabled = false
}) => {
  const formatSavedTime = (isoString: string | null) => {
    if (!isoString) return null;
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return null;
    }
  };

  const formattedTime = formatSavedTime(lastSavedAt);

  return (
    <div
      id={`${idPrefix}-bar`}
      className={`flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4 rounded-xl bg-slate-900/95 border border-slate-800 backdrop-blur-md shadow-lg ${className}`}
    >
      {/* Left side: Status indicators */}
      <div className="flex items-center flex-wrap gap-2.5 text-xs font-mono">
        {isSaving ? (
          <div className="flex items-center gap-2 text-sky-400 bg-sky-950/60 px-3 py-1.5 rounded-lg border border-sky-800/60 animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
            <span className="font-semibold">Saving changes to persistent storage...</span>
          </div>
        ) : errorMessage ? (
          <div className="flex items-center gap-2 text-rose-300 bg-rose-950/70 px-3 py-1.5 rounded-lg border border-rose-800/80">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span className="font-medium">Couldn't save your changes. Please try again.</span>
          </div>
        ) : isDirty ? (
          <div className="flex items-center gap-2 text-amber-300 bg-amber-950/70 px-3 py-1.5 rounded-lg border border-amber-800/80">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-semibold">Unsaved changes</span>
          </div>
        ) : lastSavedAt ? (
          <div className="flex items-center gap-2 text-emerald-300 bg-emerald-950/60 px-3 py-1.5 rounded-lg border border-emerald-800/70">
            <Check className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold">Saved ✓</span>
            {formattedTime && (
              <span className="text-emerald-400/80 font-normal">at {formattedTime}</span>
            )}
          </div>
        ) : (
          <div className="text-slate-400 text-xs font-mono">
            All changes saved to persistent storage.
          </div>
        )}
      </div>

      {/* Right side: Prominent SAVE CHANGES Button */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          id={`${idPrefix}-save-btn`}
          onClick={onSave}
          disabled={isSaving || disabled}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold tracking-wider uppercase transition-all shadow-md cursor-pointer ${
            isSaving || disabled
              ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
              : isDirty
              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-950/80 ring-2 ring-emerald-500/40 hover:scale-[1.02]'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 hover:border-slate-600'
          }`}
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin text-white" />
          ) : (
            <Save className={`w-4 h-4 ${isDirty ? 'text-white' : 'text-emerald-400'}`} />
          )}
          <span>{isSaving ? 'SAVING...' : saveButtonText}</span>
        </button>
      </div>
    </div>
  );
};

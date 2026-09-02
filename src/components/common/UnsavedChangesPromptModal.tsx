import React from 'react';
import { AlertTriangle, Save, LogOut, X, Loader2 } from 'lucide-react';

interface UnsavedChangesPromptModalProps {
  isOpen: boolean;
  isSaving?: boolean;
  onSaveChanges: () => void | Promise<void>;
  onLeaveWithoutSaving: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
}

export const UnsavedChangesPromptModal: React.FC<UnsavedChangesPromptModalProps> = ({
  isOpen,
  isSaving = false,
  onSaveChanges,
  onLeaveWithoutSaving,
  onCancel,
  title = 'You have unsaved changes. Save before leaving?',
  description = 'Any unpersisted edits or modifications will be lost if you leave without saving.'
}) => {
  if (!isOpen) return null;

  return (
    <div
      id="unsaved-changes-prompt-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl p-6 overflow-hidden">
        {/* Top Warning Badge */}
        <div className="flex items-start gap-4 mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-950/80 border border-amber-600/70 flex items-center justify-center shrink-0 text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
              {title}
            </h3>
            <p className="mt-1.5 text-xs text-slate-300 leading-relaxed font-sans">
              {description}
            </p>
          </div>
        </div>

        {/* Action Buttons: 3 Options */}
        <div className="mt-6 flex flex-col gap-2.5">
          {/* 1. Save Changes (Primary) */}
          <button
            type="button"
            id="unsaved-modal-save-btn"
            onClick={onSaveChanges}
            disabled={isSaving}
            className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/60 transition-all cursor-pointer disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin text-white" />
            ) : (
              <Save className="w-4 h-4 text-emerald-100" />
            )}
            <span>{isSaving ? 'Saving Changes...' : 'Save Changes'}</span>
          </button>

          {/* 2. Leave Without Saving */}
          <button
            type="button"
            id="unsaved-modal-leave-btn"
            onClick={onLeaveWithoutSaving}
            disabled={isSaving}
            className="w-full py-2.5 px-4 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 hover:text-white font-mono text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <LogOut className="w-4 h-4 text-rose-400" />
            <span>Leave Without Saving</span>
          </button>

          {/* 3. Cancel */}
          <button
            type="button"
            id="unsaved-modal-cancel-btn"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
          >
            <X className="w-4 h-4 text-slate-400" />
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
};

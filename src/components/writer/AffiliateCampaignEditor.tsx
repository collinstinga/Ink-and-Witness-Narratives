import React, { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AffiliateCampaign, Article } from '../../types.js';
import { buildAffiliateCampaignUpdate, createAffiliateCampaignDraft } from '../../utils/affiliateCampaignEditor.js';

interface Props {
  campaign?: AffiliateCampaign;
  articles: Pick<Article, 'id' | 'title'>[];
  onSave: (update: Partial<AffiliateCampaign> & { code: string; name: string }) => Promise<void>;
  onClose: () => void;
}

const inputClass = 'mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none';

export function AffiliateCampaignEditor({ campaign, articles, onSave, onClose }: Props) {
  const [draft, setDraft] = useState(() => createAffiliateCampaignDraft(campaign));
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const previousFocus = document.activeElement;
    dialogRef.current?.showModal();
    return () => { if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus(); };
  }, []);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    setError('');
    try {
      const update = buildAffiliateCampaignUpdate(draft, campaign);
      savingRef.current = true;
      setSaving(true);
      await onSave(update);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Campaign could not be saved. Your edits are still here.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  const missingPieceIds = draft.eligiblePieceIds.filter(pieceId => !articles.some(article => article.id === pieceId));
  return (
    <dialog ref={dialogRef} aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}
      onCancel={event => { event.preventDefault(); if (!savingRef.current) onClose(); }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-xl overflow-y-auto rounded-2xl border border-cyan-700/80 bg-[#0a0f1d] p-5 text-slate-200 shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 id={`${id}-title`} className="font-serif text-lg font-bold text-white">{campaign ? 'Edit' : 'Create'} Promotional Campaign</h3>
        <button type="button" aria-label="Close campaign editor" disabled={saving} onClick={onClose} className="rounded-lg p-2 text-slate-400 disabled:opacity-50"><X className="h-5 w-5" /></button>
      </div>
      <p id={`${id}-help`} className="mb-4 text-xs text-slate-400">Changes apply to future activity, not commissions already earned. Dates use your device timezone. Email delivery remains controlled separately.</p>
      <form onSubmit={save} className="space-y-4">
        <fieldset disabled={saving} className="space-y-4 disabled:opacity-60">
          <label className="block text-xs">Campaign code (permanent referral tag)
            <input className={inputClass} required maxLength={64} pattern="[A-Za-z0-9][A-Za-z0-9_]*" readOnly={Boolean(campaign)} value={draft.code}
              onChange={event => setDraft(current => ({ ...current, code: event.target.value }))} />
          </label>
          <label className="block text-xs">Campaign name
            <input className={inputClass} required maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} />
          </label>
          <label className="block text-xs">Description
            <textarea className={inputClass} maxLength={2000} rows={3} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} />
          </label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs">Commission rate (%)
              <input className={inputClass} type="number" required min={0.01} max={100} step={0.01} value={draft.commissionRate} onChange={event => setDraft(current => ({ ...current, commissionRate: event.target.value }))} />
            </label>
            <label className="text-xs">Attribution window (days)
              <input className={inputClass} type="number" required min={1} max={90} step={1} value={draft.attributionDays} onChange={event => setDraft(current => ({ ...current, attributionDays: event.target.value }))} />
            </label>
            <label className="text-xs">Starts
              <input className={inputClass} type="datetime-local" required step="any" value={draft.startDate} onChange={event => setDraft(current => ({ ...current, startDate: event.target.value }))} />
            </label>
            <label className="text-xs">Ends
              <input className={inputClass} type="datetime-local" required step="any" value={draft.endDate} onChange={event => setDraft(current => ({ ...current, endDate: event.target.value }))} />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={draft.isActive} onChange={event => setDraft(current => ({ ...current, isActive: event.target.checked }))} />Campaign enabled</label>
          <fieldset className="space-y-2 rounded-xl border border-slate-800 p-3">
            <legend className="px-1 text-xs">Eligible pieces</legend>
            <p className="text-xs text-slate-400">No selections means all pieces, including future releases.</p>
            <button type="button" onClick={() => setDraft(current => ({ ...current, eligiblePieceIds: [] }))} className="min-h-11 text-xs text-cyan-300 underline">Use all pieces</button>
            <div className="max-h-44 overflow-y-auto">
              {[...articles, ...missingPieceIds.map(pieceId => ({ id: pieceId, title: `Unavailable piece (${pieceId})` }))].map(article => (
                <label key={article.id} className="flex min-h-11 items-center gap-3 text-xs">
                  <input type="checkbox" checked={draft.eligiblePieceIds.includes(article.id)} onChange={event => setDraft(current => ({ ...current,
                    eligiblePieceIds: event.target.checked ? [...current.eligiblePieceIds, article.id] : current.eligiblePieceIds.filter(pieceId => pieceId !== article.id),
                  }))} />{article.title}
                </label>
              ))}
            </div>
          </fieldset>
        </fieldset>
        {error ? <p role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p> : null}
        <div className="flex gap-3">
          <button type="button" disabled={saving} onClick={onClose} className="min-h-11 flex-1 rounded-xl bg-slate-800 text-sm disabled:opacity-50">Cancel</button>
          <button type="submit" disabled={saving} className="min-h-11 flex-1 rounded-xl bg-cyan-600 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving…' : campaign ? 'Save campaign' : 'Create campaign'}</button>
        </div>
      </form>
    </dialog>
  );
}

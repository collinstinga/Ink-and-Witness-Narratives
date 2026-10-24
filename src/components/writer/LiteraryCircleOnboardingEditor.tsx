import React, { useMemo } from 'react';
import type { Article, LiteraryCircleOnboardingContent } from '../../types.js';
import { normalizeLiteraryCircleOnboardingContent, publishedOnboardingPieces } from '../../utils/literaryCircleOnboarding.js';

interface Props {
  value?: LiteraryCircleOnboardingContent;
  articles?: Article[];
  disabled?: boolean;
  onChange: (value: LiteraryCircleOnboardingContent) => void;
}
const fieldClass = 'mt-1.5 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-300';
const NO_ARTICLES: Article[] = [];

export function LiteraryCircleOnboardingEditor({ value, articles = NO_ARTICLES, disabled = false, onChange }: Props) {
  const content = useMemo(() => value || normalizeLiteraryCircleOnboardingContent(undefined), [value]);
  const published = useMemo(() => publishedOnboardingPieces(articles), [articles]);
  const publishedIds = useMemo(() => new Set(published.map(piece => piece.id)), [published]);
  const unavailableSelections = content.recommendedPieceIds.some(id => !publishedIds.has(id));
  const update = (patch: Partial<LiteraryCircleOnboardingContent>) => onChange({ ...content, ...patch });
  const choosePiece = (index: number, id: string) => {
    const ids = [...content.recommendedPieceIds];
    ids[index] = id;
    update({ recommendedPieceIds: ids.filter(Boolean) });
  };
  return (
    <section aria-labelledby="circle-onboarding-editor-heading" className="rounded-2xl border border-cyan-300/20 bg-slate-900/60 p-4 sm:p-6">
      <h3 id="circle-onboarding-editor-heading" className="font-serif text-xl font-bold text-white">Partner welcome &amp; first reads</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">Edit the guide and curate up to three published pieces. Saving changes the copy only: completed steps, account privileges and financial arrangements stay intact.</p>
      <fieldset disabled={disabled} className="mt-4 space-y-4 disabled:opacity-60">
        <legend className="sr-only">Literary Circle onboarding content</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-xs font-semibold text-slate-300">New partner welcome title
            <input value={content.welcomeTitle} maxLength={120} className={fieldClass} onChange={event => update({ welcomeTitle: event.target.value })} />
          </label>
          <label className="text-xs font-semibold text-slate-300">Existing partner upgrade title
            <input value={content.upgradeTitle} maxLength={120} className={fieldClass} onChange={event => update({ upgradeTitle: event.target.value })} />
          </label>
        </div>
        <label className="block text-xs font-semibold text-slate-300">Introductory message (optional)
          <textarea value={content.description} maxLength={600} rows={3} className={fieldClass} placeholder="Leave blank to keep the original audience-specific introduction." onChange={event => update({ description: event.target.value })} />
        </label>
        <details className="rounded-xl border border-slate-700 bg-slate-950/40 p-3">
          <summary className="min-h-10 cursor-pointer text-sm font-semibold text-cyan-200">Edit the eight guided steps</summary>
          <div className="mt-3 space-y-4">
            {content.steps.map((step, index) => (
              <div key={step.id} className="rounded-xl border border-slate-700/70 p-3">
                <p className="font-mono text-[10px] text-slate-500">Step {index + 1} · stable progress ID: {step.id}</p>
                <label className="mt-2 block text-xs text-slate-300">Step {index + 1} title
                  <input value={step.title} maxLength={120} className={fieldClass} onChange={event => update({ steps: content.steps.map(item => item.id === step.id ? { ...item, title: event.target.value } : item) })} />
                </label>
                <label className="mt-2 block text-xs text-slate-300">Step {index + 1} description
                  <textarea value={step.description} maxLength={600} rows={3} className={fieldClass} onChange={event => update({ steps: content.steps.map(item => item.id === step.id ? { ...item, description: event.target.value } : item) })} />
                </label>
              </div>
            ))}
          </div>
        </details>
        <div>
          <h4 className="text-sm font-semibold text-white">Recommended first reads</h4>
          <p className="mt-1 text-xs text-slate-400">Only published pieces appear here. Leave every slot empty to use the published catalogue order.</p>
          {unavailableSelections ? <p role="status" className="mt-2 text-xs text-amber-200">A saved selection is no longer published. It is hidden from partners; choose a replacement or clear its slot.</p> : null}
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map(index => (
              <label key={index} className="text-xs text-slate-300">Recommended piece {index + 1}
                <select value={content.recommendedPieceIds[index] || ''} className={fieldClass} onChange={event => choosePiece(index, event.target.value)}>
                  <option value="">No selection</option>
                  {content.recommendedPieceIds[index] && !publishedIds.has(content.recommendedPieceIds[index]) ? <option value={content.recommendedPieceIds[index]}>Unavailable saved selection — replace or clear</option> : null}
                  {published.map(piece => <option key={piece.id} value={piece.id} disabled={content.recommendedPieceIds.includes(piece.id) && content.recommendedPieceIds[index] !== piece.id}>{piece.title}</option>)}
                </select>
              </label>
            ))}
          </div>
        </div>
      </fieldset>
    </section>
  );
}

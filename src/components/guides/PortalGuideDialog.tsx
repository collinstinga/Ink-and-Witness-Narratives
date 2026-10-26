import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ArrowRight, BookOpen, Search, X } from 'lucide-react';
import type { PortalGuideDefinition, PortalGuideSection } from '../../data/portalGuideTypes.js';
import { containPortalGuideKeyboardEvent } from './portalGuideFocus.js';

export interface PortalGuideDialogProps {
  guide: PortalGuideDefinition;
  open: boolean;
  onClose: () => void;
  onNavigate?: (destination: string) => void;
  navigationNotice?: string;
}

function searchableText(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function filterPortalGuideSections(sections: PortalGuideSection[], query: string): PortalGuideSection[] {
  const words = searchableText(query.slice(0, 160)).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return sections;
  return sections.filter(section => {
    const text = searchableText([
      section.title, section.summary, ...(section.keywords || []),
      ...section.steps, ...(section.notes || []), section.destinationLabel || '',
    ].join(' '));
    return words.every(word => text.includes(word));
  });
}

/** Kept separate from the modal so static content/search can be verified without a browser. */
export function PortalGuidePanel({
  guide, onClose, onNavigate, navigationNotice, initialQuery = '',
}: Omit<PortalGuideDialogProps, 'open'> & { initialQuery?: string }) {
  const [query, setQuery] = useState(initialQuery.slice(0, 160));
  const [selectedId, setSelectedId] = useState(guide.sections[0]?.id || '');
  const [demoStep, setDemoStep] = useState<number | null>(null);
  const instanceId = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const results = filterPortalGuideSections(guide.sections, query);
  const selected = results.find(section => section.id === selectedId) || results[0];
  const titleId = `${instanceId}-title`;
  const sectionTitleId = `${instanceId}-section-title`;
  const journey = guide.journey.filter(step => guide.sections.some(section => section.id === step.sectionId));
  const currentDemo = demoStep === null ? null : journey[demoStep];

  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus({ preventScroll: true });
  }, [selected?.id]);

  const chooseTopic = (id: string) => {
    focusHeading.current = true;
    setSelectedId(id);
    setDemoStep(null);
    if (id === selected?.id) {
      focusHeading.current = false;
      headingRef.current?.focus({ preventScroll: true });
    }
  };
  const showDemo = (index: number) => {
    const step = journey[index];
    if (!step) return;
    setQuery('');
    setSelectedId(step.sectionId);
    setDemoStep(index);
  };

  return (
    <div className="flex h-full min-h-0 flex-col text-slate-100">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-700 p-4 sm:p-5">
        <div className="min-w-0">
          <p className="mb-1 text-xs font-mono uppercase tracking-wider text-cyan-300">Permanent help · guide &amp; demo</p>
          <h2 id={titleId} className="font-serif text-xl font-bold sm:text-2xl">{guide.title}</h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-300">{guide.intro}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close guide and return to your dashboard"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-600 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-300">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="border-b border-slate-800 p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-2xl text-sm text-slate-300">Read at your own pace. Reopen this guide any time. The demo explains the workflow; it never saves, sends, pays or changes your account.</p>
            {journey.length > 0 && <button type="button" onClick={() => showDemo(0)}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-cyan-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300">
              <BookOpen aria-hidden="true" className="h-4 w-4" />{currentDemo ? 'Restart demo' : 'Start safe demo'}
            </button>}
          </div>
          {currentDemo && demoStep !== null && <section aria-label="Safe demo walkthrough" className="mt-4 rounded-xl border border-cyan-700 bg-cyan-950/40 p-4">
            <p role="status" className="text-xs font-mono text-cyan-300">Demo step {demoStep + 1} of {journey.length} · no account changes</p>
            <h3 className="mt-2 font-semibold">{currentDemo.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-300">{currentDemo.description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={demoStep === 0} onClick={() => showDemo(demoStep - 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-600 px-3 text-sm disabled:opacity-40"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Back</button>
              {demoStep < journey.length - 1
                ? <button type="button" onClick={() => showDemo(demoStep + 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-cyan-400 px-3 text-sm font-semibold text-slate-950">Next<ArrowRight aria-hidden="true" className="h-4 w-4" /></button>
                : <button type="button" onClick={() => setDemoStep(null)} className="min-h-11 rounded-lg bg-cyan-400 px-3 text-sm font-semibold text-slate-950">Finish demo</button>}
              <button type="button" onClick={() => setDemoStep(null)} className="min-h-11 rounded-lg px-3 text-sm text-slate-300 underline">Exit demo</button>
            </div>
          </section>}
        </div>
        <div className="flex flex-col md:flex-row">
          <aside className="shrink-0 border-b border-slate-800 p-4 md:w-72 md:border-b-0 md:border-r sm:p-5">
            <label htmlFor={`${instanceId}-search`} className="mb-2 block text-sm font-semibold">Find a feature or task</label>
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" />
              <input id={`${instanceId}-search`} type="search" value={query} maxLength={160}
                onChange={event => { setQuery(event.target.value); setDemoStep(null); }}
                placeholder="Search this guide…" className="min-h-11 w-full rounded-xl border border-slate-600 bg-slate-950 py-2 pl-9 pr-3 text-sm focus:border-cyan-300 focus:outline-none" />
            </div>
            <p role="status" aria-live="polite" className="my-3 text-xs text-slate-400">{results.length} {results.length === 1 ? 'topic' : 'topics'} found</p>
            <nav aria-label={`${guide.title} topics`} className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:overflow-visible">
              {results.map(section => <button key={section.id} type="button" aria-pressed={selected?.id === section.id} onClick={() => chooseTopic(section.id)}
                className={`min-h-11 shrink-0 rounded-xl border px-3 py-2 text-left text-sm md:shrink ${selected?.id === section.id ? 'border-cyan-600 bg-cyan-950 text-cyan-200' : 'border-slate-700 bg-slate-900 hover:bg-slate-800'}`}>
                {section.title}
              </button>)}
            </nav>
          </aside>
          <main className="min-w-0 flex-1 p-4 sm:p-6">
            {selected ? <article aria-labelledby={sectionTitleId}>
              <h3 ref={headingRef} tabIndex={-1} id={sectionTitleId} className="font-serif text-2xl font-bold focus:outline-none">{selected.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">{selected.summary}</p>
              <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-relaxed marker:font-bold marker:text-cyan-300">
                {selected.steps.map((step, index) => <li key={index} className="pl-1">{step}</li>)}
              </ol>
              {!!selected.notes?.length && <aside aria-label="Important notes" className="mt-5 rounded-xl border border-slate-700 bg-slate-900 p-4">
                <h4 className="text-sm font-semibold text-cyan-200">Keep in mind</h4>
                <ul className="mt-2 list-disc space-y-2 pl-4 text-sm leading-relaxed text-slate-300">{selected.notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
              </aside>}
              {navigationNotice && <p className="mt-5 text-sm text-amber-200">{navigationNotice}</p>}
              {onNavigate && selected.destination && <button type="button" onClick={() => { onNavigate(selected.destination!); onClose(); }}
                className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-xl border border-cyan-600 bg-cyan-950 px-4 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-900">
                {selected.destinationLabel || 'Open this section'}<ArrowRight aria-hidden="true" className="h-4 w-4" />
              </button>}
            </article> : <div role="status" className="rounded-xl border border-slate-700 p-5">
              <p>No matching topics. Try a shorter phrase, or browse every topic.</p>
              <button type="button" onClick={() => setQuery('')} className="mt-3 min-h-11 rounded-lg border border-cyan-700 px-3 text-cyan-200">Clear search</button>
            </div>}
          </main>
        </div>
      </div>
    </div>
  );
}

/** Native modal supplies focus containment, inert background and Escape support. */
export function PortalGuideDialog(props: PortalGuideDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(props.onClose);
  closeRef.current = props.onClose;
  useEffect(() => {
    if (!props.open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [props.open]);
  if (!props.open) return null;
  const dialog = <dialog ref={dialogRef} aria-label={props.guide.title}
    onCancel={event => { event.preventDefault(); closeRef.current(); }}
    onClick={event => event.stopPropagation()}
    onKeyDown={containPortalGuideKeyboardEvent}
    className="m-auto h-[90dvh] max-h-[56rem] w-[calc(100%-1.5rem)] max-w-5xl overflow-hidden rounded-2xl border border-slate-600 bg-slate-950 p-0 text-slate-100 shadow-2xl backdrop:bg-black/80">
    <PortalGuidePanel {...props} />
  </dialog>;
  return typeof document === 'undefined' ? dialog : createPortal(dialog, document.body);
}

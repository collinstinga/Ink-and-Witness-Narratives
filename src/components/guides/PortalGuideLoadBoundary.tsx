import React, { Component, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  onClose: () => void;
  children: React.ReactNode;
}

function GuideStatusDialog({ onClose, title, children }: Pick<Props, 'onClose' | 'children'> & { title: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  const content = <dialog ref={dialogRef} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-600 bg-slate-950 p-6 text-slate-100 backdrop:bg-black/80">
    <h2 className="font-serif text-xl font-bold">{title}</h2>
    {children}
  </dialog>;
  return typeof document === 'undefined' ? content : createPortal(content, document.body);
}

function GuideLoadError({ onClose }: Pick<Props, 'onClose'>) {
  return <GuideStatusDialog onClose={onClose} title="Guide could not load">
    <p className="mt-3 text-sm leading-relaxed text-slate-300">Your current work is still open. Close this message, save any unfinished edits, then reload the page and reopen Guide &amp; Demo.</p>
    <button type="button" onClick={onClose} className="mt-5 min-h-11 rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-950">Close help and keep working</button>
  </GuideStatusDialog>;
}

export function PortalGuideLoading({ onClose }: Pick<Props, 'onClose'>) {
  return <GuideStatusDialog onClose={onClose} title="Loading Guide & Demo">
    <p role="status" className="mt-3 text-sm text-slate-300">Opening your permanent guide. Your current form remains unchanged.</p>
    <button type="button" onClick={onClose} className="mt-5 min-h-11 rounded-xl border border-cyan-500 px-4 py-2 text-cyan-200">Close guide</button>
  </GuideStatusDialog>;
}

/** A failed lazy help chunk must not unmount the editor/account forms. */
export class PortalGuideLoadBoundary extends Component<Props, { failed: boolean }> {
  declare readonly props: Props;
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <GuideLoadError onClose={this.props.onClose} /> : this.props.children;
  }
}

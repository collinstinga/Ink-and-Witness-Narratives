import React, { useEffect, useRef, useState } from 'react';
import type { Article, ReaderAccountAdminItem, ReaderAccountAdminPage } from '../../types.js';
import { api } from '../../utils/api.js';

function dateLabel(value: string): string {
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-KE') : 'Not recorded';
}

export type ReaderGrantPiece = Pick<Article, 'id' | 'title' | 'status'>;
export function canGrantReaderPiece(reader: ReaderAccountAdminItem): boolean {
  return reader.status === 'active' && /^user_[A-Za-z0-9_-]{8,120}$/.test(reader.id) && Boolean(reader.email.trim());
}
export function publishedReaderGrantPieces(articles: readonly ReaderGrantPiece[]): ReaderGrantPiece[] {
  return [...new Map(articles.filter(article => article.status === 'published' && article.id !== 'all' && article.title.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(article.id)).map(article => [article.id, article])).values()];
}
/** Merge only an explicitly requested page; retain newer local status revisions. */
export function appendReaderAccountPage(previous: ReaderAccountAdminPage | null, next: ReaderAccountAdminPage): ReaderAccountAdminPage {
  if (!previous) return next;
  const readers = new Map(previous.readers.map(reader => [reader.id, reader]));
  for (const reader of next.readers) {
    const existing = readers.get(reader.id);
    if (!existing || reader.revision >= existing.revision) readers.set(reader.id, reader);
  }
  return { ...next, readers: [...readers.values()] };
}

export function ReaderAccountDirectoryView({ directory, loading, busy, error, notice, onRefresh, onNext, onFirst, onSelect, onGrant, hasGrantPieces = false }: {
  directory: ReaderAccountAdminPage | null; loading: boolean; busy: boolean; error: string; notice: string;
  onRefresh: () => void; onNext: () => void; onFirst: () => void; onSelect: (reader: ReaderAccountAdminItem) => void;
  onGrant?: (reader: ReaderAccountAdminItem) => void; hasGrantPieces?: boolean;
}) {
  const remaining = directory ? Math.max(0, directory.matchingReaderAccounts - directory.readers.length) : 0;
  return <div aria-busy={loading || busy}>
    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
      <p className="text-slate-200"><strong className="text-cyan-300 text-2xl">{directory ? directory.totalReaderAccounts : '—'}</strong> registered reader accounts</p>
      <button type="button" onClick={onRefresh} disabled={loading || busy} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">{loading ? 'Loading accounts…' : 'Refresh accounts'}</button>
    </div>
    <p className="text-slate-400 text-sm mb-4">Writer accounts are excluded. Each row is a registered reader account, not a visitor or a purchase. All existing reader accounts can be browsed below, loading up to 25 more at a time. Legacy accounts needing review remain included in the total. Suspension signs the reader out and blocks account access; purchases, licences and reading history remain preserved.</p>
    {error ? <p role="alert" className="text-rose-200 bg-rose-950/40 border border-rose-700 rounded-lg p-3 mb-4">{error}</p> : null}
    {notice ? <p role="status" className="text-emerald-200 mb-4">{notice}</p> : null}
    {directory ? <>
      <p className="text-slate-400 text-sm mb-3">Loaded {directory.readers.length} of {directory.matchingReaderAccounts} matching accounts. {directory.nextCursor
        ? `${remaining} remaining (about ${Math.max(1, Math.ceil(remaining / directory.pageSize))} more ${remaining > directory.pageSize ? 'pages' : 'page'}).`
        : 'All matching accounts are loaded.'} Names and email addresses are visible only in Writer Studio.</p>
      <div className="space-y-3">{directory.readers.map(reader => <article key={reader.id} className="border border-slate-700 rounded-xl p-4 bg-slate-950/40">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h4 className="font-semibold text-slate-100 break-words">{reader.name}</h4><p className="text-cyan-200 break-all">{reader.email || 'Email not recorded'}</p></div>
          <span className={reader.status === 'active' ? 'text-emerald-300' : reader.status === 'suspended' ? 'text-amber-300' : 'text-rose-300'}>{reader.status === 'unavailable' ? 'Status needs review' : reader.status === 'active' ? 'Active' : 'Suspended'}</span>
        </div>
        <p className="text-sm text-slate-400 mt-2">Registered: {dateLabel(reader.createdAt)}</p>
        <details className="text-sm text-slate-400 mt-2"><summary className="cursor-pointer">Account details</summary><p className="break-all mt-1">Account ID: {reader.id}</p>{reader.statusUpdatedAt ? <p>Status updated: {dateLabel(reader.statusUpdatedAt)}</p> : null}{reader.suspensionReason ? <p className="break-words">Writer note: {reader.suspensionReason}</p> : null}</details>
        <div className="mt-3 flex flex-wrap gap-3">
          <button type="button" disabled={loading || busy || reader.status === 'unavailable'} onClick={() => onSelect(reader)} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">{reader.status === 'suspended' ? 'Reactivate account' : 'Suspend account'}</button>
          <button type="button" disabled={loading || busy || !onGrant || !hasGrantPieces || !canGrantReaderPiece(reader)} onClick={() => onGrant?.(reader)} title={reader.status === 'suspended' ? 'Reactivate this account before granting access.' : !hasGrantPieces ? 'Publish a piece before granting access.' : 'Grant a published piece directly to this reader account.'} className="border border-cyan-700 rounded-lg px-4 py-2 text-cyan-200 disabled:opacity-50">Grant piece access</button>
        </div>
      </article>)}</div>
      {!directory.readers.length ? <p className="text-slate-400 py-6">No reader accounts match this page or email address.</p> : null}
      <div className="flex flex-wrap gap-3 mt-4"><button type="button" disabled={loading || busy} onClick={onFirst} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">Refresh from first page</button><button type="button" disabled={loading || busy || !directory.nextCursor} onClick={onNext} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">{loading ? 'Loading accounts…' : 'Load more accounts'}</button></div>
    </> : null}
  </div>;
}

export function ReaderAccountPieceGrantView({ reader, pieces, articleId, confirmed, saving, error, onArticle, onConfirmed, onSave, onCancel }: {
  reader: ReaderAccountAdminItem; pieces: readonly ReaderGrantPiece[]; articleId: string; confirmed: boolean; saving: boolean; error: string;
  onArticle: (id: string) => void; onConfirmed: (value: boolean) => void; onSave: () => void; onCancel: () => void;
}) {
  return <>
    <h4 id="reader-piece-grant-title" className="text-lg font-semibold mb-3">Grant a piece to this reader?</h4>
    <p className="break-words">{reader.name}</p><p className="break-all text-cyan-200 mb-3">{reader.email}</p>
    <p className="text-sm text-slate-300 mb-3">Complimentary access belongs only to this signed-in reader account and the selected piece. No phone number or transferable activation code is created. Existing purchases are not changed, and this is not recorded as a sale or affiliate commission.</p>
    <div className="mb-3">
      <label htmlFor="reader-account-grant-piece" className="block text-sm">Published piece</label>
      <select id="reader-account-grant-piece" value={articleId} disabled={saving} onChange={event => onArticle(event.target.value)} className="block w-full min-w-0 mt-1 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2">
        <option value="">Choose one published piece</option>
        {pieces.map(piece => <option key={piece.id} value={piece.id}>{piece.title}</option>)}
      </select>
    </div>
    <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} disabled={saving} onChange={event => onConfirmed(event.target.checked)} className="mt-1" />I checked this reader&apos;s email address and want to grant this specific piece to their account.</label>
    {error ? <p role="alert" className="text-rose-200 mt-3">{error}</p> : null}
    <div className="flex flex-wrap gap-3 mt-5"><button type="button" disabled={!confirmed || !articleId || saving || !canGrantReaderPiece(reader)} onClick={onSave} className="bg-cyan-700 rounded-lg px-4 py-2 disabled:opacity-50">{saving ? 'Granting access…' : 'Confirm piece access'}</button><button type="button" disabled={saving} onClick={onCancel} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">Cancel</button></div>
  </>;
}

interface ReaderAccountDirectoryProps { articles?: readonly ReaderGrantPiece[] }
const NO_ARTICLES: readonly ReaderGrantPiece[] = [];
export const ReaderAccountDirectory: React.FC<ReaderAccountDirectoryProps> = ({ articles = NO_ARTICLES }) => {
  const [directory, setDirectory] = useState<ReaderAccountAdminPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [selected, setSelected] = useState<ReaderAccountAdminItem | null>(null);
  const [grantReader, setGrantReader] = useState<ReaderAccountAdminItem | null>(null);
  const [articleId, setArticleId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const readGeneration = useRef(0);
  const abortRead = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const currentFilter = useRef<{ email?: string }>({});
  const pieces = publishedReaderGrantPieces(articles);

  const load = async (page: { cursor?: string; email?: string } = currentFilter.current, append = false) => {
    if (savingRef.current || (append && loadingRef.current)) return;
    abortRead.current?.abort();
    const controller = new AbortController(); abortRead.current = controller;
    const generation = ++readGeneration.current;
    loadingRef.current = true; setLoading(true); setError('');
    if (!append) { setDirectory(null); setSelected(null); setGrantReader(null); }
    try {
      const response = await api.getAdminReaderAccounts({ ...page, pageSize: 25, signal: controller.signal });
      if (generation === readGeneration.current && !controller.signal.aborted) {
        currentFilter.current = { email: page.email };
        setDirectory(previous => append ? appendReaderAccountPage(previous, response.directory) : response.directory);
      }
    } catch (failure) {
      if (generation === readGeneration.current && !controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Reader accounts could not be loaded.');
    } finally {
      if (generation === readGeneration.current && !controller.signal.aborted) { loadingRef.current = false; setLoading(false); }
    }
  };
  useEffect(() => {
    void load({});
    return () => { readGeneration.current += 1; abortRead.current?.abort(); };
  }, []);
  useEffect(() => { if (selected || grantReader) dialogRef.current?.focus(); }, [selected, grantReader]);
  const save = async () => {
    if (savingRef.current || loadingRef.current || !selected || !confirmed || selected.status === 'unavailable') return;
    savingRef.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = await api.setAdminReaderAccountStatus(selected.id, { status: selected.status === 'suspended' ? 'active' : 'suspended', expectedRevision: selected.revision, reason });
      setDirectory(current => current ? { ...current, readers: current.readers.map(reader => reader.id === response.reader.id ? response.reader : reader) } : current);
      setNotice(response.reader.status === 'suspended' ? 'Reader suspended. Existing sessions are invalid; purchases and history were preserved.' : 'Reader reactivated. They must sign in again; previous sessions remain invalid.');
      setSelected(null); setConfirmed(false); setReason('');
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Account status was not confirmed.'} No automatic retry was sent. Close this confirmation and refresh accounts before retrying.`);
    } finally { savingRef.current = false; setSaving(false); }
  };
  const savePieceGrant = async () => {
    if (savingRef.current || loadingRef.current || !grantReader || !canGrantReaderPiece(grantReader) || !confirmed || !pieces.some(piece => piece.id === articleId)) return;
    savingRef.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = await api.grantReaderAccountPieceAccess(grantReader.id, { articleId });
      const title = pieces.find(piece => piece.id === response.grant.articleId)?.title || 'The selected piece';
      setNotice(response.changed ? `${title}: account-bound access granted to ${grantReader.email}.` : `${title}: access was already granted to ${grantReader.email}; no duplicate grant was created.`);
      setGrantReader(null); setArticleId(''); setConfirmed(false);
    } catch (failure) {
      setError(`${failure instanceof Error ? failure.message : 'Piece access was not confirmed.'} No automatic retry was sent. A retry for the same account and piece cannot duplicate the grant.`);
    } finally { savingRef.current = false; setSaving(false); }
  };
  const closeConfirmation = () => { if (!savingRef.current) { setSelected(null); setGrantReader(null); } };
  return <section aria-labelledby="reader-account-directory-title" className="bg-slate-900/50 border border-slate-700 rounded-2xl p-4 sm:p-6 mb-6">
    <h3 id="reader-account-directory-title" className="text-xl font-serif text-slate-100 mb-4">Reader accounts</h3>
    <form className="flex flex-wrap gap-3 mb-5" onSubmit={event => { event.preventDefault(); setNotice(''); void load({ email: email.trim().toLowerCase() || undefined }); }}>
      <label className="w-full sm:w-auto sm:flex-1 min-w-0"><span className="block text-sm text-slate-400 mb-1">Find an exact email address</span><input type="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} placeholder="reader@example.com" className="w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2" /></label>
      <button type="submit" disabled={loading || saving} className="self-end bg-cyan-700 rounded-lg px-4 py-2 disabled:opacity-50">Find reader</button>
      <button type="button" disabled={loading || saving} onClick={() => { setEmail(''); setNotice(''); void load({}); }} className="self-end border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">Show all</button>
    </form>
    <ReaderAccountDirectoryView directory={directory} loading={loading} busy={saving} error={error} notice={notice} hasGrantPieces={pieces.length > 0} onRefresh={() => { void load(); }} onFirst={() => { void load(); }} onNext={() => { if (directory?.nextCursor) void load({ ...currentFilter.current, cursor: directory.nextCursor }, true); }} onSelect={reader => { setSelected(reader); setGrantReader(null); setConfirmed(false); setReason(''); setError(''); }} onGrant={reader => { if (!canGrantReaderPiece(reader)) return; setGrantReader(reader); setSelected(null); setArticleId(''); setConfirmed(false); setError(''); }} />
    {selected || grantReader ? <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={grantReader ? 'reader-piece-grant-title' : 'reader-status-confirm-title'} onKeyDown={event => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); closeConfirmation(); }
      if (event.key === 'Tab') {
        const controls = Array.from((event.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])'));
        const first = controls[0]; const last = controls[controls.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }} className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"><div className="w-full max-w-lg max-h-[90vh] overflow-auto border border-slate-600 bg-slate-900 rounded-xl p-5">
      {grantReader ? <ReaderAccountPieceGrantView reader={grantReader} pieces={pieces} articleId={articleId} confirmed={confirmed} saving={saving} error={error} onArticle={id => { setArticleId(id); setConfirmed(false); }} onConfirmed={setConfirmed} onSave={() => { void savePieceGrant(); }} onCancel={closeConfirmation} /> : selected ? <>
      <h4 id="reader-status-confirm-title" className="text-lg font-semibold mb-3">{selected.status === 'suspended' ? 'Reactivate' : 'Suspend'} reader account?</h4>
      <p className="break-words">{selected.name}</p><p className="break-all text-cyan-200 mb-3">{selected.email}</p>
      <p className="text-sm text-slate-300 mb-3">{selected.status === 'suspended' ? 'The reader can sign in again. Old sessions will not become valid again.' : 'This signs the reader out and blocks sign-in and protected account access. It does not delete or refund purchases, licences or reading history.'}</p>
      <label className="block mb-3">Writer note (optional)<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={300} rows={3} className="block w-full mt-1 bg-slate-950 border border-slate-600 rounded-lg p-2" /></label>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />I checked the email address and want to change this account status.</label>
      {error ? <p role="alert" className="text-rose-200 mt-3">{error}</p> : null}
      <div className="flex flex-wrap gap-3 mt-5"><button type="button" disabled={!confirmed || saving} onClick={() => { void save(); }} className="bg-cyan-700 rounded-lg px-4 py-2 disabled:opacity-50">{saving ? 'Saving…' : 'Confirm status change'}</button><button type="button" disabled={saving} onClick={closeConfirmation} className="border border-slate-600 rounded-lg px-4 py-2 disabled:opacity-50">Cancel</button></div>
      </> : null}
    </div></div> : null}
  </section>;
};

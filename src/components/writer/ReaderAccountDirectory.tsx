import React, { useEffect, useRef, useState } from 'react';
import type { Article, ReaderAccountAdminItem, ReaderAccountAdminPage } from '../../types.js';
import { api, ApiResponseError } from '../../utils/api.js';

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
/** Retain earlier accounts and newer status revisions while pages arrive. */
export function appendReaderAccountPage(previous: ReaderAccountAdminPage | null, next: ReaderAccountAdminPage): ReaderAccountAdminPage {
  if (!previous) return next;
  const readers = new Map(previous.readers.map(reader => [reader.id, reader]));
  for (const reader of next.readers) {
    const existing = readers.get(reader.id);
    if (!existing || reader.revision >= existing.revision) readers.set(reader.id, reader);
  }
  return { ...next, readers: [...readers.values()] };
}

export function requireReaderAccountPage(value: unknown): ReaderAccountAdminPage {
  const page = value as ReaderAccountAdminPage | null;
  if (!page || typeof page !== 'object' || !Number.isSafeInteger(page.totalReaderAccounts) || page.totalReaderAccounts < 0
    || page.matchingReaderAccounts !== page.totalReaderAccounts || page.pageSize !== 25
    || !Array.isArray(page.readers) || page.readers.length > page.pageSize || page.readers.length > page.totalReaderAccounts
    || (page.nextCursor !== undefined && (typeof page.nextCursor !== 'string' || !/^[A-Za-z0-9_-]{1,2100}$/.test(page.nextCursor)))
    || page.readers.some(reader => !reader || typeof reader !== 'object' || typeof reader.id !== 'string' || !reader.id || reader.id.includes('/')
      || typeof reader.name !== 'string' || typeof reader.email !== 'string' || typeof reader.createdAt !== 'string'
      || !['active', 'suspended', 'unavailable'].includes(reader.status) || !Number.isSafeInteger(reader.revision) || reader.revision < 0
      || (reader.statusUpdatedAt !== undefined && typeof reader.statusUpdatedAt !== 'string')
      || (reader.suspensionReason !== undefined && typeof reader.suspensionReason !== 'string'))
    || new Set(page.readers.map(reader => reader.id)).size !== page.readers.length) {
    throw new Error('The registered reader account list could not be confirmed. Refresh accounts to try again.');
  }
  return page;
}

export function ReaderAccountDirectoryView({ directory, loading, busy, error, notice, onRefresh, onSelect, onGrant, hasGrantPieces = false }: {
  directory: ReaderAccountAdminPage | null; loading: boolean; busy: boolean; error: string; notice: string;
  onRefresh: () => void; onSelect: (reader: ReaderAccountAdminItem) => void;
  onGrant?: (reader: ReaderAccountAdminItem) => void; hasGrantPieces?: boolean;
}) {
  return <div aria-busy={loading || busy}>
    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
      <p className="text-sm text-slate-200"><strong className="text-cyan-300 text-xl">{directory ? directory.totalReaderAccounts : loading ? 'Loading…' : 'Not loaded'}</strong> registered reader accounts</p>
      <button type="button" onClick={onRefresh} disabled={loading || busy} className="min-h-9 border border-slate-600 rounded-lg px-3 py-1.5 text-xs disabled:opacity-50">{loading ? 'Loading accounts…' : 'Refresh accounts'}</button>
    </div>
    <p className="text-slate-400 text-xs mb-3">Writer accounts are excluded. Names and email addresses are visible only in Writer Studio.</p>
    {error ? <p role="alert" className="text-rose-200 bg-rose-950/40 border border-rose-700 rounded-lg p-3 mb-4">{error}</p> : null}
    {notice ? <p role="status" className="text-emerald-200 mb-4">{notice}</p> : null}
    {loading ? <p role="status" className="text-cyan-200 text-sm mb-3">Loading all reader accounts…{directory ? ` ${directory.readers.length} of ${directory.totalReaderAccounts} loaded.` : ''}</p> : null}
    {directory ? <>
      {!loading ? <p className="text-slate-400 text-xs mb-3">{directory.readers.length === directory.totalReaderAccounts && !directory.nextCursor
        ? `All ${directory.readers.length} reader accounts are shown.`
        : `${directory.readers.length} of ${directory.totalReaderAccounts} accounts are shown. Refresh accounts to load the complete list.`}</p> : null}
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
      {!directory.readers.length && !loading && !error ? <p className="text-slate-400 py-6">No reader accounts have registered yet.</p> : null}
    </> : null}
    <details className="text-xs text-slate-500 mt-4"><summary className="cursor-pointer">About these accounts</summary><p className="mt-2">Each row is a registered reader account, not a visitor or a purchase. Legacy accounts needing review remain included in the total. Suspension signs the reader out and blocks account access; purchases, licences and reading history remain preserved.</p></details>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
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
  const accessRejectedRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const pieces = publishedReaderGrantPieces(articles);

  const clearRejectedAccess = (failure: unknown): boolean => {
    if (!(failure instanceof ApiResponseError) || (failure.status !== 401 && failure.status !== 403)) return false;
    accessRejectedRef.current = true;
    setDirectory(null); setSelected(null); setGrantReader(null);
    setConfirmed(false); setReason(''); setArticleId(''); setNotice('');
    return true;
  };

  const load = async () => {
    if (savingRef.current) return;
    abortRead.current?.abort();
    const controller = new AbortController(); abortRead.current = controller;
    const generation = ++readGeneration.current;
    loadingRef.current = true; setLoading(true); setError('');
    setSelected(null); setGrantReader(null);
    try {
      let accumulated: ReaderAccountAdminPage | null = null;
      let cursor: string | undefined;
      let pageLimit = 1;
      const seenCursors = new Set<string>();
      for (let pageNumber = 0; pageNumber < pageLimit; pageNumber += 1) {
        const response = await api.getAdminReaderAccounts({ cursor, pageSize: 25, signal: controller.signal });
        if (generation !== readGeneration.current || controller.signal.aborted) return;
        const page = requireReaderAccountPage(response?.success === true ? response.directory : null);
        accessRejectedRef.current = false;
        if (pageNumber === 0) pageLimit = Math.max(1, Math.ceil(page.totalReaderAccounts / page.pageSize)) + 1;
        const next = appendReaderAccountPage(accumulated, page);
        if (accumulated && next.readers.length <= accumulated.readers.length) {
          throw new Error('Reader account pages stopped advancing. Refresh accounts to load the complete list.');
        }
        accumulated = next;
        setDirectory(accumulated);
        if (!page.nextCursor) {
          if (accumulated.readers.length !== page.totalReaderAccounts) throw new Error('The reader account list changed while loading. Refresh accounts to load the complete list.');
          return;
        }
        if (!page.readers.length || seenCursors.has(page.nextCursor) || accumulated.readers.length >= page.totalReaderAccounts) {
          throw new Error('Reader account pages could not be confirmed. Refresh accounts to load the complete list.');
        }
        seenCursors.add(page.nextCursor); cursor = page.nextCursor;
      }
      throw new Error('The reader account list changed while loading. Refresh accounts to load the complete list.');
    } catch (failure) {
      if (generation === readGeneration.current && !controller.signal.aborted) {
        clearRejectedAccess(failure);
        setError(failure instanceof Error ? failure.message : 'Reader accounts could not be loaded.');
      }
    } finally {
      if (generation === readGeneration.current && !controller.signal.aborted) { loadingRef.current = false; setLoading(false); }
    }
  };
  useEffect(() => {
    void load();
    return () => { readGeneration.current += 1; abortRead.current?.abort(); };
  }, []);
  useEffect(() => { if (selected || grantReader) dialogRef.current?.focus(); }, [selected, grantReader]);
  const save = async () => {
    if (savingRef.current || loadingRef.current || !selected || !confirmed || selected.status === 'unavailable' || accessRejectedRef.current) return;
    savingRef.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = await api.setAdminReaderAccountStatus(selected.id, { status: selected.status === 'suspended' ? 'active' : 'suspended', expectedRevision: selected.revision, reason });
      setDirectory(current => current ? { ...current, readers: current.readers.map(reader => reader.id === response.reader.id ? response.reader : reader) } : current);
      setNotice(response.reader.status === 'suspended' ? 'Reader suspended. Existing sessions are invalid; purchases and history were preserved.' : 'Reader reactivated. They must sign in again; previous sessions remain invalid.');
      setSelected(null); setConfirmed(false); setReason('');
    } catch (failure) {
      clearRejectedAccess(failure);
      setError(`${failure instanceof Error ? failure.message : 'Account status was not confirmed.'} No automatic retry was sent. Close this confirmation and refresh accounts before retrying.`);
    } finally { savingRef.current = false; setSaving(false); }
  };
  const savePieceGrant = async () => {
    if (savingRef.current || loadingRef.current || !grantReader || !canGrantReaderPiece(grantReader) || !confirmed || !pieces.some(piece => piece.id === articleId) || accessRejectedRef.current) return;
    savingRef.current = true; setSaving(true); setError(''); setNotice('');
    try {
      const response = await api.grantReaderAccountPieceAccess(grantReader.id, { articleId });
      const title = pieces.find(piece => piece.id === response.grant.articleId)?.title || 'The selected piece';
      setNotice(response.changed ? `${title}: account-bound access granted to ${grantReader.email}.` : `${title}: access was already granted to ${grantReader.email}; no duplicate grant was created.`);
      setGrantReader(null); setArticleId(''); setConfirmed(false);
    } catch (failure) {
      clearRejectedAccess(failure);
      setError(`${failure instanceof Error ? failure.message : 'Piece access was not confirmed.'} No automatic retry was sent. A retry for the same account and piece cannot duplicate the grant.`);
    } finally { savingRef.current = false; setSaving(false); }
  };
  const closeConfirmation = () => { if (!savingRef.current) { setSelected(null); setGrantReader(null); } };
  return <section aria-labelledby="reader-account-directory-title" className="bg-slate-900/50 border border-slate-700 rounded-2xl p-4 sm:p-6 mb-6">
    <h3 id="reader-account-directory-title" className="text-xl font-serif text-slate-100 mb-4">Reader accounts</h3>
    <ReaderAccountDirectoryView directory={directory} loading={loading} busy={saving} error={error} notice={notice} hasGrantPieces={pieces.length > 0} onRefresh={() => { setNotice(''); void load(); }} onSelect={reader => { if (accessRejectedRef.current) return; setSelected(reader); setGrantReader(null); setConfirmed(false); setReason(''); setError(''); }} onGrant={reader => { if (accessRejectedRef.current || !canGrantReaderPiece(reader)) return; setGrantReader(reader); setSelected(null); setArticleId(''); setConfirmed(false); setError(''); }} />
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

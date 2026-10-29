import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ReaderAccountDirectory, ReaderAccountDirectoryView, ReaderAccountPieceGrantView, appendReaderAccountPage, canGrantReaderPiece, publishedReaderGrantPieces } from './ReaderAccountDirectory.js';
import type { ReaderAccountAdminPage } from '../../types.js';

const directory: ReaderAccountAdminPage = { totalReaderAccounts: 42, matchingReaderAccounts: 42, pageSize: 25, readers: [
  { id: 'user_reader0001', name: 'Reader Name', email: 'reader@example.com', createdAt: '2026-10-01T00:00:00.000Z', status: 'active', revision: 0 },
  { id: 'user_reader0002', name: 'Other Reader', email: 'other@example.com', createdAt: '', status: 'suspended', revision: 2, suspensionReason: 'Writer review' },
  { id: 'user_reader0003', name: 'Legacy Reader', email: 'legacy@example.com', createdAt: '', status: 'unavailable', revision: 0 },
], nextCursor: 'safe-cursor' };
const render = (loading = false, busy = false) => renderToStaticMarkup(<ReaderAccountDirectoryView directory={directory} loading={loading} busy={busy} error="" notice="" onRefresh={vi.fn()} onNext={vi.fn()} onFirst={vi.fn()} onSelect={vi.fn()} onGrant={vi.fn()} hasGrantPieces />);
describe('private writer reader directory', () => {
  it('shows registered count, ownership, registration date and separate suspend/reactivate controls', () => {
    const markup = render();
    for (const text of ['42', 'registered reader accounts', 'Reader Name', 'reader@example.com', 'Suspend account', 'Reactivate account', 'Status needs review', 'Writer accounts are excluded', 'purchases, licences and reading history remain preserved', 'Load more accounts', 'Loaded 3 of 42', '39 remaining', 'Grant piece access']) expect(markup).toContain(text);
    expect(markup).not.toMatch(/passwordHash|sessionGeneration|type="password"/);
    expect(markup).toMatch(/disabled=""[^>]*>Suspend account/);
  });
  it('disables mutations while loading or saving and explains private visibility', () => {
    expect(render(true)).toContain('aria-busy="true"');
    expect(render(false, true)).toContain('disabled=""');
    expect(render()).toContain('visible only in Writer Studio');
  });
  it('offers bounded exact-email lookup without reader role or password editing', () => {
    const markup = renderToStaticMarkup(<ReaderAccountDirectory />);
    expect(markup).toContain('Find an exact email address'); expect(markup).toContain('type="email"');
    expect(markup).not.toContain('type="password"'); expect(markup).not.toContain('Administrator');
  });
  it('requires explicit confirmation, rejects repeat taps and avoids optimistic changes or auto-retries', () => {
    const source = readFileSync(new URL('./ReaderAccountDirectory.tsx', import.meta.url), 'utf8');
    expect(source).toContain('if (savingRef.current || loadingRef.current || !selected || !confirmed');
    expect(source).toContain('expectedRevision: selected.revision');
    expect(source.match(/api\.setAdminReaderAccountStatus\(/g)).toHaveLength(1);
    expect(source).toContain('No automatic retry was sent.');
    expect(source).toContain('generation === readGeneration.current');
    expect(source).toContain('Old sessions will not become valid again.');
    expect(source).not.toMatch(/localStorage|sessionStorage|setInterval|setTimeout|passwordHash|sessionGeneration/);
  });
  it('appends requested pages without losing earlier accounts or newer suspension revisions', () => {
    const next: ReaderAccountAdminPage = { ...directory, readers: [
      { ...directory.readers[1], status: 'active', revision: 0 },
      { ...directory.readers[0], id: 'user_reader0004', name: 'Fourth Reader' },
    ], nextCursor: undefined };
    const merged = appendReaderAccountPage(directory, next);
    expect(merged.readers).toHaveLength(4);
    expect(merged.readers[0]).toEqual(directory.readers[0]);
    expect(merged.readers[1].status).toBe('suspended');
    expect(merged.readers[1].revision).toBe(2);
    expect(merged.nextCursor).toBeUndefined();
    expect(directory.readers).toHaveLength(3);
  });
  it('limits account grants to identifiable active readers and published pieces only', () => {
    expect(canGrantReaderPiece(directory.readers[0])).toBe(true);
    expect(canGrantReaderPiece(directory.readers[1])).toBe(false);
    expect(canGrantReaderPiece(directory.readers[2])).toBe(false);
    expect(canGrantReaderPiece({ ...directory.readers[0], id: 'legacy-reader' })).toBe(false);
    expect(canGrantReaderPiece({ ...directory.readers[0], email: '' })).toBe(false);
    expect(publishedReaderGrantPieces([
      { id: 'piece-one', title: 'Published Piece', status: 'published' },
      { id: 'piece-one', title: 'Published Piece', status: 'published' },
      { id: 'piece-draft', title: 'Draft Piece', status: 'draft' },
      { id: 'all', title: 'Reserved whole-catalogue selector', status: 'published' },
    ])).toEqual([{ id: 'piece-one', title: 'Published Piece', status: 'published' }]);
  });
  it('requires a selected piece and explicit account confirmation without phone or token inputs', () => {
    const props = { reader: directory.readers[0], pieces: [{ id: 'piece-one', title: 'Published Piece', status: 'published' as const }], articleId: '', confirmed: false, saving: false, error: '', onArticle: vi.fn(), onConfirmed: vi.fn(), onSave: vi.fn(), onCancel: vi.fn() };
    const markup = renderToStaticMarkup(<ReaderAccountPieceGrantView {...props} />);
    expect(markup).toContain('reader@example.com');
    expect(markup).toContain('Published piece');
    expect(markup).toContain('for="reader-account-grant-piece"');
    expect(markup).toMatch(/<select[^>]*id="reader-account-grant-piece"/);
    expect(markup).toContain('account and the selected piece');
    expect(markup).toContain('not recorded as a sale or affiliate commission');
    expect(markup).toMatch(/disabled=""[^>]*>Confirm piece access/);
    expect(markup).not.toMatch(/type="tel"|activation-token|reader-password/);
    const ready = renderToStaticMarkup(<ReaderAccountPieceGrantView {...props} articleId="piece-one" confirmed />);
    expect(ready).not.toMatch(/disabled=""[^>]*>Confirm piece access/);
  });
  it('requests only explicit bounded pages and a single idempotent account-piece grant', () => {
    const source = readFileSync(new URL('./ReaderAccountDirectory.tsx', import.meta.url), 'utf8');
    expect(source).toContain('pageSize: 25');
    expect(source).toContain('appendReaderAccountPage(previous, response.directory)');
    expect(source).toContain('api.grantReaderAccountPieceAccess(grantReader.id, { articleId })');
    expect(source.match(/api\.grantReaderAccountPieceAccess\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/pageSize:\s*(?:100|1000)|while\s*\(/);
  });
});

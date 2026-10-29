import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ReaderAccountDirectory, ReaderAccountDirectoryView } from './ReaderAccountDirectory.js';
import type { ReaderAccountAdminPage } from '../../types.js';

const directory: ReaderAccountAdminPage = { totalReaderAccounts: 42, matchingReaderAccounts: 42, pageSize: 25, readers: [
  { id: 'user_reader0001', name: 'Reader Name', email: 'reader@example.com', createdAt: '2026-10-01T00:00:00.000Z', status: 'active', revision: 0 },
  { id: 'user_reader0002', name: 'Other Reader', email: 'other@example.com', createdAt: '', status: 'suspended', revision: 2, suspensionReason: 'Writer review' },
  { id: 'user_reader0003', name: 'Legacy Reader', email: 'legacy@example.com', createdAt: '', status: 'unavailable', revision: 0 },
], nextCursor: 'safe-cursor' };
const render = (loading = false, busy = false) => renderToStaticMarkup(<ReaderAccountDirectoryView directory={directory} loading={loading} busy={busy} error="" notice="" onRefresh={vi.fn()} onNext={vi.fn()} onFirst={vi.fn()} onSelect={vi.fn()} />);
describe('private writer reader directory', () => {
  it('shows registered count, ownership, registration date and separate suspend/reactivate controls', () => {
    const markup = render();
    for (const text of ['42', 'registered reader accounts', 'Reader Name', 'reader@example.com', 'Suspend account', 'Reactivate account', 'Status needs review', 'Writer accounts are excluded', 'purchases, licences and reading history remain preserved', 'Next page']) expect(markup).toContain(text);
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
    expect(source).toContain('if (savingRef.current || !selected || !confirmed');
    expect(source).toContain('expectedRevision: selected.revision');
    expect(source.match(/api\.setAdminReaderAccountStatus\(/g)).toHaveLength(1);
    expect(source).toContain('No automatic retry was sent.');
    expect(source).toContain('generation === readGeneration.current');
    expect(source).toContain('Old sessions will not become valid again.');
    expect(source).not.toMatch(/localStorage|sessionStorage|setInterval|setTimeout|passwordHash|sessionGeneration/);
  });
});

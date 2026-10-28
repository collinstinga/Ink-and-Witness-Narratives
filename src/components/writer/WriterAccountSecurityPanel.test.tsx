import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { canRequestWriterRecovery, WriterAccountSecurityView, writerSecurityDescription } from './WriterAccountSecurityPanel.js';
import type { WriterAccountSecurityStatus } from '../../utils/api.js';

const ready: WriterAccountSecurityStatus = { status: 'ready', memberCount: 4, canIssue: true };
const render = (status: WriterAccountSecurityStatus | null, approved = false, sending = false) => renderToStaticMarkup(
  <WriterAccountSecurityView status={status} approved={approved} loading={false} sending={sending} notice="" error=""
    onApprove={vi.fn()} onRefresh={vi.fn()} onRequest={vi.fn()} onClose={vi.fn()} />);

describe('Writer Studio account-security panel', () => {
  it.each(['unavailable', 'review_required', 'pending', 'active'] as const)('cannot issue in %s state, even when a response wrongly claims canIssue', status => {
    const value = { ...ready, status };
    expect(canRequestWriterRecovery(value, true, false)).toBe(false);
    expect(render(value, true)).toContain('disabled=""');
  });
  it('requires both fresh readiness and explicit approval, and guards busy/double-submit states', () => {
    expect(canRequestWriterRecovery(null, true, false)).toBe(false);
    expect(canRequestWriterRecovery(ready, false, false)).toBe(false);
    expect(canRequestWriterRecovery({ ...ready, canIssue: false }, true, false)).toBe(false);
    expect(canRequestWriterRecovery(ready, true, true)).toBe(false);
    expect(canRequestWriterRecovery(ready, true, false)).toBe(true);
    expect(render(ready, true)).not.toContain('disabled=""');
    expect(render(ready, true, true)).toContain('Requesting recovery email');
  });
  it('explains reviewed backup readiness, delayed activation, preserved history and session effects without private identity details', () => {
    const markup = render({ ...ready, status: 'review_required', canIssue: false });
    for (const text of ['fresh reviewed backup', 'current login is unchanged', 'Activation happens only after', 'purchases and payment history are preserved', 'conflicting account ownership', 'end previous writer sessions']) expect(markup).toContain(text);
    expect(markup).not.toMatch(/wcr1_|passwordHash|user_|gmail|type="password"|href=/);
    expect(markup).toContain('aria-labelledby="writer-account-security-title"'); expect(markup).toContain('type="checkbox"');
    expect(writerSecurityDescription({ ...ready, status: 'pending' })).toContain('No second email');
    expect(writerSecurityDescription({ ...ready, status: 'active' })).toContain('does not promise access held by a different account');
  });
  it('does not send on mount or refresh, guards double taps and does not persist capabilities or auto-retry uncertainty', () => {
    const source = readFileSync(new URL('./WriterAccountSecurityPanel.tsx', import.meta.url), 'utf8');
    expect(source.match(/api\.requestWriterAccountRecovery\(/g)).toHaveLength(1);
    expect(source).toContain('if (requestInFlight.current || !canRequestWriterRecovery');
    expect(source).toContain('requestInFlight.current = true');
    expect(source).toContain('generation === readGeneration.current');
    expect(source).toContain('No automatic retry will be sent.');
    expect(source).not.toMatch(/localStorage|sessionStorage|setInterval|setTimeout|location\.|new-password|wcr1_/);
    expect(source).toContain('setStatus(null)');
    const refresh = source.slice(source.indexOf('const refresh ='), source.indexOf('const requestRecovery ='));
    expect(refresh).not.toContain('requestWriterAccountRecovery');
  });
  it('mounts independently of the active tab without replacing the writer editor or changing navigation', () => {
    const dashboard = readFileSync(new URL('./WriterDashboard.tsx', import.meta.url), 'utf8');
    expect(dashboard).toContain('{securityOpen ? <WriterAccountSecurityPanel onClose={() => setSecurityOpen(false)} /> : null}');
    expect(dashboard).toContain('aria-expanded={securityOpen}'); expect(dashboard).toContain('aria-controls="writer-account-security"');
    expect(dashboard).not.toMatch(/securityOpen\s*\?\s*<WriterEditor|setCurrentTab\('security'\)|setEditingPiece\(null\).*security/);
  });
});

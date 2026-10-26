import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProductionAffiliateNotificationRolloutStatus } from '../../types.js';
import { api } from '../../utils/api.js';
import AffiliateNotificationRolloutControls, {
  AffiliateNotificationRolloutControlsView,
  affiliateNotificationRolloutAvailability,
  requestAffiliateNotificationRolloutAction,
} from './AffiliateNotificationRolloutControls.js';

function status(overrides: Partial<ProductionAffiliateNotificationRolloutStatus> = {}): ProductionAffiliateNotificationRolloutStatus {
  return { status: 'ready', revision: 2, environmentMode: 'production_test', mode: 'production_test',
    foundingWelcomeCount: 0, maximumReviewDays: 30, testRecipientConfigured: true, reviewAvailable: true, ...overrides };
}
function markup(value: ProductionAffiliateNotificationRolloutStatus | null,
  overrides: Partial<React.ComponentProps<typeof AffiliateNotificationRolloutControlsView>> = {}) {
  return renderToStaticMarkup(<AffiliateNotificationRolloutControlsView status={value} duration="7" includeFoundingWelcome={false}
    onDuration={vi.fn()} onFoundingWelcome={vi.fn()} onRefresh={vi.fn()} onAction={vi.fn()} {...overrides} />);
}
function action(overrides: Partial<Parameters<typeof requestAffiliateNotificationRolloutAction>[0]> = {}) {
  return { action: 'review' as const, status: status(), locked: false, durationDays: 7, includeFoundingWelcome: false,
    confirm: vi.fn(() => true), review: vi.fn(async () => ({ rollout: status() })),
    test: vi.fn(async () => ({ result: { status: 'accepted' }, rollout: status() })),
    pause: vi.fn(async () => ({ rollout: status({ status: 'paused' }) })), ...overrides };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('production notification review controls', () => {
  it('renders without sending, approving or pausing and starts in a locked checking state', () => {
    const review = vi.spyOn(api, 'updateAdminAffiliateNotificationRollout');
    const test = vi.spyOn(api, 'testAdminAffiliateNotificationRollout');
    const pause = vi.spyOn(api, 'pauseAdminAffiliateNotificationRollout');
    const html = renderToStaticMarkup(<AffiliateNotificationRolloutControls />);
    expect(review).not.toHaveBeenCalled(); expect(test).not.toHaveBeenCalled(); expect(pause).not.toHaveBeenCalled();
    expect(html).toContain('Checking review');
    expect(html).toContain('Saving templates never enables sending');
    expect(html).toContain('default-off');
    expect(html).toMatch(/disabled=""[^>]*>Approve owner-only test review/);
    expect(html).toMatch(/disabled=""[^>]*>Send approved owner-only test/);
  });

  it('keeps missing, disabled and untrusted review capabilities locked', () => {
    expect(affiliateNotificationRolloutAvailability(null)).toEqual({ review: false, test: false, pause: false });
    expect(affiliateNotificationRolloutAvailability(status({ status: 'disabled' }))).toEqual({ review: false, test: false, pause: false });
    expect(affiliateNotificationRolloutAvailability(status({ environmentMode: null }))).toEqual({ review: false, test: false, pause: false });
    expect(affiliateNotificationRolloutAvailability(status(), true)).toEqual({ review: false, test: false, pause: false });
    expect(affiliateNotificationRolloutAvailability(status({ status: 'blocked', reviewAvailable: undefined })).review).toBe(false);
    expect(affiliateNotificationRolloutAvailability(status({ status: 'blocked', reviewAvailable: true })).review).toBe(true);
  });

  it('never infers owner-only sending from a live mode, expired or changed review', () => {
    for (const state of ['blocked', 'unreviewed', 'paused', 'expired', 'settings_changed'] as const) {
      expect(affiliateNotificationRolloutAvailability(status({ status: state })).test).toBe(false);
    }
    expect(affiliateNotificationRolloutAvailability(status({ environmentMode: 'production_live' })).test).toBe(false);
    expect(affiliateNotificationRolloutAvailability(status({ mode: 'production_live' })).test).toBe(false);
    expect(affiliateNotificationRolloutAvailability(status({ testRecipientConfigured: false })).test).toBe(false);
    for (const testDeliveryStatus of ['leased', 'dispatching', 'accepted', 'delivered', 'needs_investigation', 'cancelled', 'unknown_future_state']) {
      expect(affiliateNotificationRolloutAvailability(status({ testDeliveryStatus })).test).toBe(false);
    }
    expect(affiliateNotificationRolloutAvailability(status({ revision: 0 })).pause).toBe(false);
  });

  it('requires explicit approval and sends only the known revision and review choices', async () => {
    const declined = action({ confirm: vi.fn(() => false) });
    expect(await requestAffiliateNotificationRolloutAction(declined)).toBeNull();
    expect(declined.review).not.toHaveBeenCalled();
    const accepted = action();
    await requestAffiliateNotificationRolloutAction(accepted);
    expect(accepted.confirm).toHaveBeenCalledWith(expect.stringContaining('does not send an email'));
    expect(accepted.review).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 2, mode: 'production_test', durationDays: 7, includeFoundingWelcome: false });
    expect(accepted.test).not.toHaveBeenCalled(); expect(accepted.pause).not.toHaveBeenCalled();
  });

  it.each([0, 31, 1.5, NaN, Infinity])('rejects invalid review duration %s before prompting', async durationDays => {
    const request = action({ durationDays });
    expect(await requestAffiliateNotificationRolloutAction(request)).toBeNull();
    expect(request.confirm).not.toHaveBeenCalled(); expect(request.review).not.toHaveBeenCalled();
  });

  it('respects a stricter server maximum and rejects founding welcomes in owner-only mode', async () => {
    const request = action({ durationDays: 8, status: status({ maximumReviewDays: 7 }) });
    expect(await requestAffiliateNotificationRolloutAction(request)).toBeNull();
    expect(request.confirm).not.toHaveBeenCalled();
    const founding = action({ includeFoundingWelcome: true });
    expect(await requestAffiliateNotificationRolloutAction(founding)).toBeNull();
    expect(founding.review).not.toHaveBeenCalled();
  });

  it('requires a separate live review and an explicit founding opt-in', async () => {
    const request = action({ status: status({ status: 'blocked', environmentMode: 'production_live' }), includeFoundingWelcome: true });
    await requestAffiliateNotificationRolloutAction(request);
    expect(request.confirm).toHaveBeenCalledWith(expect.stringContaining('signed delivered owner-only test'));
    expect(request.confirm).toHaveBeenCalledWith(expect.stringContaining('nine original founding partners'));
    expect(request.review).toHaveBeenCalledWith({ expectedRevision: 2, mode: 'production_live', durationDays: 7, includeFoundingWelcome: true });
    expect(request.test).not.toHaveBeenCalled();
    const html = markup(status({ environmentMode: 'production_live' }));
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('checked=""');
    expect(html).toContain('Approve time-limited live review');
  });

  it('requires a dedicated test confirmation, never a client-selected recipient', async () => {
    const declined = action({ action: 'test', confirm: vi.fn(() => false) });
    expect(await requestAffiliateNotificationRolloutAction(declined)).toBeNull();
    expect(declined.test).not.toHaveBeenCalled();
    const request = action({ action: 'test' });
    await requestAffiliateNotificationRolloutAction(request);
    expect(request.confirm).toHaveBeenCalledWith(expect.stringContaining('No affiliate or customer announcements'));
    expect(request.test).toHaveBeenCalledExactlyOnceWith();
    expect(request.review).not.toHaveBeenCalled();
  });

  it('requires confirmation to pause exactly the displayed revision', async () => {
    const request = action({ action: 'pause' });
    await requestAffiliateNotificationRolloutAction(request);
    expect(request.confirm).toHaveBeenCalledWith(expect.stringContaining('Historical emails, accounts and earnings will not be changed'));
    expect(request.pause).toHaveBeenCalledExactlyOnceWith(2);
    expect(request.review).not.toHaveBeenCalled(); expect(request.test).not.toHaveBeenCalled();
  });

  it('blocks dirty/error/loading states, keeps refresh manual and does not display raw delivery identifiers', () => {
    const html = markup(status({ testDeliveryStatus: 'private@example.test' }), { disabled: true, error: 'Refresh manually before retrying.' });
    expect(html).toContain('Save pending template changes');
    expect(html).toContain('role="alert"');
    expect(html).toContain('no automatic approval or background polling');
    expect(html).not.toContain('private@example.test');
    expect(html).toContain('Status requires review');
    expect(html).toMatch(/disabled=""[^>]*>Approve owner-only test review/);
    expect(html).toMatch(/disabled=""[^>]*>Send approved owner-only test/);
    expect(markup(status(), { busy: 'test' })).toContain('aria-busy="true"');
    expect(markup(status({ testDeliveryStatus: 'accepted' }))).toContain('Accepted by the provider does not mean delivered');
  });

  it('does not retry a failed mutation or refresh away the writer choices', async () => {
    const request = action({ review: vi.fn(async () => { throw new Error('revision conflict'); }) });
    await expect(requestAffiliateNotificationRolloutAction(request)).rejects.toThrow('revision conflict');
    expect(request.review).toHaveBeenCalledTimes(1);
    expect(request.confirm).toHaveBeenCalledTimes(1);
    const source = readFileSync(new URL('./AffiliateNotificationRolloutControls.tsx', import.meta.url), 'utf8');
    expect(source).toContain('readController.current?.abort()');
    expect(source).toContain('actionController.current?.abort()');
    expect(source).toContain('id === requestId.current');
    expect(source).toContain('if (running.current || loadingRef.current || disabled || error) return');
    expect(source).not.toContain('setInterval(');
    expect(source).not.toContain('localStorage');
    expect(source).not.toContain('setDuration(response');
  });
});

describe('production review API contract', () => {
  function mockApi() {
    vi.stubGlobal('localStorage', { getItem: () => '1', removeItem: vi.fn() });
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({ ok: true, status: 200,
      headers: { get: () => 'application/json' }, json: async () => ({ success: true, rollout: status(), result: { status: 'accepted' } }) }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }
  it('loads only writer-authenticated no-store status with cancellation', async () => {
    const fetch = mockApi(); const controller = new AbortController();
    await api.getAdminAffiliateNotificationRollout({ signal: controller.signal });
    expect(fetch).toHaveBeenCalledWith('/api/admin/affiliates/notifications/rollout', expect.objectContaining({
      credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { 'x-admin-token': 'cookie-session' },
    }));
  });
  it('picks exactly four review keys and never forwards injected recipients or transport', async () => {
    const fetch = mockApi(); const controller = new AbortController();
    await api.updateAdminAffiliateNotificationRollout({ expectedRevision: 2, mode: 'production_test', durationDays: 7,
      includeFoundingWelcome: false, recipient: 'private@example.test', now: '2026-01-01', sendEmail: 'injected' } as any, { signal: controller.signal });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('/api/admin/affiliates/notifications/rollout');
    expect(init).toMatchObject({ method: 'PUT', cache: 'no-store', credentials: 'include', signal: controller.signal });
    expect(JSON.parse(init!.body as string)).toEqual({ expectedRevision: 2, mode: 'production_test', durationDays: 7, includeFoundingWelcome: false });
  });
  it('posts an empty object for tests and only a revision for pause', async () => {
    const fetch = mockApi(); const controller = new AbortController();
    await api.testAdminAffiliateNotificationRollout({ signal: controller.signal });
    await api.pauseAdminAffiliateNotificationRollout(2, { signal: controller.signal });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['/api/admin/affiliates/notifications/rollout/test', '/api/admin/affiliates/notifications/rollout/pause']);
    for (const [, init] of fetch.mock.calls) expect(init).toMatchObject({ method: 'POST', cache: 'no-store', credentials: 'include', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', 'x-admin-token': 'cookie-session' } });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({});
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string)).toEqual({ expectedRevision: 2 });
  });
  it('propagates a revision conflict once without automatic retries', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', removeItem: vi.fn() });
    const fetch = vi.fn(async () => ({ ok: false, status: 409, headers: { get: () => 'application/json' },
      json: async () => ({ success: false, error: 'Review revision conflict.' }) }));
    vi.stubGlobal('fetch', fetch);
    await expect(api.pauseAdminAffiliateNotificationRollout(2)).rejects.toThrow('Review revision conflict.');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

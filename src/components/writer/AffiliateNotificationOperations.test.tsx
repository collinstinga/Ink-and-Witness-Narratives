import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AffiliateNotificationRuntimeResult, AffiliateNotificationRuntimeStatus } from '../../types.js';
import { api } from '../../utils/api.js';
import AffiliateNotificationOperations, {
  AffiliateNotificationOperationsView,
  affiliateNotificationOperationAvailability,
  requestAffiliateNotificationOperation,
} from './AffiliateNotificationOperations.js';

function status(overrides: Partial<AffiliateNotificationRuntimeStatus> = {}): AffiliateNotificationRuntimeStatus {
  return {
    status: 'ready', deliveryGate: 'disabled', sampledDeliveries: 4, counts: { delivered: 2, retry_pending: 1, dead_letter: 1 },
    preparedIntents: 8, truncated: { deliveries: false, intents: false },
    limits: { activeAffiliates: 200, campaigns: 100, releaseCampaigns: 100, communityPosts: 40,
      preparedSourcesPerRun: 20, inactivityBatch: 25, deliveryPage: 20, dispatchedIntentsPerRun: 10,
      statusDeliveries: 500, statusIntents: 1_000 }, ...overrides,
  };
}

function result(overrides: Partial<AffiliateNotificationRuntimeResult> = {}): AffiliateNotificationRuntimeResult {
  return { mode: 'prepare', status: 'completed', scanned: 3, attempted: 2, intentCount: 4, counts: { created: 2 }, ...overrides };
}

function markup(runtime: AffiliateNotificationRuntimeStatus | null, options: Partial<React.ComponentProps<typeof AffiliateNotificationOperationsView>> = {}) {
  return renderToStaticMarkup(<AffiliateNotificationOperationsView runtime={runtime} onRefresh={vi.fn()} onRun={vi.fn()} {...options} />);
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('notification operations panel', () => {
  it('does not start a job while rendering and shows staging-only purpose', () => {
    const run = vi.spyOn(api, 'runAdminAffiliateNotificationRuntime');
    const html = renderToStaticMarkup(<AffiliateNotificationOperations />);
    expect(run).not.toHaveBeenCalled();
    expect(html).toContain('Production sending is default-off');
    expect(html).toContain('Preparing held intents does not send email');
    expect(html).toContain('Checking operations');
    expect(html).toMatch(/disabled=""[^>]*>Prepare staging intents/);
    expect(html).toMatch(/disabled=""[^>]*>Dispatch reviewed staging test/);
  });

  it('prepares only when ready and dispatches only with the separate allowlisted gate', () => {
    expect(affiliateNotificationOperationAvailability(null)).toEqual({ prepare: false, dispatch: false });
    expect(affiliateNotificationOperationAvailability(status())).toEqual({ prepare: true, dispatch: false });
    expect(affiliateNotificationOperationAvailability(status({ deliveryGate: 'allowed' }))).toEqual({ prepare: true, dispatch: true });
    for (const state of ['disabled', 'blocked', 'failed'] as const) {
      expect(affiliateNotificationOperationAvailability(status({ status: state, deliveryGate: 'allowed' }))).toEqual({ prepare: false, dispatch: false });
    }
    expect(affiliateNotificationOperationAvailability(status({ deliveryGate: 'allowed', cursor: { busy: true } }))).toEqual({ prepare: false, dispatch: false });
    expect(affiliateNotificationOperationAvailability(status({ deliveryGate: 'allowed' }), true)).toEqual({ prepare: false, dispatch: false });
    expect(affiliateNotificationOperationAvailability(status({ deliveryGate: 'allowed', environmentMode: 'production_test' }))).toEqual({ prepare: false, dispatch: false });
  });

  it('never presents disabled zero counts as proof there is no historical queue', () => {
    const html = markup(status({ status: 'disabled', sampledDeliveries: 0, preparedIntents: 0 }));
    expect(html).toContain('No operational records were queried');
    expect(html).not.toContain('Delivery records sampled');
    expect(html).not.toContain('Held intent records');
  });

  it('labels held records, bounded samples, retries and dead letters honestly', () => {
    const html = markup(status({ truncated: { deliveries: true, intents: true } }));
    expect(html).toContain('Partial snapshot: limits were reached');
    expect(html).toContain('not complete totals');
    expect(html).toContain('previously processed records');
    expect(html).toContain('not the remaining-send queue');
    expect(html).toContain('Waiting for retry');
    expect(html).toContain('Needs investigation');
    expect(html).toContain('no background polling');
  });

  it('shows only approved aggregate labels and never raw identifiers or overflow payloads', () => {
    const html = markup(status({ counts: { delivered: 2, 'private@example.test': 10, 'ani1_secret_token': 1 } }), {
      result: result({ status: 'overflow', overflow: ['private@example.test', 'secret_signing_value'], hasMore: true }),
    });
    expect(html).toContain('reviewed batch limits');
    expect(html).toContain('More records remain');
    expect(html).not.toContain('private@example.test');
    expect(html).not.toContain('ani1_secret_token');
    expect(html).not.toContain('secret_signing_value');
  });

  it('keeps controls accessible, disabled during work and clear about unsaved changes', () => {
    const html = markup(status({ deliveryGate: 'allowed' }), { busy: 'dispatch', disabled: true });
    expect(html).toContain('aria-labelledby="affiliate-notification-operations-heading"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Save pending template changes');
    expect(html).toContain('Running reviewed staging test');
    expect(html).toMatch(/disabled=""[^>]*>Prepare staging intents/);
  });

  it('blocks stale or disallowed dispatch at the event boundary without prompting or calling the API', async () => {
    const run = vi.fn(async () => ({ success: true, result: result() }));
    const confirmDispatch = vi.fn(() => true);
    expect(await requestAffiliateNotificationOperation({ mode: 'dispatch', runtime: status(), locked: false, confirmDispatch, run })).toBeNull();
    expect(run).not.toHaveBeenCalled(); expect(confirmDispatch).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation before staging dispatch and never confirms preparation as an email send', async () => {
    const response = result({ mode: 'dispatch' });
    const run = vi.fn(async () => ({ success: true, result: response }));
    const declined = vi.fn(() => false);
    expect(await requestAffiliateNotificationOperation({ mode: 'dispatch', runtime: status({ deliveryGate: 'allowed' }), locked: false, confirmDispatch: declined, run })).toBeNull();
    expect(run).not.toHaveBeenCalled();
    const accepted = vi.fn(() => true);
    expect(await requestAffiliateNotificationOperation({ mode: 'dispatch', runtime: status({ deliveryGate: 'allowed' }), locked: false, confirmDispatch: accepted, run })).toEqual(response);
    expect(accepted).toHaveBeenCalledWith(expect.stringContaining('does not enable production email'));
    expect(run).toHaveBeenLastCalledWith('dispatch');
    accepted.mockClear();
    await requestAffiliateNotificationOperation({ mode: 'prepare', runtime: status(), locked: false, confirmDispatch: accepted, run });
    expect(accepted).not.toHaveBeenCalled(); expect(run).toHaveBeenLastCalledWith('prepare');
  });

  it('makes production dispatch honest about real emails rather than calling it a staging test', async () => {
    const runtime = status({ environmentMode: 'production_live', deliveryGate: 'allowed' });
    const html = markup(runtime);
    expect(html).toContain('Dispatch reviewed production batch');
    expect(html).toContain('Production preparation is available under its current review');
    expect(html).not.toContain('Dispatch reviewed staging test');
    const confirmDispatch = vi.fn(() => true);
    const run = vi.fn(async () => ({ success: true, result: result({ mode: 'dispatch' }) }));
    await requestAffiliateNotificationOperation({ mode: 'dispatch', runtime, locked: false, confirmDispatch, run });
    expect(confirmDispatch).toHaveBeenCalledWith(expect.stringContaining('real affiliate emails'));
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('notification operations API helpers', () => {
  it('uses no-store writer authentication and cancellation on the aggregate status endpoint', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', removeItem: vi.fn() });
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, runtime: status() }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await api.getAdminAffiliateNotificationRuntime({ signal: controller.signal });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/admin/affiliates/notifications/runtime');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { 'x-admin-token': 'cookie-session' } });
  });

  it('posts only the selected mode, never recipients, secrets, source records or a client-selected audience', async () => {
    vi.stubGlobal('localStorage', { getItem: () => '1', removeItem: vi.fn() });
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => ({ success: true, result: result() }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await api.runAdminAffiliateNotificationRuntime('prepare', { signal: controller.signal });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/admin/affiliates/notifications/runtime');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', cache: 'no-store', signal: controller.signal, headers: { 'x-admin-token': 'cookie-session' } });
    expect(JSON.parse(init!.body as string)).toEqual({ mode: 'prepare' });
  });
});

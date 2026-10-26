// The head request overlaps initial JavaScript delivery; it must not survive a
// navigation/authentication change or become a cache for later CMS refreshes.
export const PUBLIC_BOOTSTRAP_PATH = '/api/public/bootstrap';
const MAX_HANDOFF_AGE_MS = 15_000;

interface InitialBootstrapSlot {
  startedAt: number;
  take(): Promise<{ response: Response | null }> | null;
  cancel(): void;
}

type BootstrapWindow = Window & { __IW_INITIAL_BOOTSTRAP__?: InitialBootstrapSlot };

export function discardEarlyPublicBootstrap(): void {
  if (typeof window === 'undefined') return;
  const target = window as BootstrapWindow;
  const slot = target.__IW_INITIAL_BOOTSTRAP__;
  delete target.__IW_INITIAL_BOOTSTRAP__;
  slot?.cancel();
}

export function takeEarlyPublicBootstrap(): Promise<Response> | undefined {
  if (typeof window === 'undefined') return undefined;
  const slot = (window as BootstrapWindow).__IW_INITIAL_BOOTSTRAP__;
  if (!slot) return undefined;
  const age = Date.now() - slot.startedAt;
  // A backgrounded page may delay the inline expiry timer. Check again at use.
  if (!Number.isFinite(age) || age < 0 || age >= MAX_HANDOFF_AGE_MS) {
    discardEarlyPublicBootstrap();
    return undefined;
  }
  const request = slot.take();
  if (!request) return undefined;
  return request.then(({ response }) => response || fetch(PUBLIC_BOOTSTRAP_PATH, {
    cache: 'no-store', credentials: 'include',
  }));
}

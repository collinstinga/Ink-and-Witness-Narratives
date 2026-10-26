import { describe, expect, it, vi } from 'vitest';
import { containPortalGuideKeyboardEvent } from './portalGuideFocus.js';

function fixture(single = false) {
  const first = { focus: vi.fn(), getClientRects: () => [1] };
  const last = single ? first : { focus: vi.fn(), getClientRects: () => [1] };
  const controls = single ? [first] : [first, last];
  const document: { activeElement: unknown } = { activeElement: first };
  const dialog = { ownerDocument: document, querySelectorAll: () => controls, contains: (node: unknown) => controls.includes(node as typeof first), focus: vi.fn() };
  const event = { key: 'Tab', shiftKey: false, currentTarget: dialog as unknown as HTMLDialogElement, preventDefault: vi.fn(), stopPropagation: vi.fn() };
  return { first, last, document, dialog, event };
}

describe('help dialog keyboard boundary', () => {
  it('cycles both directions when a loading dialog has a single control', () => {
    const f = fixture(true);
    containPortalGuideKeyboardEvent(f.event);
    containPortalGuideKeyboardEvent({ ...f.event, shiftKey: true });
    expect(f.first.focus).toHaveBeenCalledTimes(2);
    expect(f.event.preventDefault).toHaveBeenCalledTimes(2);
  });
  it('wraps only at the first/last control, preserving ordinary navigation', () => {
    const f = fixture();
    containPortalGuideKeyboardEvent(f.event);
    expect(f.event.preventDefault).not.toHaveBeenCalled();
    containPortalGuideKeyboardEvent({ ...f.event, shiftKey: true });
    expect(f.last.focus).toHaveBeenCalledTimes(1);
    f.document.activeElement = f.last;
    containPortalGuideKeyboardEvent(f.event);
    expect(f.first.focus).toHaveBeenCalledTimes(1);
  });
  it('does not prevent native Escape and never lets keyboard events reach the surrounding portal', () => {
    const f = fixture();
    containPortalGuideKeyboardEvent({ ...f.event, key: 'Escape' });
    expect(f.event.preventDefault).not.toHaveBeenCalled();
    expect(f.event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(f.first.focus).not.toHaveBeenCalled();
  });
  it('wraps forward from a programmatically focused topic heading after the last control', () => {
    const f = fixture();
    const heading = { compareDocumentPosition: () => 2 };
    f.document.activeElement = heading;
    f.dialog.contains = (node: unknown) => node === heading || node === f.first || node === f.last;
    containPortalGuideKeyboardEvent(f.event);
    expect(f.first.focus).toHaveBeenCalledTimes(1);
    expect(f.event.preventDefault).toHaveBeenCalledTimes(1);
  });
});

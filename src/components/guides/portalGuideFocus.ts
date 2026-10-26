/** Keep Tab within help even when a loading/error dialog has only one button. */
export function containPortalGuideKeyboardEvent(event: {
  key: string;
  shiftKey: boolean;
  currentTarget: HTMLDialogElement;
  preventDefault: () => void;
  stopPropagation: () => void;
}): void {
  event.stopPropagation();
  if (event.key !== 'Tab') return; // Preserve the native Escape/cancel action.
  const dialog = event.currentTarget;
  const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
  )).filter(control => control.getClientRects().length > 0);
  const first = controls[0];
  const last = controls.at(-1);
  const active = dialog.ownerDocument.activeElement;
  if (!first || !last) {
    event.preventDefault();
    dialog.focus();
  } else if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

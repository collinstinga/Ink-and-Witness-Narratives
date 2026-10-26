import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PortalGuideLoadBoundary, PortalGuideLoading } from './PortalGuideLoadBoundary.js';

describe('guide-only load failure isolation', () => {
  it('leaves normal children intact', () => {
    expect(renderToStaticMarkup(<PortalGuideLoadBoundary onClose={vi.fn()}><p>Help content</p></PortalGuideLoadBoundary>)).toBe('<p>Help content</p>');
  });
  it('uses a named native modal even while the help chunk is loading', () => {
    const close = vi.fn();
    const markup = renderToStaticMarkup(<PortalGuideLoading onClose={close} />);
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-label="Loading Guide &amp; Demo"');
    expect(markup).toContain('Your current form remains unchanged');
    expect(markup).toContain('Close guide');
    expect(close).not.toHaveBeenCalled();
  });
  it('renders an explicit save-first fallback without a reload or dashboard action', () => {
    const close = vi.fn();
    const boundary = new PortalGuideLoadBoundary();
    Object.defineProperty(boundary, 'props', { value: { onClose: close, children: <p>Unused</p> } });
    boundary.state = { failed: true };
    const markup = renderToStaticMarkup(boundary.render());
    expect(markup).toContain('Guide could not load');
    expect(markup).toContain('save any unfinished edits');
    expect(markup).toContain('Close help and keep working');
    expect(markup).not.toContain('location.reload');
    expect(close).not.toHaveBeenCalled();
  });
});

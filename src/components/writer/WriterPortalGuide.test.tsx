import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WRITER_PORTAL_GUIDE } from '../../data/writerPortalGuide.js';
import { WriterPortalGuide } from './WriterPortalGuide.js';

const dialogSpy = vi.hoisted(() => vi.fn());
vi.mock('../guides/PortalGuideDialog.js', () => ({
  PortalGuideDialog: (props: Record<string, unknown>) => {
    dialogSpy(props);
    return <div data-testid="writer-guide-dialog" />;
  },
}));

describe('WriterPortalGuide', () => {
  it('provides permanent content and close control without navigation or mutation handlers', () => {
    const onClose = vi.fn();
    const markup = renderToStaticMarkup(<WriterPortalGuide open onClose={onClose} />);
    expect(markup).toContain('writer-guide-dialog');
    const props = dialogSpy.mock.lastCall?.[0];
    expect(props).toEqual({ guide: WRITER_PORTAL_GUIDE, open: true, onClose });
    expect(props.onNavigate).toBeUndefined();
    props.onClose();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('passes the explicit closed state to the shared dialog', () => {
    const onClose = vi.fn();
    renderToStaticMarkup(<WriterPortalGuide open={false} onClose={onClose} />);
    expect(dialogSpy.mock.lastCall?.[0].open).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });
});

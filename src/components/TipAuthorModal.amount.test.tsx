import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TipAuthorModal } from './TipAuthorModal.js';

describe('tip author amount selection', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lets the reader enter any whole-shilling amount from KSh 1', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });

    const markup = renderToStaticMarkup(
      <TipAuthorModal isOpen onClose={() => {}} />
    );

    expect(markup).toContain('Choose a Tip Amount');
    expect(markup).toContain('Enter any amount in KES');
    expect(markup).toContain('min="1"');
    expect(markup).toContain('step="1"');
    expect(markup).toContain('Any amount from KSh 1');
    expect(markup).not.toContain('Minimum tip: KSh 300');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WriterMedia } from './WriterMedia.js';

describe('WriterMedia loading boundary', () => {
  it('renders a safe loading state while the author profile is still resolving', () => {
    expect(() => renderToStaticMarkup(
      <WriterMedia
        author={null}
        pieces={[]}
        onAuthorUpdated={vi.fn()}
        onPiecesUpdated={vi.fn()}
      />
    )).not.toThrow();

    const markup = renderToStaticMarkup(
      <WriterMedia
        author={null}
        pieces={[]}
        onAuthorUpdated={vi.fn()}
        onPiecesUpdated={vi.fn()}
      />
    );
    expect(markup).toContain('id="writer-media-loading"');
    expect(markup).toContain('Loading Media &amp; Branding safely');
  });
});

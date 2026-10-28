import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Article } from '../../types.js';
import { WriterEditor } from './WriterEditor.js';

const renderEditor = (initialArticle: Article | null) => renderToStaticMarkup(
  <WriterEditor initialArticle={initialArticle} onSave={vi.fn()} onCancel={vi.fn()} onPreview={vi.fn()} />,
);

describe('writer publication format and accessible text formatting', () => {
  it('defaults a new publication to an individual piece and labels formatting controls', () => {
    const markup = renderEditor(null);
    expect(markup).toMatch(/checked=""[^>]*name="publication-format"[^>]*value="individual"|name="publication-format"[^>]*checked=""[^>]*value="individual"/);
    expect(markup).toContain('Book chapter');
    expect(markup).toContain('aria-label="Bold selected text"');
    expect(markup).toContain('aria-label="Italicize selected text"');
    expect(markup).toContain('aria-label="Heading label"');
    expect(markup).toContain('Heading 2 — section');
    expect(markup).toContain('Preview formatting');
    expect(markup).toContain('aria-label="Piece content"');
  });

  it('keeps an existing chapter choice and original Markdown content', () => {
    const markup = renderEditor({
      id: 'owned-chapter',
      title: 'Chapter one',
      content: '## Quiet\nA **bold** and *soft* sentence.',
      publicationType: 'chapter',
    } as Article);
    expect(markup).toMatch(/checked=""[^>]*name="publication-format"[^>]*value="chapter"|name="publication-format"[^>]*checked=""[^>]*value="chapter"/);
    expect(markup).toContain('## Quiet\nA **bold** and *soft* sentence.');
    expect(markup).toContain('choose its book and chapter order');
  });
});

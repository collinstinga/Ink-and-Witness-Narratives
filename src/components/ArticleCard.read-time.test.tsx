import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ArticleCard } from './ArticleCard.js';
import type { Article } from '../types.js';

const article: Article = {
  id: 'read-time-piece',
  title: 'A Quiet Chapter',
  subtitle: '',
  slug: 'a-quiet-chapter',
  excerpt: 'An excerpt.',
  content: '',
  category: 'Essays',
  status: 'published',
  isPaid: false,
  priceKes: 0,
  readTimeMinutes: 7,
  publishedAt: '2026-09-17',
  createdAt: '2026-09-17T00:00:00.000Z',
  updatedAt: '2026-09-17T00:00:00.000Z',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: []
};

function renderCard(piece: Article): string {
  return renderToStaticMarkup(
    <ArticleCard
      article={piece}
      isUnlocked
      onRead={vi.fn()}
      onUnlock={vi.fn()}
    />
  );
}

describe('piece reading-time visibility', () => {
  it('keeps the estimate visible for existing pieces without a visibility setting', () => {
    expect(renderCard(article)).toContain('7 min read');
  });

  it('hides the estimate only when explicitly disabled for that piece', () => {
    const html = renderCard({ ...article, showReadTime: false });
    expect(html).not.toContain('min read');
    expect(html).toContain('2026-09-17');
  });
});

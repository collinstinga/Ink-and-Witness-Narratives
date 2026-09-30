import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArticleReaderModal, selectReaderRecommendations } from './ArticleReaderModal.js';
import type { Article } from '../types.js';

const article: Article = {
  id: 'cover-test',
  title: 'A Book of Stories',
  subtitle: '',
  slug: 'a-book-of-stories',
  excerpt: 'A short preview.',
  content: 'The first paragraph.',
  category: 'Fiction',
  status: 'published',
  isPaid: true,
  priceKes: 1050,
  readTimeMinutes: 5,
  publishedAt: '2026-09-17',
  createdAt: '2026-09-17',
  updatedAt: '2026-09-17',
  coverImage: '/api/articles/cover-test/cover?v=1',
  downloadsCount: 0,
  previewParagraphs: [],
  tags: []
};

function renderReader(isUnlocked: boolean, piece: Article = article): string {
  return renderToStaticMarkup(
    <ArticleReaderModal
      article={piece}
      isOpen
      isUnlocked={isUnlocked}
      onClose={() => {}}
      onUnlockRequest={() => {}}
    />
  );
}

describe('article reader cover', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the full cover alongside an unlocked piece', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const markup = renderReader(true);

    expect(markup).toContain('id="reader-unlocked-cover"');
    expect(markup).toContain('src="/api/articles/cover-test/cover?v=1"');
    expect(markup).toContain('alt="A Book of Stories cover"');
  });

  it('does not add the unlocked cover to a locked preview', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(renderReader(false)).not.toContain('id="reader-unlocked-cover"');
  });

  it('hides estimated reading time when the writer disables it for a piece', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    expect(renderReader(false, { ...article, showReadTime: false })).not.toContain('min read');
    expect(renderReader(true, { ...article, showReadTime: false })).not.toContain('min read');
    expect(renderReader(true)).toContain('5 min read');
  });

  it('shows curated and relevant published pieces only after the read is unlocked', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    const curated: Article = {
      ...article,
      id: 'curated-piece',
      slug: 'curated-piece',
      title: 'The Curated Next Read',
      isPaid: false
    };
    const fallback: Article = {
      ...article,
      id: 'related-piece',
      slug: 'related-piece',
      title: 'A Related Published Read',
      publishedAt: '2026-09-18'
    };
    const draft: Article = {
      ...article,
      id: 'private-draft',
      slug: 'private-draft',
      title: 'Private Draft',
      status: 'draft'
    };
    const current = { ...article, manualRelatedPieceIds: [curated.id] };
    const props = {
      article: current,
      isOpen: true,
      onClose: () => {},
      onUnlockRequest: () => {},
      articles: [current, fallback, draft, curated],
      onReadArticle: () => {}
    };

    const unlockedMarkup = renderToStaticMarkup(<ArticleReaderModal {...props} isUnlocked />);
    const lockedMarkup = renderToStaticMarkup(<ArticleReaderModal {...props} isUnlocked={false} />);

    expect(unlockedMarkup).toContain('id="reader-more-pieces"');
    expect(unlockedMarkup).toContain('The Curated Next Read');
    expect(unlockedMarkup).toContain('A Related Published Read');
    expect(unlockedMarkup).not.toContain('Private Draft');
    expect(lockedMarkup).not.toContain('id="reader-more-pieces"');
  });

  it('keeps writer-curated recommendations first and excludes the current piece', () => {
    const curated = { ...article, id: 'curated', title: 'Curated', status: 'published' as const };
    const newer = {
      ...article,
      id: 'newer',
      title: 'Newer',
      publishedAt: '2026-09-20',
      status: 'published' as const
    };
    const recommendations = selectReaderRecommendations(
      { ...article, manualRelatedPieceIds: ['curated'] },
      [newer, article, curated]
    );

    expect(recommendations.map(piece => piece.id)).toEqual(['curated', 'newer']);
  });
});

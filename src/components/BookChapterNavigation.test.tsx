import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Article, ContentBundle } from '../types.js';
import { BookChapterNavigation } from './BookChapterNavigation.js';

const chapters = ['first', 'second', 'third'].map(id => ({ id, title: `Chapter ${id}`, status: 'published', content: 'PRIVATE PAID TEXT' } as Article));
const book = { id: 'book', kind: 'book', name: 'The Complete Book', isPublished: true, pieceIds: chapters.map(item => item.id) } as ContentBundle;

describe('book chapter navigation', () => {
  it('shows chapter position, ordered contents and previous/next without paid text', () => {
    const onRead = vi.fn();
    const markup = renderToStaticMarkup(<BookChapterNavigation context={{ book, chapters }} articleId="second" onReadArticle={onRead} />);
    expect(markup).toContain('Chapter 2 of 3');
    expect(markup).toContain('Previous chapter: Chapter first');
    expect(markup).toContain('Next chapter: Chapter third');
    expect(markup).toContain('aria-current="page"');
    expect(markup.indexOf('1. Chapter first')).toBeLessThan(markup.indexOf('2. Chapter second'));
    expect(markup).not.toContain('PRIVATE PAID TEXT');
    expect(onRead).not.toHaveBeenCalled();
  });

  it('keeps boundaries disabled and ignores invalid or unpublished contexts', () => {
    const first = renderToStaticMarkup(<BookChapterNavigation context={{ book, chapters }} articleId="first" onReadArticle={vi.fn()} />);
    expect(first).toContain('No previous chapter');
    expect(first).toContain('disabled=""');
    expect(renderToStaticMarkup(<BookChapterNavigation context={{ book, chapters }} articleId="missing" onReadArticle={vi.fn()} />)).toBe('');
    expect(renderToStaticMarkup(<BookChapterNavigation context={{ book: { ...book, isPublished: false }, chapters }} articleId="first" onReadArticle={vi.fn()} />)).toBe('');
  });
});

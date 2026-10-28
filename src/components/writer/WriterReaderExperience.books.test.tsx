import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ContentBundle } from '../../types.js';
import { WriterReaderExperience, createWriterBundleEditor, createWriterBundlePayload, moveBookChapter } from './WriterReaderExperience.js';

const draft = {
  id: 'original-book-id',
  updatedAt: '2026-10-28T13:00:00.000Z',
  name: 'The same story',
  description: 'Three original pieces, one ordered book.',
  pieceIds: ['chapter-c', 'chapter-a', 'chapter-b'],
  isPublished: true,
  order: 0,
  priceKes: 500,
  coverImage: '/uploads/book-cover.jpg',
  coverPositionX: 27,
  coverPositionY: 66,
  showChaptersSeparately: false,
  existingOwnerPricing: 'remaining_chapters' as const,
};

describe('writer chaptered book controls', () => {
  it('offers explicit book creation without automatic title-based merging', () => {
    const markup = renderToStaticMarkup(<WriterReaderExperience articles={[]} />);
    expect(markup).toContain('New Book');
    expect(markup).toContain('New Bundle');
    expect(markup).toContain('New Collection');
    expect(markup).toContain('without deleting originals');
    expect(markup).toContain('existing chapter purchases stay valid');
  });

  it('reorders stable original chapter IDs without mutating the selected list', () => {
    const original = ['one', 'two', 'three'];
    expect(moveBookChapter(original, 'two', -1)).toEqual(['two', 'one', 'three']);
    expect(moveBookChapter(original, 'two', 1)).toEqual(['one', 'three', 'two']);
    expect(original).toEqual(['one', 'two', 'three']);
    expect(moveBookChapter(original, 'one', -1)).toBe(original);
    expect(moveBookChapter(original, 'three', 1)).toBe(original);
    expect(moveBookChapter(original, 'missing', 1)).toBe(original);
  });

  it('saves chapter order and explicit ownership pricing without migrating chapter data', () => {
    const payload = createWriterBundlePayload(draft, 'book');
    expect(payload).toEqual({
      id: 'original-book-id',
      updatedAt: '2026-10-28T13:00:00.000Z',
      kind: 'book',
      name: draft.name,
      description: draft.description,
      pieceIds: draft.pieceIds,
      isPublished: true,
      priceKes: 500,
      coverImage: draft.coverImage,
      coverPosition: { x: 27, y: 66 },
      showChaptersSeparately: false,
      existingOwnerPricing: 'remaining_chapters',
    });
    expect(payload.pieceIds).not.toBe(draft.pieceIds);
    expect(payload).not.toHaveProperty('content');
    expect(payload).not.toHaveProperty('licenses');
  });

  it('does not attach book-only pricing or visibility policy to normal bundles', () => {
    const payload = createWriterBundlePayload(draft, 'bundle');
    expect(payload.kind).toBe('bundle');
    expect(payload.pieceIds).toEqual(draft.pieceIds);
    expect(payload).not.toHaveProperty('existingOwnerPricing');
    expect(payload).not.toHaveProperty('showChaptersSeparately');
  });

  it('uses the opened book revision for compare-and-set but omits revisions when creating', () => {
    expect(createWriterBundlePayload(draft, 'book').updatedAt).toBe(draft.updatedAt);
    const created = createWriterBundlePayload({ ...draft, id: undefined }, 'book');
    expect(created).not.toHaveProperty('updatedAt');
  });

  it('retains the canonical acknowledgement revision and chapter order for sequential edits', () => {
    const acknowledgement: ContentBundle = {
      ...createWriterBundlePayload(draft, 'book'),
      id: 'original-book-id',
      name: 'Canonical saved title',
      description: draft.description,
      slug: 'canonical-saved-title',
      pieceIds: ['chapter-b', 'chapter-c', 'chapter-a'],
      priceKes: 450,
      isPublished: true,
      createdAt: '2026-10-28T12:00:00.000Z',
      updatedAt: '2026-10-28T14:00:00.000Z',
    };
    const nextDraft = createWriterBundleEditor(acknowledgement);
    expect(nextDraft.id).toBe(acknowledgement.id);
    expect(nextDraft.updatedAt).toBe(acknowledgement.updatedAt);
    expect(nextDraft.name).toBe(acknowledgement.name);
    expect(nextDraft.priceKes).toBe(450);
    expect(nextDraft.pieceIds).toEqual(acknowledgement.pieceIds);
    expect(nextDraft.pieceIds).not.toBe(acknowledgement.pieceIds);
    expect(createWriterBundlePayload({ ...nextDraft, priceKes: 475 }, 'book').updatedAt).toBe(acknowledgement.updatedAt);
    expect(draft.updatedAt).toBe('2026-10-28T13:00:00.000Z');
  });
});

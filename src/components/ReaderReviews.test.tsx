import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PieceReview, PieceSocialProof } from '../types.js';
import { PublicReaderProof, ReaderReviewForm, publicReaderReviews } from './ReaderReviews.js';

const approved: PieceReview = { id: 'review-one', articleId: 'piece-one', rating: 5, review: 'An approved and verified response.', status: 'approved', featured: true,
  verifiedReader: true, createdAt: '2026-10-29T12:00:00.000Z', updatedAt: '2026-10-29T12:00:00.000Z' };
const social: PieceSocialProof = { articleId: 'piece-one', reactionCounts: { this_hurt: 0, felt_seen: 0, beautiful: 0, reread: 0, damn: 0 },
  verifiedReviewCount: 1, averageRating: 5, completedReadCount: 1, purchaseCount: 1, viewCount: 2, testimonials: [approved], reviews: [approved] };

describe('public reader proof and independent review submissions', () => {
  it('shows approved proof before purchase without duplicating featured reviews', () => {
    const markup = renderToStaticMarkup(<PublicReaderProof articleId="piece-one" socialProof={social} />);
    expect(markup).toContain('An approved and verified response.');
    expect(markup.match(/An approved and verified response\./g)).toHaveLength(1);
    expect(markup).toContain('Featured testimonial');
    expect(markup).toContain('One rating per verified reader and piece');
    expect(markup).not.toContain('<form');
  });
  it('fails closed for pending, hidden, unverified or different-piece responses', () => {
    const injected = { ...social, testimonials: [], reviews: [
      { ...approved, id: 'pending', status: 'pending' as const, review: 'Pending text must stay private.' },
      { ...approved, id: 'hidden', status: 'hidden' as const, review: 'Hidden text must stay private.' },
      { ...approved, id: 'foreign', articleId: 'another-piece', review: 'Foreign piece text.' },
      { ...approved, id: 'unverified', verifiedReader: false, review: 'Unverified reader text.' } as unknown as PieceReview,
    ] };
    expect(publicReaderReviews('piece-one', injected)).toEqual([]);
    const markup = renderToStaticMarkup(<PublicReaderProof articleId="piece-one" socialProof={injected} />);
    expect(markup).not.toMatch(/Pending text|Hidden text|Foreign piece text|Unverified reader text/);
    expect(publicReaderReviews('different-piece', social)).toEqual([]);
  });
  it('keeps verified submission eligibility at 80% and labels independent responses and moderation', () => {
    const markup = renderToStaticMarkup(<ReaderReviewForm articleId="piece-one" progressPercent={79} />);
    expect(markup).toContain('Submit more than one response');
    expect(markup).toContain('each awaits writer approval');
    expect(markup).toMatch(/<textarea[^>]*disabled/);
    expect(markup).toContain('for="reader-review-rating"');
    expect(markup).toContain('for="reader-review-text"');
  });
});

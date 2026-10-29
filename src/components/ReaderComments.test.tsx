import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ReaderComments, ReaderCommentList, createReaderCommentAttempt } from './ReaderComments.js';
import type { PieceComment } from '../types.js';

const comment: PieceComment = {
  id: 'comment-one', articleId: 'piece-one', readerName: 'A reader', content: 'A public thought',
  readerEmail: 'never-public@example.invalid', readerHash: 'account_private',
  status: 'approved', createdAt: '2026-10-28T12:00:00.000Z'
};

describe('reader comments moderation and multiple submissions', () => {
  it('never renders pending, hidden or deleted comments in the public list, even if supplied', () => {
    const markup = renderToStaticMarkup(<ReaderCommentList comments={[
      comment,
      { ...comment, id: 'pending', content: 'Unapproved text', status: 'pending' },
      { ...comment, id: 'hidden', content: 'Hidden text', status: 'hidden' },
      { ...comment, id: 'deleted', content: 'Deleted text', status: 'deleted' },
    ]} />);
    expect(markup).toContain('A public thought');
    expect(markup).not.toContain('Unapproved text');
    expect(markup).not.toContain('Hidden text');
    expect(markup).not.toContain('Deleted text');
    expect(markup).not.toContain(comment.readerEmail);
    expect(markup).not.toContain(comment.readerHash);
  });

  it('labels private pending comments without exposing email or ownership keys', () => {
    const markup = renderToStaticMarkup(<ReaderCommentList privateView comments={[{ ...comment, status: 'pending' }]} />);
    expect(markup).toContain('Awaiting writer approval');
    expect(markup).toContain('visible only to you and the writer');
    expect(markup).not.toContain(comment.readerEmail);
    expect(markup).not.toContain(comment.readerHash);
  });

  it('makes the per-comment review policy and repeated commenting explicit', () => {
    const markup = renderToStaticMarkup(<ReaderComments articleId="piece-one" readerId="reader-one" canComment />);
    expect(markup).toContain('Every new comment is reviewed');
    expect(markup).toContain('You can submit more than one comment');
    expect(markup).toContain('Submit for approval');
    expect(markup).not.toContain('Comment posted');
  });

  it('reuses the same attempt for a network retry but assigns a fresh ID to subsequent intentional submissions', () => {
    const createId = vi.fn().mockReturnValueOnce('submission-one-12345').mockReturnValueOnce('submission-two-12345');
    const first = createReaderCommentAttempt(null, 'piece-one', '  Beautiful  ', createId);
    const retry = createReaderCommentAttempt(first, 'piece-one', 'Beautiful', createId);
    const next = createReaderCommentAttempt(null, 'piece-one', 'Beautiful', createId);
    expect(retry).toBe(first);
    expect(next.submissionId).not.toBe(first.submissionId);
    expect(createId).toHaveBeenCalledTimes(2);
  });

  it('does not reuse an attempt for a different piece or changed text', () => {
    const first = { articleId: 'piece-one', content: 'Beautiful', submissionId: 'submission-one-12345' };
    const createId = () => 'submission-two-12345';
    expect(createReaderCommentAttempt(first, 'piece-two', 'Beautiful', createId).submissionId).toBe('submission-two-12345');
    expect(createReaderCommentAttempt(first, 'piece-one', 'A new thought', createId).submissionId).toBe('submission-two-12345');
  });
});

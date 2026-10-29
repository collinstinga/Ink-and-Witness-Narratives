import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommentPublicationConfirmation, WriterComments } from './WriterComments.js';
import type { PieceComment } from '../../types.js';

const comment: PieceComment = {
  id: 'comment-one', articleId: 'piece-one', readerName: 'A Reader', content: '<script>unsafe()</script> A thoughtful response.',
  readerEmail: 'private@example.invalid', readerHash: 'account_private', status: 'pending', createdAt: '2026-10-28T12:00:00.000Z'
};

describe('writer explicit comment publication', () => {
  it('provides a pending queue and explains that new comments are not automatically public', () => {
    const markup = renderToStaticMarkup(<WriterComments articles={[]} />);
    expect(markup).toContain('Every new reader comment waits here');
    expect(markup).toContain('Awaiting Approval');
    expect(markup).toContain('Pending');
    expect(markup).not.toContain('Publish this comment publicly?');
  });

  it('requires a separate, explicit confirmation and previews only the intended public content', () => {
    const markup = renderToStaticMarkup(<CommentPublicationConfirmation comment={comment} busy={false} onConfirm={() => {}} onCancel={() => {}} />);
    expect(markup).toContain('Publish this comment publicly?');
    expect(markup).toContain('Confirm public publication');
    expect(markup).toContain('Cancel publication');
    expect(markup).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain(comment.readerEmail);
    expect(markup).not.toContain(comment.readerHash);
  });
});

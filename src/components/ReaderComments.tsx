import React, { useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import type { PieceComment } from '../types.js';
import { api } from '../utils/api.js';

export interface ReaderCommentAttempt {
  articleId: string;
  content: string;
  submissionId: string;
}

export function createReaderCommentAttempt(
  previous: ReaderCommentAttempt | null,
  articleId: string,
  content: string,
  createId: () => string = () => globalThis.crypto.randomUUID()
): ReaderCommentAttempt {
  const cleanContent = content.trim();
  if (previous?.articleId === articleId && previous.content === cleanContent) return previous;
  return { articleId, content: cleanContent, submissionId: createId() };
}

export function ReaderCommentList({ comments, privateView = false }: { comments: PieceComment[]; privateView?: boolean }) {
  const visible = comments.filter(comment => privateView
    ? comment.status === 'pending' || comment.status === 'hidden'
    : comment.status === 'approved');
  return <div className="space-y-2">
    {visible.slice(0, 20).map(comment => <article key={comment.id} className="rounded-xl border border-slate-800 bg-slate-950/55 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-sky-200">{privateView ? 'Your comment' : comment.readerName || 'Reader'}</p>
        <time className="text-[9px] font-mono text-slate-500" dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString()}</time>
      </div>
      {privateView && <p className="mt-1 text-[11px] text-amber-300">{comment.status === 'pending' ? 'Awaiting writer approval — visible only to you and the writer.' : 'Not published — visible only to you and the writer.'}</p>}
      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{comment.content}</p>
    </article>)}
  </div>;
}

export function ReaderComments({ articleId, readerId, canComment, onSignIn, compact = false }: {
  /** Reserved React identity; consumed by React, not received by this component. */
  key?: string;
  articleId: string;
  readerId?: string;
  canComment: boolean;
  onSignIn?: () => void;
  compact?: boolean;
}) {
  const [comments, setComments] = useState<PieceComment[]>([]);
  const [ownComments, setOwnComments] = useState<PieceComment[]>([]);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [loadError, setLoadError] = useState('');
  const attemptRef = useRef<ReaderCommentAttempt | null>(null);
  const ownMutationRef = useRef(0);

  useEffect(() => {
    let active = true;
    setComments([]);
    setOwnComments([]);
    setLoadError('');
    const mutationAtStart = ownMutationRef.current;
    void api.getPieceComments(articleId)
      .then(result => { if (active) setComments(result); })
      .catch(() => { if (active) setLoadError('Public comments could not be loaded.'); });
    if (readerId && canComment) {
      void api.getMyPieceComments(articleId)
        .then(result => {
          if (!active) return;
          setOwnComments(previous => {
            if (ownMutationRef.current === mutationAtStart) return result;
            const merged = new Map(result.map(comment => [comment.id, comment]));
            for (const comment of previous) merged.set(comment.id, comment);
            return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
          });
        })
        .catch(() => { if (active) setLoadError('Your comment status could not be loaded. Please reopen the piece to refresh.'); });
    }
    return () => { active = false; };
  }, [articleId, readerId, canComment]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || text.trim().length < 2) return;
    setSaving(true);
    setNotice('');
    try {
      const attempt = createReaderCommentAttempt(attemptRef.current, articleId, text);
      attemptRef.current = attempt;
      const comment = await api.submitPieceComment(articleId, attempt.content, attempt.submissionId);
      ownMutationRef.current += 1;
      setOwnComments(previous => [comment, ...previous.filter(item => item.id !== comment.id)]);
      // Clear only after a durable acknowledgement. Network retries retain the
      // same key; another intentional submission always receives a new key.
      attemptRef.current = null;
      setText('');
      setNotice(comment.status === 'approved'
        ? 'This earlier submission is already published. You can add another comment.'
        : 'Comment submitted for writer approval. You can add another comment; it is not public yet.');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Comment could not be submitted.';
      if (/sign.?in|session|authenticat|reader account/i.test(message)) onSignIn?.();
      setNotice(message);
    } finally {
      setSaving(false);
    }
  };
  const ownUnpublished = ownComments.filter(comment => comment.status === 'pending' || comment.status === 'hidden');
  return <div className="space-y-4 border-t border-slate-800 pt-5" aria-labelledby="reader-comments-title">
    <div>
      <h5 id="reader-comments-title" className="text-sm font-semibold text-white">Reader comments</h5>
      <p className="mt-1 text-[11px] text-slate-500">Every new comment is reviewed by the writer before publication. Public comments show a reader name only, never an account email.</p>
    </div>
    {loadError && <p role="status" className="text-xs text-amber-300">{loadError}</p>}
    {comments.some(comment => comment.status === 'approved')
      ? <>
        <ReaderCommentList comments={compact ? comments.filter(comment => comment.status === 'approved').slice(0, 2) : comments} />
        {compact && comments.filter(comment => comment.status === 'approved').length > 2 && <details>
          <summary className="cursor-pointer text-xs text-sky-300">More published comments</summary>
          <ReaderCommentList comments={comments.filter(comment => comment.status === 'approved').slice(2)} />
        </details>}
      </>
      : <p className="rounded-xl border border-dashed border-slate-800 px-3 py-4 text-center text-xs text-slate-500">No published reader comments yet.</p>}
    {readerId && ownUnpublished.length > 0 && <section aria-label="Your unpublished comments" className="space-y-2">
      <h6 className="text-xs font-semibold text-amber-200">Your unpublished comments</h6>
      <ReaderCommentList comments={ownUnpublished} privateView />
    </section>}
    {canComment && <form onSubmit={submit} className="space-y-2">
      <label htmlFor="reader-comment-input" className="text-xs font-semibold text-slate-300">Add a comment</label>
      <textarea id="reader-comment-input" value={text} onChange={event => setText(event.target.value)} minLength={2} maxLength={3000} rows={3}
        placeholder="Share a thoughtful response to this piece…" className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500" role="status">{notice || (readerId
          ? 'You can submit more than one comment. Each awaits writer approval.'
          : 'A reader session is required; submitting securely re-checks your sign-in.')}</p>
        <button type="submit" disabled={saving || text.trim().length < 2} className="inline-flex items-center gap-1.5 rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">
          <MessageCircle className="h-4 w-4" />{saving ? 'Submitting…' : 'Submit for approval'}
        </button>
      </div>
    </form>}
  </div>;
}

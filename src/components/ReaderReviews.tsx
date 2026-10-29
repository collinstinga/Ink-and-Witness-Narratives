import React, { useRef, useState } from 'react';
import type { PieceReview, PieceSocialProof } from '../types.js';
import { api } from '../utils/api.js';

export function publicReaderReviews(articleId: string, social: PieceSocialProof | null): PieceReview[] {
  if (!social || social.articleId !== articleId) return [];
  const selected = new Map<string, PieceReview>();
  for (const review of [...(social.testimonials || []), ...(social.reviews || [])]) {
    if (review.articleId === articleId && review.status === 'approved' && review.verifiedReader === true
      && Number.isInteger(review.rating) && review.rating >= 1 && review.rating <= 5) selected.set(review.id, review);
  }
  return [...selected.values()].slice(0, 24);
}

function PublicReviewCard({ review }: { key?: string; review: PieceReview }) {
  return <blockquote className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
    <div className="mb-2 text-xs text-amber-400">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</div>
    <p className="font-serif text-sm italic leading-relaxed text-slate-200">“{review.review}”</p>
    <footer className="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-400">{review.featured ? 'Featured testimonial · ' : ''}Verified reader</footer>
  </blockquote>;
}

export function PublicReaderProof({ articleId, socialProof, loading = false }: {
  articleId: string; socialProof: PieceSocialProof | null; loading?: boolean;
}) {
  const social = socialProof?.articleId === articleId ? socialProof : null;
  const reviews = publicReaderReviews(articleId, social);
  return <div className="space-y-4" aria-label="Approved reader reviews">
    {social && <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[
      ['Purchased', social.purchaseCount], ['Views', social.viewCount], ['Completed reads', social.completedReadCount], ['Verified reviewers', social.verifiedReviewCount],
    ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-center">
      <p className="font-display text-xl font-bold text-white">{Number(value).toLocaleString()}</p><p className="text-[10px] font-mono uppercase tracking-wider text-slate-500">{String(label)}</p>
    </div>)}</div>}
    <h5 className="text-sm font-semibold text-white">Verified reader reviews</h5>
    {social && social.verifiedReviewCount > 0 && <div>
      <p className="text-sm font-bold text-amber-300">{social.averageRating.toFixed(1)} / 5</p>
      <p className="mt-1 text-[11px] text-slate-500">One rating per verified reader and piece. Additional responses do not add extra votes. Written responses appear only after writer approval.</p>
    </div>}
    {reviews.length ? <>
      <div className="grid gap-3 sm:grid-cols-2">{reviews.slice(0, 2).map(review => <PublicReviewCard key={review.id} review={review} />)}</div>
      {reviews.length > 2 && <details><summary className="cursor-pointer text-xs text-sky-300">More approved reader responses ({reviews.length - 2})</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{reviews.slice(2).map(review => <PublicReviewCard key={review.id} review={review} />)}</div>
      </details>}
    </> : <p className="text-xs text-slate-500">{loading ? 'Loading approved reader responses…' : 'No published reader reviews yet.'}</p>}
  </div>;
}

export function ReaderReviewForm({ articleId, progressPercent, onSaved, onSignIn }: {
  key?: string; articleId: string; progressPercent: number; onSaved?: () => void; onSignIn?: () => void;
}) {
  const [rating, setRating] = useState(5), [text, setText] = useState('');
  const [saving, setSaving] = useState(false), [notice, setNotice] = useState('');
  const busy = useRef(false);
  const attempt = useRef<{ articleId: string; rating: number; text: string; id: string } | null>(null);
  const canReview = progressPercent >= 80;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !canReview || text.trim().length < 10) return;
    busy.current = true; setSaving(true); setNotice('');
    try {
      const clean = text.trim();
      if (!attempt.current || attempt.current.articleId !== articleId || attempt.current.rating !== rating || attempt.current.text !== clean) {
        attempt.current = { articleId, rating, text: clean, id: globalThis.crypto.randomUUID() };
      }
      const result = await api.savePieceReview(articleId, rating, clean, attempt.current.id);
      attempt.current = null; setText('');
      setNotice(`${result.message} You can submit another response without replacing your previous review.`);
      onSaved?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Review could not be saved.';
      if (/authenticat|sign in|reader account/i.test(message)) onSignIn?.();
      setNotice(message);
    } finally { busy.current = false; setSaving(false); }
  };
  return <form onSubmit={submit} className="space-y-3 border-t border-slate-800 pt-5" aria-label="Submit a verified reader response">
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div>
      <p className="text-sm font-semibold text-white">Leave a verified review</p>
      <p className="text-[11px] text-slate-500">Available after 80% reading progress. Submit more than one response; each awaits writer approval and earlier published reviews stay intact.</p>
    </div><div><label htmlFor="reader-review-rating" className="mr-2 text-xs text-slate-400">Rating</label>
      <select id="reader-review-rating" value={rating} disabled={saving} onChange={event => setRating(Number(event.target.value))} className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-amber-300">{[5, 4, 3, 2, 1].map(value => <option key={value} value={value}>{value} / 5</option>)}</select>
    </div></div>
    <label htmlFor="reader-review-text" className="block text-xs font-semibold text-slate-300">Your review or testimonial</label>
    <textarea id="reader-review-text" value={text} onChange={event => setText(event.target.value)} minLength={10} maxLength={2000} rows={3}
      placeholder={canReview ? 'Share what stayed with you…' : 'Continue reading to 80% to leave a review.'} disabled={!canReview || saving}
      className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50" />
    <div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-400" role="status">{notice}</p>
      <button type="submit" disabled={saving || text.trim().length < 10 || !canReview} className="rounded-xl bg-sky-600 px-4 py-2 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50">{saving ? 'Saving…' : 'Submit Review'}</button>
    </div>
  </form>;
}

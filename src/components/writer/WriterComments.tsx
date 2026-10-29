import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  MessageSquare, 
  Check, 
  EyeOff, 
  Trash2, 
  AlertTriangle, 
  Filter, 
  Search, 
  Clock, 
  User, 
  RefreshCw,
  ExternalLink,
  ShieldAlert,
  CheckCircle2
} from 'lucide-react';
import { PieceComment, Article } from '../../types.js';
import { api } from '../../utils/api.js';

interface WriterCommentsProps {
  articles: Article[];
  onPreviewPiece?: (article: Article) => void;
}

export function CommentPublicationConfirmation({ comment, busy, onConfirm, onCancel }: {
  comment: PieceComment;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const confirmationRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    confirmationRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    confirmationRef.current?.focus({ preventScroll: true });
  }, [comment.id]);
  return <section ref={confirmationRef} tabIndex={-1} aria-labelledby="publish-comment-title" className="rounded-2xl border border-emerald-800 bg-slate-950 p-5 space-y-3">
    <h3 id="publish-comment-title" className="font-semibold text-white">Publish this comment publicly?</h3>
    <p className="text-xs text-slate-300">This will show {comment.readerName}&apos;s name and the comment to all readers. Account email and private ownership details will not be displayed.</p>
    <blockquote className="whitespace-pre-wrap rounded-xl border border-slate-800 p-3 text-sm text-slate-200">{comment.content}</blockquote>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm public publication</button>
      <button type="button" disabled={busy} onClick={onCancel} className="rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-200 disabled:opacity-50">Cancel publication</button>
    </div>
  </section>;
}

export const WriterComments: React.FC<WriterCommentsProps> = ({
  articles,
  onPreviewPiece
}) => {
  const [comments, setComments] = useState<PieceComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArticleId, setSelectedArticleId] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'hidden' | 'reported'>('all');
  const [publishCommentId, setPublishCommentId] = useState<string | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const moderationBusyRef = useRef(false);

  const fetchComments = async () => {
    if (moderationBusyRef.current || loadingMore) return;
    try {
      setLoading(true);
      setError(null);
      const res = await api.getAdminComments();
      setComments(res.comments || []);
      setNextCursor(res.nextCursor || null);
      setHasMore(res.hasMore === true);
    } catch (err: any) {
      setError(err.message || 'Failed to load comments.');
    } finally {
      setLoading(false);
    }
  };

  const loadMoreComments = async () => {
    if (!nextCursor || loadingMore || moderationBusyRef.current) return;
    try {
      setLoadingMore(true);
      setError(null);
      const res = await api.getAdminComments(nextCursor);
      setComments(previous => {
        const merged = new Map<string, PieceComment>(
          previous.map(comment => [comment.id, comment] as const)
        );
        for (const comment of res.comments || []) merged.set(comment.id, comment);
        return [...merged.values()].sort(
          (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
        );
      });
      setNextCursor(res.nextCursor || null);
      setHasMore(res.hasMore === true);
    } catch (err: any) {
      setError(err.message || 'Failed to load more comments.');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, []);

  const handleUpdateStatus = async (commentId: string, status: 'approved' | 'hidden') => {
    if (moderationBusyRef.current || loading || loadingMore) return;
    moderationBusyRef.current = true;
    try {
      setActionLoadingId(commentId);
      const updated = await api.updateAdminCommentStatus(commentId, status);
      setComments(prev => prev.map(c => c.id === commentId ? updated : c));
      setPublishCommentId(null);
      setSuccessMessage(status === 'approved' ? 'Comment published publicly.' : 'Comment hidden from public readers.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to update comment status.');
    } finally {
      moderationBusyRef.current = false;
      setActionLoadingId(null);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (moderationBusyRef.current || loading || loadingMore) return;
    if (!window.confirm('Are you sure you want to permanently delete this comment?')) return;
    moderationBusyRef.current = true;
    try {
      setActionLoadingId(commentId);
      await api.deleteAdminComment(commentId);
      setComments(prev => prev.filter(c => c.id !== commentId));
      setSuccessMessage('Comment permanently deleted.');
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err: any) {
      setError(err.message || 'Failed to delete comment.');
    } finally {
      moderationBusyRef.current = false;
      setActionLoadingId(null);
    }
  };

  const articleById = useMemo(
    () => new Map(articles.map(article => [article.id, article])),
    [articles]
  );

  // Filtered comments
  const filteredComments = comments.filter(c => {
    const matchesSearch = 
      c.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.readerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.articleTitle && c.articleTitle.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesArticle = selectedArticleId === 'all' || c.articleId === selectedArticleId;

    const matchesStatus = 
      statusFilter === 'all' ||
      (statusFilter === 'reported' && c.isReported) ||
      (statusFilter === 'pending' && c.status === 'pending') ||
      (statusFilter === 'approved' && c.status === 'approved') ||
      (statusFilter === 'hidden' && c.status === 'hidden');

    return matchesSearch && matchesArticle && matchesStatus;
  });

  const totalCount = comments.length;
  const approvedCount = comments.filter(c => c.status === 'approved').length;
  const hiddenCount = comments.filter(c => c.status === 'hidden').length;
  const pendingCount = comments.filter(c => c.status === 'pending').length;
  const reportedCount = comments.filter(c => c.isReported).length;
  const publishComment = comments.find(comment => comment.id === publishCommentId && comment.status !== 'approved' && comment.status !== 'deleted');

  return (
    <div id="writer-comments-container" className="space-y-6">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 uppercase tracking-wider mb-1">
            <MessageSquare className="w-4 h-4" />
            <span>Reader Engagement</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-white">
            Monograph Comments &amp; Moderation
          </h2>
          <p className="text-xs text-slate-400 mt-1 font-sans">
            Every new reader comment waits here until you confirm public publication. Readers can submit more than one comment on a piece.
          </p>
        </div>

        <button
          onClick={fetchComments}
          disabled={loading || loadingMore || actionLoadingId !== null}
          className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800 text-xs font-mono flex items-center gap-2 cursor-pointer transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {publishComment && <CommentPublicationConfirmation comment={publishComment} busy={loading || loadingMore || actionLoadingId !== null} onConfirm={() => handleUpdateStatus(publishComment.id, 'approved')} onCancel={() => setPublishCommentId(null)} />}

      {/* Notifications */}
      {successMessage && (
        <div className="p-3.5 rounded-xl bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Stats Summary Cards */}
      <p className="text-xs text-slate-500">Counts below cover the loaded comments. Load older comments to review more history.</p>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800">
          <p className="text-xs font-mono text-slate-400">Total Comments</p>
          <p className="text-xl sm:text-2xl font-bold text-white mt-1 font-mono">{totalCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-sky-950/30 border border-sky-800/40">
          <p className="text-xs font-mono text-sky-400">Awaiting Approval</p>
          <p className="text-xl sm:text-2xl font-bold text-sky-300 mt-1 font-mono">{pendingCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-emerald-950/30 border border-emerald-800/40">
          <p className="text-xs font-mono text-emerald-400">Approved (Live)</p>
          <p className="text-xl sm:text-2xl font-bold text-emerald-300 mt-1 font-mono">{approvedCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-amber-950/30 border border-amber-800/40">
          <p className="text-xs font-mono text-amber-400">Hidden / Filtered</p>
          <p className="text-xl sm:text-2xl font-bold text-amber-300 mt-1 font-mono">{hiddenCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-rose-950/30 border border-rose-800/40">
          <p className="text-xs font-mono text-rose-400 flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Reported Flags</span>
          </p>
          <p className="text-xl sm:text-2xl font-bold text-rose-300 mt-1 font-mono">{reportedCount}</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 flex flex-col md:flex-row gap-3 items-center justify-between">
        
        {/* Search */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search comment content, reader..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Article filter */}
          <select
            value={selectedArticleId}
            onChange={(e) => setSelectedArticleId(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
          >
            <option value="all">All Monographs</option>
            {articles.map(art => (
              <option key={art.id} value={art.id}>
                {art.title.length > 35 ? art.title.substring(0, 35) + '...' : art.title}
              </option>
            ))}
          </select>

          {/* Status filter */}
          <div className="flex items-center gap-1 p-1 bg-slate-950 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'all' ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              All
            </button>
            <button type="button" onClick={() => setStatusFilter('pending')} className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${statusFilter === 'pending' ? 'bg-sky-950 text-sky-300 border border-sky-800/80 font-bold' : 'text-slate-400 hover:text-white'}`}>
              Pending
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('approved')}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'approved' ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/80 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Approved
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('hidden')}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'hidden' ? 'bg-amber-950 text-amber-300 border border-amber-800/80 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Hidden
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('reported')}
              className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                statusFilter === 'reported' ? 'bg-rose-950 text-rose-300 border border-rose-800/80 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Reported
            </button>
          </div>
        </div>

      </div>

      {/* Comments List */}
      <div className="space-y-4">
        {loading ? (
          <div className="p-12 text-center text-slate-500 font-mono text-xs flex flex-col items-center gap-3">
            <RefreshCw className="w-6 h-6 animate-spin text-cyan-400" />
            <span>Loading reader discussions...</span>
          </div>
        ) : filteredComments.length === 0 ? (
          <div className="p-12 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
            <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-300">No comments found</p>
            <p className="text-xs text-slate-500">
              {searchQuery || selectedArticleId !== 'all' || statusFilter !== 'all'
                ? 'Try adjusting your search query or filter selection.'
                : 'Reader discussions will appear here when readers engage with monographs.'}
            </p>
          </div>
        ) : (
          filteredComments.map((comment) => {
            const article = articleById.get(comment.articleId);
            const isProcessing = loading || loadingMore || actionLoadingId !== null;

            return (
              <div
                key={comment.id}
                id={`comment-card-${comment.id}`}
                className={`p-5 rounded-2xl border transition-all ${
                  comment.isReported 
                    ? 'bg-rose-950/20 border-rose-800/60' 
                    : comment.status === 'hidden'
                    ? 'bg-slate-900/40 border-slate-800 opacity-75'
                    : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  
                  {/* Left: Reader details & comment text */}
                  <div className="space-y-2.5 flex-1 min-w-0">
                    
                    {/* Top line metadata */}
                    <div className="flex flex-wrap items-center gap-2.5 text-xs">
                      <div className="flex items-center gap-1.5 font-bold text-white font-mono">
                        <User className="w-3.5 h-3.5 text-cyan-400" />
                        <span>{comment.readerName}</span>
                      </div>

                      {comment.readerEmail && (
                        <span className="text-slate-400 font-mono text-[11px]">
                          ({comment.readerEmail})
                        </span>
                      )}

                      <span className="text-slate-600">•</span>

                      <div className="flex items-center gap-1 text-slate-400 font-mono text-[11px]">
                        <Clock className="w-3 h-3" />
                        <span>{new Date(comment.createdAt).toLocaleString()}</span>
                      </div>

                      {/* Status Badges */}
                      {comment.status === 'approved' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950 text-emerald-300 border border-emerald-800/60 flex items-center gap-1">
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Approved
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950 text-amber-300 border border-amber-800/60 flex items-center gap-1">
                          <EyeOff className="w-2.5 h-2.5" />
                          {comment.status === 'pending' ? 'Awaiting approval' : comment.status === 'deleted' ? 'Deleted' : 'Hidden'}
                        </span>
                      )}

                      {comment.isReported && (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-950 text-rose-300 border border-rose-800/80 flex items-center gap-1 animate-pulse">
                          <ShieldAlert className="w-2.5 h-2.5" />
                          Reported: {comment.reportedReason || 'Reader Flag'}
                        </span>
                      )}
                    </div>

                    {/* Associated Monograph Title */}
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500 font-mono text-[11px]">On Monograph:</span>
                      {article ? (
                        <button
                          type="button"
                          onClick={() => onPreviewPiece && onPreviewPiece(article)}
                          className="font-serif font-bold text-sky-400 hover:text-sky-300 flex items-center gap-1 text-left cursor-pointer truncate max-w-md"
                        >
                          <span>{article.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0" />
                        </button>
                      ) : (
                        <span className="text-slate-400 font-serif italic">{comment.articleTitle || comment.articleId}</span>
                      )}
                    </div>

                    {/* Comment Content */}
                    <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-xs text-slate-200 leading-relaxed whitespace-pre-wrap font-sans">
                      {comment.content}
                    </div>

                  </div>

                  {/* Right: Moderation Actions */}
                  <div className="flex sm:flex-col items-center gap-2 shrink-0">
                    {comment.status !== 'approved' && comment.status !== 'deleted' ? (
                      <button
                        type="button"
                        onClick={() => setPublishCommentId(comment.id)}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800/80 text-emerald-300 text-xs font-mono font-medium flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                        title="Approve and make visible to readers"
                      >
                        <Check className="w-3.5 h-3.5" />
                        <span>Review &amp; publish</span>
                      </button>
                    ) : comment.status === 'approved' ? (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(comment.id, 'hidden')}
                        disabled={isProcessing}
                        className="px-3 py-1.5 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-800/80 text-amber-300 text-xs font-mono font-medium flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                        title="Hide comment from public publication"
                      >
                        <EyeOff className="w-3.5 h-3.5" />
                        <span>Hide</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => handleDelete(comment.id)}
                      disabled={isProcessing}
                      className="px-3 py-1.5 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-50"
                      title="Permanently delete comment"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  </div>

                </div>
              </div>
            );
          })
        )}
      </div>

      {hasMore && nextCursor ? (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMoreComments}
            disabled={loadingMore || actionLoadingId !== null}
            className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-900/70 text-xs font-mono flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingMore ? 'animate-spin' : ''}`} />
            <span>{loadingMore ? 'Loading more…' : 'Load older comments'}</span>
          </button>
        </div>
      ) : null}

    </div>
  );
};

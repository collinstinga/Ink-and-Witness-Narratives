import React, { useState, useEffect } from 'react';
import { 
  Compass, 
  Plus, 
  Edit3, 
  Trash2, 
  Eye, 
  EyeOff, 
  ArrowUp, 
  ArrowDown, 
  Save, 
  X, 
  Check, 
  BookOpen, 
  Layers, 
  TrendingUp, 
  Sparkles, 
  DollarSign, 
  Search,
  Filter,
  CheckSquare,
  Square,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import { Topic, Article, TopicAnalyticsItem } from '../../types.js';
import { api } from '../../utils/api.js';

interface TopicManagementTabProps {
  articles: Article[];
  onRefreshArticles: () => void;
}

export const TopicManagementTab: React.FC<TopicManagementTabProps> = ({
  articles,
  onRefreshArticles
}) => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [analytics, setAnalytics] = useState<TopicAnalyticsItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Active modal/editor state
  const [editingTopic, setEditingTopic] = useState<Partial<Topic> | null>(null);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [curatingTopic, setCuratingTopic] = useState<Topic | null>(null);
  const [curatingPieceIds, setCuratingPieceIds] = useState<string[]>([]);
  const [pieceSearchQuery, setPieceSearchQuery] = useState<string>('');

  // Analytics filter
  const [analyticsPeriod, setAnalyticsPeriod] = useState<'7d' | '30d' | 'all'>('30d');

  // Load topics & analytics
  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);
      const [topicsData, analyticsData] = await Promise.all([
        api.getTopics(true),
        api.getTopicAnalytics({ period: analyticsPeriod }).catch(() => [])
      ]);
      setTopics(topicsData || []);
      setAnalytics(analyticsData || []);
    } catch (err: any) {
      console.error('Failed to load topics data:', err);
      setError(err.message || 'Failed to load topic catalogue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [analyticsPeriod]);

  const showToast = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Create or Update Topic
  const handleSaveTopic = async () => {
    if (!editingTopic || !editingTopic.name?.trim()) {
      setError('Topic name is required.');
      return;
    }

    try {
      setSaving(true);
      setError(null);

      if (isCreating) {
        const created = await api.createTopic({
          name: editingTopic.name.trim(),
          description: editingTopic.description || '',
          slug: editingTopic.slug || '',
          homepageVisible: editingTopic.homepageVisible !== false,
          pieceIds: editingTopic.pieceIds || []
        });
        setTopics(prev => [...prev, created]);
        showToast(`Topic "${created.name}" created successfully.`);
      } else if (editingTopic.id) {
        const updated = await api.updateTopic(editingTopic.id, {
          name: editingTopic.name.trim(),
          description: editingTopic.description || '',
          slug: editingTopic.slug,
          homepageVisible: editingTopic.homepageVisible !== false,
          pieceIds: editingTopic.pieceIds || []
        });
        setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
        showToast(`Topic "${updated.name}" updated successfully.`);
      }

      setEditingTopic(null);
      setIsCreating(false);
      onRefreshArticles();
    } catch (err: any) {
      console.error('Save topic error:', err);
      setError(err.message || 'Failed to save topic.');
    } finally {
      setSaving(false);
    }
  };

  // Delete Topic
  const handleDeleteTopic = async (topic: Topic) => {
    const confirmDelete = window.confirm(
      `Are you sure you want to remove the topic "${topic.name}" from the catalogue?\n\nNote: All articles under this topic will remain safe and published.`
    );
    if (!confirmDelete) return;

    try {
      setSaving(true);
      await api.deleteTopic(topic.id);
      setTopics(prev => prev.filter(t => t.id !== topic.id));
      showToast(`Topic "${topic.name}" deleted.`);
      onRefreshArticles();
    } catch (err: any) {
      console.error('Delete topic error:', err);
      setError(err.message || 'Failed to delete topic.');
    } finally {
      setSaving(false);
    }
  };

  // Toggle Visibility
  const handleToggleVisibility = async (topic: Topic) => {
    try {
      const updated = await api.updateTopic(topic.id, {
        name: topic.name,
        description: topic.description,
        slug: topic.slug,
        homepageVisible: !topic.homepageVisible,
        pieceIds: topic.pieceIds
      });
      setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
      showToast(`Topic "${topic.name}" is now ${updated.homepageVisible ? 'visible' : 'hidden'} on the homepage.`);
    } catch (err: any) {
      setError(err.message || 'Failed to update visibility');
    }
  };

  // Move Up / Down
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= topics.length) return;

    const newTopics = [...topics];
    const [moved] = newTopics.splice(index, 1);
    newTopics.splice(targetIndex, 0, moved);

    setTopics(newTopics);

    try {
      const ids = newTopics.map(t => t.id);
      await api.reorderTopics(ids);
      showToast('Catalogue order updated.');
    } catch (err: any) {
      console.error('Reorder error:', err);
      setError('Failed to persist new topic order.');
      loadData();
    }
  };

  // Open Piece Curation modal
  const handleOpenCurate = (topic: Topic) => {
    setCuratingTopic(topic);
    // Find all piece IDs associated with this topic
    const directIds = topic.pieceIds || [];
    const derivedIds = articles.filter(a => 
      a.topics && (a.topics.includes(topic.slug) || a.topics.includes(topic.name) || a.topics.includes(topic.id))
    ).map(a => a.id);
    const combined = Array.from(new Set([...directIds, ...derivedIds]));
    setCuratingPieceIds(combined);
    setPieceSearchQuery('');
  };

  // Save curated pieces
  const handleSaveCuratedPieces = async () => {
    if (!curatingTopic) return;
    try {
      setSaving(true);
      const updated = await api.assignPiecesToTopic(curatingTopic.id, curatingPieceIds);
      setTopics(prev => prev.map(t => t.id === updated.id ? updated : t));
      setCuratingTopic(null);
      showToast(`Assigned ${curatingPieceIds.length} pieces to topic "${updated.name}".`);
      onRefreshArticles();
    } catch (err: any) {
      setError(err.message || 'Failed to assign pieces');
    } finally {
      setSaving(false);
    }
  };

  const togglePieceAssignment = (pieceId: string) => {
    setCuratingPieceIds(prev => 
      prev.includes(pieceId) ? prev.filter(id => id !== pieceId) : [...prev, pieceId]
    );
  };

  // Calculate highest metric for visual scale in analytics
  const maxViews = Math.max(...analytics.map(a => a.viewsCount), 1);
  const maxRevenue = Math.max(...analytics.map(a => a.revenueKes), 1);

  return (
    <div id="writer-topics-management" className="space-y-8 animate-fade-in">
      
      {/* Top Header & Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-sky-400">
            <Compass className="w-4 h-4 text-sky-400" />
            <span>Editorial Catalogue</span>
          </div>
          <h2 className="font-display text-2xl font-bold text-white">
            Topic Catalogue &amp; Reader Discovery
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 max-w-2xl font-sans font-light">
            Manage discovery topics for the homepage &ldquo;FIND WHAT SPEAKS TO YOU&rdquo; section. Curate which pieces belong under each topic, adjust ordering, and view reader engagement metrics.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => {
              setIsCreating(true);
              setEditingTopic({
                name: '',
                description: '',
                slug: '',
                homepageVisible: true,
                pieceIds: []
              });
            }}
            className="px-4 py-2.5 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>New Topic</span>
          </button>

          <button
            onClick={loadData}
            title="Refresh catalogue"
            className="p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 transition-all cursor-pointer border border-slate-700"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Notifications */}
      {error && (
        <div className="p-4 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-200 text-xs font-mono flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-4 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-200 text-xs font-mono flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0 text-emerald-400" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ============================================================ */}
      {/* SECTION 1: TOPIC PERFORMANCE & REVENUE GRAPH */}
      {/* ============================================================ */}
      <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-emerald-400">
              <TrendingUp className="w-4 h-4" />
              <span>Topic-Level Sales &amp; Discovery</span>
            </div>
            <h3 className="font-display text-lg font-bold text-white">
              Reader Engagement by Topic
            </h3>
          </div>

          <div className="flex items-center bg-slate-950 border border-slate-800 rounded-full p-1 text-xs font-mono">
            {(['7d', '30d', 'all'] as const).map(period => (
              <button
                key={period}
                onClick={() => setAnalyticsPeriod(period)}
                className={`px-3 py-1 rounded-full transition-all cursor-pointer ${
                  analyticsPeriod === period
                    ? 'bg-emerald-500/20 text-emerald-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {period === '7d' ? '7 Days' : period === '30d' ? '30 Days' : 'All Time'}
              </button>
            ))}
          </div>
        </div>

        {analytics.length === 0 ? (
          <div className="py-8 text-center text-xs font-mono text-slate-500">
            No interaction data recorded for the selected timeframe yet.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {analytics.slice(0, 6).map((item) => (
                <div 
                  key={item.topicId || item.topicSlug} 
                  className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-bold text-white truncate max-w-[160px]">
                      {item.topicName}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400 font-bold">
                      KES {item.revenueKes.toLocaleString()}
                    </span>
                  </div>

                  {/* Relative bar for revenue */}
                  <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max((item.revenueKes / maxRevenue) * 100, 4)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono pt-1 text-slate-400 border-t border-slate-900">
                    <div>
                      <span className="block text-slate-500">Stories</span>
                      <span className="font-semibold text-slate-200">{item.pieceCount}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Views</span>
                      <span className="font-semibold text-slate-200">{item.viewsCount}</span>
                    </div>
                    <div>
                      <span className="block text-slate-500">Unlocks</span>
                      <span className="font-semibold text-emerald-300">{item.purchasesCount}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* SECTION 2: TOPIC CATALOGUE LIST & REORDERING */}
      {/* ============================================================ */}
      <div className="bg-slate-900/40 p-6 rounded-2xl border border-slate-800 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
          <div>
            <h3 className="font-display text-lg font-bold text-white">
              Catalogue Hierarchy ({topics.length} Topics)
            </h3>
            <p className="text-xs text-slate-400 font-sans">
              Reorder using the arrow buttons to position topics in the homepage horizontal scroll.
            </p>
          </div>
        </div>

        {topics.length === 0 && !loading ? (
          <div className="py-12 text-center space-y-3">
            <Compass className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-serif italic text-base text-slate-300">No topics currently in catalogue.</p>
            <button
              onClick={() => {
                setIsCreating(true);
                setEditingTopic({ name: '', description: '', slug: '', homepageVisible: true, pieceIds: [] });
              }}
              className="px-4 py-2 rounded-full bg-sky-500 text-slate-950 font-mono text-xs font-bold"
            >
              Create First Topic
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {topics.map((topic, index) => {
              const assignedPiecesCount = (topic.pieceIds || []).length || articles.filter(a => 
                a.topics && (a.topics.includes(topic.slug) || a.topics.includes(topic.name) || a.topics.includes(topic.id))
              ).length;

              return (
                <div
                  key={topic.id}
                  className={`p-4 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                    topic.homepageVisible !== false
                      ? 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      : 'bg-slate-950/30 border-slate-900 opacity-60'
                  }`}
                >
                  {/* Left: Reorder controls + Topic info */}
                  <div className="flex items-start md:items-center gap-3 min-w-0">
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        title="Move topic left/up"
                        className={`p-1.5 rounded bg-slate-900 border border-slate-800 transition-all ${
                          index === 0 ? 'opacity-30 cursor-not-allowed text-slate-600' : 'text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === topics.length - 1}
                        title="Move topic right/down"
                        className={`p-1.5 rounded bg-slate-900 border border-slate-800 transition-all ${
                          index === topics.length - 1 ? 'opacity-30 cursor-not-allowed text-slate-600' : 'text-slate-300 hover:text-white hover:bg-slate-800'
                        }`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-display text-base font-bold text-white">
                          {topic.name}
                        </span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-900 border border-slate-800 text-sky-400">
                          /{topic.slug}
                        </span>
                        {topic.homepageVisible === false && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-950/60 border border-amber-800/80 text-amber-300">
                            Hidden from Homepage
                          </span>
                        )}
                      </div>
                      {topic.description && (
                        <p className="text-xs text-slate-400 line-clamp-1 font-serif italic">
                          {topic.description}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                    <button
                      onClick={() => handleOpenCurate(topic)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 text-xs font-mono text-sky-400 flex items-center gap-1.5 transition-all cursor-pointer"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>Curate Pieces ({assignedPiecesCount})</span>
                    </button>

                    <button
                      onClick={() => handleToggleVisibility(topic)}
                      title={topic.homepageVisible !== false ? 'Hide on Homepage' : 'Show on Homepage'}
                      className={`p-2 rounded-lg border transition-all cursor-pointer ${
                        topic.homepageVisible !== false
                          ? 'bg-slate-900 border-slate-800 text-slate-300 hover:text-white'
                          : 'bg-slate-900 border-slate-800 text-amber-400'
                      }`}
                    >
                      {topic.homepageVisible !== false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => {
                        setIsCreating(false);
                        setEditingTopic({ ...topic });
                      }}
                      title="Edit Topic Details"
                      className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteTopic(topic)}
                      title="Delete Topic"
                      className="p-2 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 border border-rose-900/60 text-rose-400 hover:text-rose-200 transition-all cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* MODAL 1: CREATE / EDIT TOPIC DETAILS */}
      {/* ============================================================ */}
      {editingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-lg bg-[#0b101b] border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-2">
                <Compass className="w-5 h-5 text-sky-400" />
                <h3 className="font-display text-xl font-bold text-white">
                  {isCreating ? 'Create Discovery Topic' : 'Edit Topic Details'}
                </h3>
              </div>
              <button
                onClick={() => setEditingTopic(null)}
                className="p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  Topic Name *
                </label>
                <input
                  type="text"
                  value={editingTopic.name || ''}
                  onChange={(e) => {
                    const name = e.target.value;
                    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                    setEditingTopic(prev => ({
                      ...prev,
                      name,
                      slug: isCreating ? slug : (prev?.slug || slug)
                    }));
                  }}
                  placeholder="e.g. Erotica, Human Nature, Power & Influence"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-white text-sm focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  URL Slug
                </label>
                <input
                  type="text"
                  value={editingTopic.slug || ''}
                  onChange={(e) => setEditingTopic(prev => ({ ...prev, slug: e.target.value }))}
                  placeholder="e.g. erotica, human-nature"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sky-300 font-mono text-xs focus:outline-none focus:border-sky-500"
                />
              </div>

              <div>
                <label className="block text-xs font-mono uppercase tracking-wider text-slate-300 mb-1.5">
                  Literary Description / Reader Subtitle
                </label>
                <textarea
                  rows={3}
                  value={editingTopic.description || ''}
                  onChange={(e) => setEditingTopic(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="A short, evocative phrase describing what stories in this topic explore..."
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-sm focus:outline-none focus:border-sky-500 leading-relaxed font-sans"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="topic-visibility-checkbox"
                  checked={editingTopic.homepageVisible !== false}
                  onChange={(e) => setEditingTopic(prev => ({ ...prev, homepageVisible: e.target.checked }))}
                  className="w-4 h-4 rounded text-sky-500 bg-slate-900 border-slate-700 focus:ring-sky-500"
                />
                <label htmlFor="topic-visibility-checkbox" className="text-xs font-mono text-slate-300 cursor-pointer">
                  Display on Homepage &ldquo;FIND WHAT SPEAKS TO YOU&rdquo; carousel
                </label>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button
                onClick={() => setEditingTopic(null)}
                className="px-4 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTopic}
                disabled={saving}
                className="px-6 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? 'Saving...' : 'Save Topic'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: CURATE PIECES ASSIGNED TO TOPIC */}
      {/* ============================================================ */}
      {curatingTopic && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-2xl bg-[#0b101b] border border-slate-800 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4 shrink-0">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-sky-400 uppercase tracking-wider">
                  <BookOpen className="w-4 h-4" />
                  <span>Topic Curation</span>
                </div>
                <h3 className="font-display text-xl font-bold text-white">
                  Assign Stories to &ldquo;{curatingTopic.name}&rdquo;
                </h3>
              </div>
              <button
                onClick={() => setCuratingTopic(null)}
                className="p-2 rounded-full bg-slate-900 border border-slate-800 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Search Pieces Filter */}
            <div className="relative shrink-0">
              <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-500" />
              <input
                type="text"
                value={pieceSearchQuery}
                onChange={(e) => setPieceSearchQuery(e.target.value)}
                placeholder="Search pieces by title, category, or snippet..."
                className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-white text-xs font-mono focus:outline-none focus:border-sky-500"
              />
            </div>

            {/* Pieces Checklist */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {articles
                .filter(a => {
                  if (!pieceSearchQuery.trim()) return true;
                  const q = pieceSearchQuery.toLowerCase();
                  return a.title.toLowerCase().includes(q) || 
                    (a.subtitle && a.subtitle.toLowerCase().includes(q)) || 
                    (a.category && a.category.toLowerCase().includes(q));
                })
                .map((piece) => {
                  const isChecked = curatingPieceIds.includes(piece.id);
                  return (
                    <div
                      key={piece.id}
                      onClick={() => togglePieceAssignment(piece.id)}
                      className={`p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        isChecked
                          ? 'bg-sky-950/40 border-sky-600/70 shadow-sm'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 text-sky-400">
                          {isChecked ? <CheckSquare className="w-5 h-5" /> : <Square className="w-5 h-5 text-slate-600" />}
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-display text-sm font-bold text-white truncate">
                            {piece.title}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] font-mono text-slate-400">
                            <span>{piece.category || 'Monograph'}</span>
                            <span>&bull;</span>
                            <span>{piece.isPaid ? `KES ${(piece.priceKes || 1050).toLocaleString()}` : 'Free'}</span>
                            {piece.status === 'draft' && (
                              <span className="text-amber-400 font-bold">&bull; Draft</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <span className={`text-[11px] font-mono shrink-0 px-2 py-0.5 rounded ${
                        isChecked ? 'bg-sky-500/20 text-sky-300 font-semibold' : 'text-slate-500'
                      }`}>
                        {isChecked ? 'Included' : 'Exclude'}
                      </span>
                    </div>
                  );
                })}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-800 shrink-0">
              <span className="text-xs font-mono text-slate-400">
                {curatingPieceIds.length} stories selected
              </span>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCuratingTopic(null)}
                  className="px-4 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs font-mono transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCuratedPieces}
                  disabled={saving}
                  className="px-6 py-2 rounded-full bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs font-mono flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-sky-500/20"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? 'Saving...' : 'Save Assignments'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

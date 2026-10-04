import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BookMarked, Check, Eye, EyeOff, ImagePlus, Layers3, Loader2, PackageOpen, RefreshCw, Save, Star, Trash2, X } from 'lucide-react';
import { Article, ContentBundle, ContentCollection, PieceReview } from '../../types.js';
import { api } from '../../utils/api.js';
import { COLLECTION_COVER_UPLOAD_ACCEPT, getCollectionCoverValidationError } from '../../utils/imageUploadPolicy.js';

type EditorKind = 'collection' | 'bundle';

type EditorState = {
  id?: string;
  name: string;
  description: string;
  pieceIds: string[];
  isPublished: boolean;
  order: number;
  priceKes: number;
  coverImage: string;
};

const emptyEditor = (): EditorState => ({
  name: '',
  description: '',
  pieceIds: [],
  isPublished: false,
  order: 0,
  priceKes: 1,
  coverImage: ''
});

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('The selected JPEG could not be read.'));
    };
    reader.onerror = () => reject(new Error('The selected JPEG could not be read.'));
    reader.readAsDataURL(file);
  });
}

export function WriterReaderExperience({ articles }: { articles: Article[] }) {
  const [collections, setCollections] = useState<ContentCollection[]>([]);
  const [bundles, setBundles] = useState<ContentBundle[]>([]);
  const [reviews, setReviews] = useState<PieceReview[]>([]);
  const [editorKind, setEditorKind] = useState<EditorKind>('collection');
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const collectionCoverInputRef = useRef<HTMLInputElement>(null);
  const coverUploadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.getAdminReaderExperience();
      setCollections(result.collections);
      setBundles(result.bundles);
      setReviews(result.reviews);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Reader-experience settings could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selectCollection = (collection?: ContentCollection) => {
    coverUploadSequenceRef.current += 1;
    setUploadingCover(false);
    setEditorKind('collection');
    setEditor(collection ? {
      id: collection.id,
      name: collection.name,
      description: collection.description,
      pieceIds: collection.pieceIds,
      isPublished: collection.isPublished,
      order: collection.order,
      priceKes: 1,
      coverImage: collection.coverImage || ''
    } : emptyEditor());
  };

  const selectBundle = (bundle?: ContentBundle) => {
    coverUploadSequenceRef.current += 1;
    setUploadingCover(false);
    setEditorKind('bundle');
    setEditor(bundle ? {
      id: bundle.id,
      name: bundle.name,
      description: bundle.description,
      pieceIds: bundle.pieceIds,
      isPublished: bundle.isPublished,
      order: 0,
      priceKes: bundle.priceKes,
      coverImage: bundle.coverImage || ''
    } : { ...emptyEditor(), priceKes: 500 });
  };

  const togglePiece = (pieceId: string) => {
    setEditor(current => ({
      ...current,
      pieceIds: current.pieceIds.includes(pieceId)
        ? current.pieceIds.filter(id => id !== pieceId)
        : [...current.pieceIds, pieceId]
    }));
  };

  const uploadCollectionCover = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const validationError = getCollectionCoverValidationError(file);
    if (validationError) {
      setNotice('');
      setError(validationError);
      return;
    }

    setUploadingCover(true);
    const uploadSequence = ++coverUploadSequenceRef.current;
    setNotice('');
    setError('');
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const result = await api.uploadImage(
        dataUrl,
        'collection_cover',
        undefined,
        editor.id ? `collection_${editor.id}` : 'collection_cover'
      );
      if (uploadSequence !== coverUploadSequenceRef.current) return;
      setEditor(current => ({ ...current, coverImage: result.url }));
      setNotice('JPEG uploaded. Save the collection to attach this cover photo.');
    } catch (requestError) {
      if (uploadSequence !== coverUploadSequenceRef.current) return;
      setError(requestError instanceof Error ? requestError.message : 'The collection cover could not be uploaded.');
    } finally {
      if (uploadSequence === coverUploadSequenceRef.current) setUploadingCover(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      if (editorKind === 'collection') {
        await api.saveContentCollection({
          id: editor.id,
          name: editor.name,
          description: editor.description,
          pieceIds: editor.pieceIds,
          isPublished: editor.isPublished,
          order: editor.order,
          coverImage: editor.coverImage || undefined
        });
        setNotice('Collection saved. Piece categories were not changed.');
      } else {
        await api.saveContentBundle({
          id: editor.id,
          name: editor.name,
          description: editor.description,
          pieceIds: editor.pieceIds,
          isPublished: editor.isPublished,
          priceKes: editor.priceKes,
          coverImage: editor.coverImage || undefined
        });
        setNotice('Bundle saved. Its current piece list will be snapshotted when each payment begins.');
      }
      setEditor(editorKind === 'bundle' ? { ...emptyEditor(), priceKes: 500 } : emptyEditor());
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Changes could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (kind: EditorKind, id: string) => {
    if (!window.confirm(`Delete this ${kind}? Existing piece content and reader access will remain unchanged.`)) return;
    try {
      if (kind === 'collection') await api.deleteContentCollection(id);
      else await api.deleteContentBundle(id);
      setEditor(kind === 'bundle' ? { ...emptyEditor(), priceKes: 500 } : emptyEditor());
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : `${kind} could not be deleted.`);
    }
  };

  const moderate = async (review: PieceReview, status: PieceReview['status'], featured = review.featured) => {
    try {
      await api.moderatePieceReview(review.id, { status, featured });
      await load();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Review could not be updated.');
    }
  };

  const publishedArticles = articles.filter(article => article.status === 'published');

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">Reader experience</p>
          <h1 className="mt-1 font-serif text-2xl font-bold text-white">Collections, Bundles &amp; Testimonials</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">Curate discovery independently of categories, package paid pieces, and decide which verified reader words become public social proof.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
      </header>

      {error && <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300">{notice}</div>}

      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => selectCollection()} className={`rounded-full border px-3 py-1.5 text-xs ${editorKind === 'collection' ? 'border-sky-500 bg-sky-950 text-sky-200' : 'border-slate-700 text-slate-400'}`}><Layers3 className="mr-1 inline h-3.5 w-3.5" />New Collection</button>
            <button type="button" onClick={() => selectBundle()} className={`rounded-full border px-3 py-1.5 text-xs ${editorKind === 'bundle' ? 'border-emerald-500 bg-emerald-950 text-emerald-200' : 'border-slate-700 text-slate-400'}`}><PackageOpen className="mr-1 inline h-3.5 w-3.5" />New Bundle</button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">Name *<input value={editor.name} maxLength={120} onChange={event => setEditor({ ...editor, name: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500" /></label>
            <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">Description<textarea value={editor.description} maxLength={1500} rows={3} onChange={event => setEditor({ ...editor, description: event.target.value })} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500" /></label>
            {editorKind === 'collection' ? (
              <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3 sm:col-span-2">
                <div>
                  <p className="text-xs font-semibold text-slate-300">Collection cover photo</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Upload a JPEG up to 700 KB. The photo is attached permanently when you save the collection.</p>
                </div>
                <input
                  ref={collectionCoverInputRef}
                  type="file"
                  accept={COLLECTION_COVER_UPLOAD_ACCEPT}
                  onChange={event => void uploadCollectionCover(event)}
                  className="sr-only"
                  aria-label="Choose collection cover JPEG"
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  {editor.coverImage ? (
                    <img
                      src={editor.coverImage}
                      alt="Collection cover preview"
                      className="h-32 w-full rounded-xl border border-slate-700 object-cover sm:h-24 sm:w-36"
                    />
                  ) : (
                    <div className="flex h-24 w-full items-center justify-center rounded-xl border border-dashed border-slate-700 bg-slate-900 text-slate-500 sm:w-36">
                      <ImagePlus className="h-6 w-6" aria-hidden="true" />
                      <span className="sr-only">No collection cover uploaded</span>
                    </div>
                  )}
                  <div className="flex flex-1 flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => collectionCoverInputRef.current?.click()}
                      disabled={uploadingCover}
                      className="inline-flex items-center gap-2 rounded-lg border border-sky-800 bg-sky-950/40 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-900/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {uploadingCover ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                      {uploadingCover ? 'Uploading…' : editor.coverImage ? 'Replace JPEG' : 'Upload JPEG'}
                    </button>
                    {editor.coverImage && (
                      <button
                        type="button"
                        onClick={() => setEditor(current => ({ ...current, coverImage: '' }))}
                        disabled={uploadingCover}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:border-rose-800 hover:bg-rose-950/40 hover:text-rose-200 disabled:opacity-50"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />Remove
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <label className="space-y-1 text-xs text-slate-400 sm:col-span-2">Optional cover URL<input type="url" value={editor.coverImage} onChange={event => setEditor({ ...editor, coverImage: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-sky-500" /></label>
            )}
            {editorKind === 'collection' ? (
              <label className="space-y-1 text-xs text-slate-400">Display order<input type="number" min={0} value={editor.order} onChange={event => setEditor({ ...editor, order: Number(event.target.value) })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white" /></label>
            ) : (
              <label className="space-y-1 text-xs text-slate-400">Bundle price (KES) *<input type="number" min={1} value={editor.priceKes} onChange={event => setEditor({ ...editor, priceKes: Number(event.target.value) })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold text-white" /></label>
            )}
            <label className="flex items-center gap-2 self-end rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300"><input type="checkbox" checked={editor.isPublished} onChange={event => setEditor({ ...editor, isPublished: event.target.checked })} className="h-4 w-4 accent-sky-500" />Visible to readers</label>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-300">Included pieces ({editor.pieceIds.length})</p>
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950/60 p-2">
              {publishedArticles.map(article => (
                <label key={article.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs ${editor.pieceIds.includes(article.id) ? 'border-sky-700 bg-sky-950/40 text-sky-100' : 'border-transparent text-slate-400 hover:bg-slate-900'}`}>
                  <input type="checkbox" checked={editor.pieceIds.includes(article.id)} onChange={() => togglePiece(article.id)} className="mt-0.5 h-4 w-4 accent-sky-500" />
                  <span><span className="block font-semibold">{article.title}</span><span className="text-[10px] text-slate-500">{article.category} • {article.isPaid === false ? 'Free' : `KES ${article.priceKes}`}</span></span>
                </label>
              ))}
            </div>
          </div>
          <button type="button" onClick={() => void save()} disabled={saving || uploadingCover || !editor.name.trim() || editor.pieceIds.length < (editorKind === 'bundle' ? 2 : 1) || (editorKind === 'bundle' && (!Number.isFinite(editor.priceKes) || editor.priceKes < 1))} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-xs font-bold text-white hover:bg-sky-500 disabled:opacity-50"><Save className="h-4 w-4" />{saving ? 'Saving…' : uploadingCover ? 'Uploading cover…' : `Save ${editorKind}`}</button>
        </section>

        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
            <div className="mb-4 flex items-center gap-2"><Layers3 className="h-4 w-4 text-sky-400" /><h2 className="font-serif text-lg font-bold text-white">Collections</h2></div>
            <div className="space-y-2">
              {collections.length === 0 && <p className="text-xs text-slate-500">No custom collections yet.</p>}
              {collections.map(collection => <div key={collection.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><button type="button" onClick={() => selectCollection(collection)} className="min-w-0 text-left"><span className="block truncate text-sm font-semibold text-white">{collection.name}</span><span className="text-[10px] text-slate-500">{collection.pieceIds.length} pieces • {collection.isPublished ? 'Public' : 'Hidden'}</span></button><button type="button" aria-label={`Delete collection ${collection.name}`} onClick={() => void remove('collection', collection.id)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-950 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>)}
            </div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
            <div className="mb-4 flex items-center gap-2"><PackageOpen className="h-4 w-4 text-emerald-400" /><h2 className="font-serif text-lg font-bold text-white">Bundles</h2></div>
            <div className="space-y-2">
              {bundles.length === 0 && <p className="text-xs text-slate-500">No reader bundles yet.</p>}
              {bundles.map(bundle => <div key={bundle.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"><button type="button" onClick={() => selectBundle(bundle)} className="min-w-0 text-left"><span className="block truncate text-sm font-semibold text-white">{bundle.name}</span><span className="text-[10px] text-slate-500">{bundle.pieceIds.length} pieces • KES {bundle.priceKes.toLocaleString()} • {bundle.isPublished ? 'Public' : 'Hidden'}</span></button><button type="button" aria-label={`Delete bundle ${bundle.name}`} onClick={() => void remove('bundle', bundle.id)} className="rounded-lg p-2 text-slate-500 hover:bg-rose-950 hover:text-rose-300"><Trash2 className="h-4 w-4" /></button></div>)}
            </div>
          </section>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-800 bg-[#0b1120] p-5">
        <div className="mb-4 flex items-center gap-2"><BookMarked className="h-4 w-4 text-amber-400" /><h2 className="font-serif text-lg font-bold text-white">Verified Reviews &amp; Public Testimonials</h2></div>
        <div className="space-y-3">
          {reviews.length === 0 && <p className="text-xs text-slate-500">No verified reader reviews yet.</p>}
          {reviews.map(review => {
            const article = articles.find(item => item.id === review.articleId);
            return <article key={review.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs text-amber-400">{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</p><p className="mt-2 font-serif text-sm italic text-slate-200">“{review.review}”</p><p className="mt-2 text-[10px] font-mono uppercase tracking-wider text-emerald-400">Verified reader • {article?.title || review.articleId}</p></div><div className="flex shrink-0 flex-wrap gap-2"><button type="button" onClick={() => void moderate(review, 'approved', false)} className="inline-flex items-center gap-1 rounded-lg border border-emerald-800 px-2.5 py-1.5 text-[10px] text-emerald-300"><Check className="h-3 w-3" />Publish</button><button type="button" onClick={() => void moderate(review, 'approved', true)} className="inline-flex items-center gap-1 rounded-lg border border-amber-800 px-2.5 py-1.5 text-[10px] text-amber-300"><Star className="h-3 w-3" />Feature</button><button type="button" onClick={() => void moderate(review, 'hidden', false)} className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-2.5 py-1.5 text-[10px] text-slate-400">{review.status === 'hidden' ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}Hide</button></div></div></article>;
          })}
        </div>
      </section>
    </div>
  );
}

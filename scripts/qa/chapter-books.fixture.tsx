import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Article, ArticleSaveResult } from '../../src/types.js';
import { HomepageBundles, type HomepageBundle } from '../../src/components/HomepageBundles.js';
import { BookChapterNavigation } from '../../src/components/BookChapterNavigation.js';
import { WriterEditor } from '../../src/components/writer/WriterEditor.js';
import { WriterReaderExperience } from '../../src/components/writer/WriterReaderExperience.js';
import { api } from '../../src/utils/api.js';

// Isolated synthetic component fixture. No real app server, identity or payment.
const revision = '2026-10-28T12:00:00.000Z';
const piece = (id: string, title: string, priceKes: number): Article => ({
  id, title, subtitle: '', slug: id, excerpt: `Public preview for ${title}`,
  content: 'PRIVATE PAID TEXT MUST NEVER APPEAR', category: 'Narratives', publicationType: 'chapter',
  status: 'published', isPaid: true, priceKes, readTimeMinutes: 3,
  publishedAt: revision, createdAt: revision, updatedAt: revision, downloadsCount: 0,
  previewParagraphs: ['A safe public preview.'], tags: [], coverImage: '/synthetic-cover.svg',
});
const chapters = [piece('synthetic-one', 'The Story — Chapter One', 100), piece('synthetic-two', 'The Story — Chapter Two', 200)];
const book: HomepageBundle = {
  id: 'synthetic-book', kind: 'book', name: 'Synthetic Story', slug: 'synthetic-story',
  description: 'A synthetic two-chapter edition.', pieceIds: chapters.map(chapter => chapter.id),
  pieces: chapters, checkoutArticle: { ...chapters[0], id: 'bundle:synthetic-book', priceKes: 600, bookCheckoutUpdatedAt: revision },
  priceKes: 600, isPublished: true, showChaptersSeparately: false, existingOwnerPricing: 'remaining_chapters',
  createdAt: revision, updatedAt: revision, coverImage: '/synthetic-cover.svg',
};

function Lab() {
  const [tab, setTab] = useState<'reader' | 'manager' | 'editor'>('reader');
  const [selectedChapter, setSelectedChapter] = useState<Article | null>(null);
  const [checkout, setCheckout] = useState('No checkout requested');
  return <main className="mx-auto max-w-6xl p-4 text-slate-100">
    <h1 className="text-xl">Synthetic chapter books QA</h1>
    <nav aria-label="QA component views" className="my-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => setTab('reader')}>Reader lab</button>
      <button type="button" onClick={() => setTab('manager')}>Manager lab</button>
      <button type="button" onClick={() => setTab('editor')}>Editor lab</button>
    </nav>
    {tab === 'reader' && <section data-testid="reader-lab">
      <HomepageBundles bundles={[book]} readerIdentity="synthetic-reader" getBookQuote={api.getBookQuote}
        onReadPiece={setSelectedChapter} onPreviewPiece={setSelectedChapter}
        onPurchaseBundle={(_book, article) => setCheckout(`Checkout amount ${article.priceKes}; revision ${article.bookCheckoutUpdatedAt}`)} />
      <output data-testid="checkout-result">{checkout}</output>
      {selectedChapter && <section data-testid="chapter-preview" className="my-6 rounded-xl border border-slate-700 p-4">
        <h2>{selectedChapter.title}</h2><p>{selectedChapter.excerpt}</p>
        <BookChapterNavigation context={{ book, chapters }} articleId={selectedChapter.id} onReadArticle={setSelectedChapter} />
      </section>}
    </section>}
    {tab === 'manager' && <WriterReaderExperience articles={chapters} />}
    {tab === 'editor' && <WriterEditor initialArticle={{ ...chapters[0], publicationType: 'individual', content: 'A brave beginning.\nA quiet line.' }} allPublishedArticles={chapters}
      onCancel={() => {}} onPreview={() => {}} onSave={async article => {
        const response = await fetch('/api/qa/editor-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(article) });
        if (!response.ok) throw new Error('Synthetic save failed');
        return response.json() as Promise<ArticleSaveResult>;
      }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Lab />);

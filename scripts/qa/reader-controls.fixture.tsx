import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AffiliatePayoutRequest, Article, PieceSocialProof } from '../../src/types.js';
import { ReaderAccountDirectory } from '../../src/components/writer/ReaderAccountDirectory.js';
import { ReaderComments } from '../../src/components/ReaderComments.js';
import { WriterComments } from '../../src/components/writer/WriterComments.js';
import { AffiliatePayoutProcessForm } from '../../src/components/writer/AffiliatePayoutProcessForm.js';
import { AffiliatePayoutReceipt } from '../../src/components/affiliate/AffiliatePayoutReceipt.js';
import { api } from '../../src/utils/api.js';
import { ArticleReaderModal } from '../../src/components/ArticleReaderModal.js';
import { PublicReaderProof, ReaderReviewForm } from '../../src/components/ReaderReviews.js';

// Component-only synthetic lab. Never authenticates a real account or starts the app.
const piece: Article = {
  id: 'synthetic-piece', title: 'Synthetic Reader Piece', subtitle: '', slug: 'synthetic-piece',
  excerpt: 'A synthetic preview.', content: 'Synthetic text only.', category: 'Stories', status: 'published',
  isPaid: false, priceKes: 0, readTimeMinutes: 1, publishedAt: '2026-10-28',
  createdAt: '2026-10-28T12:00:00.000Z', updatedAt: '2026-10-28T12:00:00.000Z',
  downloadsCount: 0, previewParagraphs: [], tags: [],
};
const initialPayout: AffiliatePayoutRequest = {
  id: 'synthetic-payout', affiliateId: 'synthetic-partner', affiliateCode: 'SYNTHETIC',
  affiliateName: 'Synthetic Partner', amountKes: 500, salesCount: 2, commissionIds: ['synthetic-commission'],
  payoutMethod: 'mpesa', payoutDetails: { mpesaPhone: '0700000000' }, status: 'APPROVED',
  requestedAt: '2026-10-28T12:00:00.000Z',
};

function ReviewLab() {
  const [social, setSocial] = useState<PieceSocialProof | null>(null);
  const refresh = () => { void api.getPieceSocialProof(piece.id).then(setSocial); };
  useEffect(refresh, []);
  return <section data-testid="verified-review-lab" className="space-y-4">
    <PublicReaderProof articleId={piece.id} socialProof={social} />
    <ReaderReviewForm articleId={piece.id} progressPercent={90} onSaved={refresh} />
  </section>;
}
function Lab() {
  const [tab, setTab] = useState<'directory' | 'reader' | 'writer' | 'payout' | 'locked' | 'reviews'>('directory');
  const [payout, setPayout] = useState(initialPayout);
  return <main className="mx-auto max-w-6xl p-4 text-slate-100">
    <h1 className="text-xl">Synthetic reader and payout controls QA</h1>
    <nav aria-label="Synthetic QA component views" className="my-4 flex flex-wrap gap-3">
      <button type="button" onClick={() => setTab('directory')}>Reader directory lab</button>
      <button type="button" onClick={() => setTab('reader')}>Reader comments lab</button>
      <button type="button" onClick={() => setTab('writer')}>Writer comments lab</button>
      <button type="button" onClick={() => setTab('payout')}>Off-site payout lab</button>
      <button type="button" onClick={() => setTab('locked')}>Locked public reader lab</button>
      <button type="button" onClick={() => setTab('reviews')}>Verified reviews lab</button>
    </nav>
    {tab === 'directory' && <section data-testid="directory-lab"><ReaderAccountDirectory articles={[piece, { ...piece, id: 'synthetic-draft', title: 'Synthetic Private Draft', status: 'draft' }]} /></section>}
    {tab === 'reader' && <section data-testid="reader-comments-lab"><ReaderComments articleId={piece.id} readerId="synthetic-reader" canComment /></section>}
    {tab === 'writer' && <section data-testid="writer-comments-lab"><WriterComments articles={[piece]} /></section>}
    {tab === 'locked' && <ArticleReaderModal article={{ ...piece, isPaid: true, priceKes: 100, content: '' }} isOpen isUnlocked={false} onClose={() => setTab('reviews')} onUnlockRequest={() => { throw new Error('Synthetic QA must not initiate a payment.'); }} />}
    {tab === 'reviews' && <ReviewLab />}
    {tab === 'payout' && <section data-testid="payout-lab" className="max-w-2xl space-y-4">
      <h2 className="text-lg">Synthetic approved payout</h2>
      <p>Recipient: Synthetic Partner. Synthetic phone: 0700000000. Amount: KES 500.</p>
      {payout.status !== 'PAID' && <AffiliatePayoutProcessForm payout={payout} onCancel={() => {}} onProcess={async (action, reference, notes) => {
        const result = await api.processAdminAffiliatePayout(payout.id, action, reference, notes);
        setPayout(result.payout);
      }} />}
      <section aria-label="Affiliate dashboard payment receipt"><AffiliatePayoutReceipt payout={payout} /></section>
    </section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Lab />);

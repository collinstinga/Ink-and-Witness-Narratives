import React from 'react';
import { createRoot } from 'react-dom/client';
import AffiliatePartnerEmailComposer from '../../src/components/writer/AffiliatePartnerEmailComposer.js';

// Synthetic component-only lab. API calls are intercepted by partner-email.cjs.
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl p-4">
  <AffiliatePartnerEmailComposer />
</main>);

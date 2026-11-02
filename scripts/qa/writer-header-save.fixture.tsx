import React from 'react';
import { createRoot } from 'react-dom/client';
import { WriterDashboard } from '../../src/components/writer/WriterDashboard.js';

// Actual portal and editor; a fresh browser and loopback-only synthetic API.
// This does not create an application session or load an app environment.
createRoot(document.getElementById('root')!).render(<WriterDashboard
  currentUser={{ id: 'synthetic-writer', name: 'Synthetic Writer', email: 'writer@example.invalid', role: 'admin', createdAt: '2026-11-02T00:00:00.000Z' }}
  initialTab="pieces" onClose={() => {}} onPreviewArticle={() => {}}
/>);

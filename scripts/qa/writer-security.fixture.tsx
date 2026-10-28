import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WriterAccountSecurityPanel } from '../../src/components/writer/WriterAccountSecurityPanel.js';

// Only the actual panel is mounted. No real login, account, provider or DB.
function WriterSecurityLab() {
  const [open, setOpen] = useState(true);
  return <main className="mx-auto max-w-5xl p-4 text-slate-100">
    <h1 className="text-xl">Synthetic writer-security lab</h1>
    <label className="block">Unsaved writer note<input id="unsaved-note" className="my-3 block max-w-full border p-2" defaultValue="Keep this draft" /></label>
    <button type="button" onClick={() => setOpen(value => !value)} className="mb-4 min-h-11 rounded border px-3">Toggle account security</button>
    {open ? <WriterAccountSecurityPanel onClose={() => setOpen(false)} /> : null}
  </main>;
}
createRoot(document.getElementById('root')!).render(<WriterSecurityLab />);

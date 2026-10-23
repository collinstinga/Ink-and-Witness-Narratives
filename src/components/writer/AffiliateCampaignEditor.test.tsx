import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AffiliateCampaign } from '../../types.js';
import { AffiliateCampaignEditor } from './AffiliateCampaignEditor.js';

describe('writer campaign editor', () => {
  it('shows labelled schedule, active, rate and piece controls without any email send or financial-edit action', () => {
    const markup = renderToStaticMarkup(<AffiliateCampaignEditor articles={[{ id: 'piece-one', title: 'One quiet piece' }]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-labelledby=');
    for (const label of ['Campaign code', 'Campaign name', 'Commission rate', 'Attribution window', 'Starts', 'Ends', 'Campaign enabled', 'Eligible pieces', 'One quiet piece']) expect(markup).toContain(label);
    expect(markup).toContain('datetime-local');
    expect(markup).not.toContain('Send email');
    expect(markup).not.toContain('Wallet');
  });

  it('keeps an established code readonly and preserves scopes for pieces unavailable in the editor', () => {
    const campaign = { id: 'legacy', code: 'READING', name: 'Circle', commissionRate: 15, attributionDays: 30, eligiblePieceIds: ['missing-piece'],
      startDate: '2026-10-01', endDate: '2026-11-01', isActive: false } as AffiliateCampaign;
    const markup = renderToStaticMarkup(<AffiliateCampaignEditor campaign={campaign} articles={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(markup).toContain('Edit Promotional Campaign');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('value="READING"');
    expect(markup).toContain('Unavailable piece (missing-piece)');
    expect(markup).toContain('checked=""');
    expect(markup).toContain('Save campaign');
  });
});

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Article } from '../../types.js';
import { normalizeLiteraryCircleOnboardingContent } from '../../utils/literaryCircleOnboarding.js';
import { LiteraryCircleOnboardingEditor } from './LiteraryCircleOnboardingEditor.js';

describe('LiteraryCircleOnboardingEditor', () => {
  it('renders editable copy, all stable steps and three published-only curation selectors', () => {
    const articles = [{ id: 'published', title: 'Published Choice', status: 'published' },
      { id: 'draft-private', title: 'Private Draft Title', status: 'draft' }] as Article[];
    const markup = renderToStaticMarkup(<LiteraryCircleOnboardingEditor articles={articles} onChange={vi.fn()} />);
    expect(markup).toContain('New partner welcome title');
    expect(markup).toContain('Existing partner upgrade title');
    expect(markup).toContain('completed steps, account privileges and financial arrangements stay intact');
    expect(markup).toContain('Step 8 description');
    expect(markup.match(/<select/g)).toHaveLength(3);
    expect(markup).toContain('Published Choice');
    expect(markup).not.toContain('Private Draft Title');
    expect(markup).not.toContain('draft-private');
  });

  it('keeps unavailable saved selections writer-visible without exposing their draft titles', () => {
    const value = normalizeLiteraryCircleOnboardingContent({ recommendedPieceIds: ['draft-private'] });
    const markup = renderToStaticMarkup(<LiteraryCircleOnboardingEditor value={value}
      articles={[{ id: 'draft-private', title: 'Secret Draft Title', status: 'draft' }] as Article[]}
      disabled onChange={vi.fn()} />);
    expect(markup).toContain('hidden from partners');
    expect(markup).toContain('Unavailable saved selection');
    expect(markup).not.toContain('Secret Draft Title');
    expect(markup).toContain('<fieldset disabled=""');
  });
});

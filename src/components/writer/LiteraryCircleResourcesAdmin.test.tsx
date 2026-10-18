import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { LiteraryCircleResourceLibrary } from '../../types.js';
import {
  createLiteraryCircleResourceDraft,
  getLiteraryCircleResourceLibraryValidationError,
  isMeaningfulResourceAltText,
  LiteraryCircleResourcesAdmin,
  resourceIsoToLocalDateTime,
  resourceLocalDateTimeToIso,
} from './LiteraryCircleResourcesAdmin.js';

const library = (overrides: Partial<LiteraryCircleResourceLibrary> = {}): LiteraryCircleResourceLibrary => ({
  schemaVersion: 1,
  revision: 2,
  enabled: true,
  title: 'Promotional resources',
  description: 'Writer-approved partner materials.',
  items: [],
  ...overrides,
});

describe('LiteraryCircleResourcesAdmin', () => {
  it('creates a stable, unpublished resource draft without mutating the source library', () => {
    const source = library();
    const draft = createLiteraryCircleResourceDraft(source, '2026-10-18T07:00:00.000Z');

    expect(draft.id).toMatch(/^resource-/);
    expect(draft.isPublished).toBe(false);
    expect(draft.destination).toEqual({ kind: 'home' });
    expect(source.items).toEqual([]);
  });

  it('requires meaningful image alternative text and validates publish windows', () => {
    expect(isMeaningfulResourceAltText('image')).toBe(false);
    expect(isMeaningfulResourceAltText('Indigo book cover with a silver doorway')).toBe(true);

    expect(getLiteraryCircleResourceLibraryValidationError(library({
      items: [{
        ...createLiteraryCircleResourceDraft(library(), '2026-10-18T07:00:00.000Z'),
        assetId: 'private_asset',
        assetAlt: 'cover',
      }],
    }))).toMatch(/meaningful alternative text/i);

    expect(getLiteraryCircleResourceLibraryValidationError(library({
      items: [{
        ...createLiteraryCircleResourceDraft(library(), '2026-10-18T07:00:00.000Z'),
        publishedAt: '2026-10-19T00:00:00.000Z',
        expiresAt: '2026-10-18T00:00:00.000Z',
      }],
    }))).toMatch(/expire after/i);
  });

  it('round-trips local datetime controls through ISO values', () => {
    const iso = resourceLocalDateTimeToIso('2026-10-18T10:30');
    expect(iso).toBeTruthy();
    expect(resourceIsoToLocalDateTime(iso)).toBe('2026-10-18T10:30');
  });

  it('renders the empty writer-managed library and irreversible sharing warning accessibly', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleResourcesAdmin
        library={library()}
        articles={[]}
        campaigns={[]}
        saving={false}
        onSaveLibrary={vi.fn(async () => undefined)}
        onUploadImage={vi.fn(async () => undefined)}
        onRemoveImage={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('Promotional resources library');
    expect(markup).toContain('No promotional resources yet');
    expect(markup).toContain('Publishing makes promotional artwork shareable');
    expect(markup).toContain('Add resource');
  });

  it('locks every editor control while a resource mutation is in flight', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleResourcesAdmin
        library={library({ items: [createLiteraryCircleResourceDraft(library())] })}
        articles={[]}
        campaigns={[]}
        saving
        onSaveLibrary={vi.fn(async () => undefined)}
        onUploadImage={vi.fn(async () => undefined)}
        onRemoveImage={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('aria-busy="true"');
    expect(markup).toMatch(/<fieldset[^>]*disabled=""/);
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>.*Add resource/s);
  });
});

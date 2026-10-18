import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { LiteraryCircleResourceLibrary } from '../../types.js';
import {
  getNextResourceRefreshDelay,
  getResourceReferralDestination,
  getShareableResourceImageUrl,
  getVisibleLiteraryCircleResources,
  LiteraryCircleResourcesLibrary,
} from './LiteraryCircleResourcesLibrary.js';

const library = (overrides: Partial<LiteraryCircleResourceLibrary> = {}): LiteraryCircleResourceLibrary => ({
  schemaVersion: 1,
  revision: 3,
  enabled: true,
  title: 'Partner campaign desk',
  description: 'Approved words and artwork for Literary Circle partners.',
  items: [],
  ...overrides,
});

const item = (overrides: Partial<LiteraryCircleResourceLibrary['items'][number]> = {}): LiteraryCircleResourceLibrary['items'][number] => ({
  id: 'resource-one',
  kind: 'campaign_kit',
  title: 'October reading campaign',
  description: 'A tested campaign direction.',
  body: 'Share this approved caption.',
  destination: { kind: 'piece', id: 'piece-one' },
  campaignCode: 'OCTOBER',
  isPublished: true,
  order: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...overrides,
});

describe('LiteraryCircleResourcesLibrary', () => {
  it('fails closed for drafts and malformed, future, or expired publish windows', () => {
    const visible = getVisibleLiteraryCircleResources(library({
      items: [
        item({ id: 'visible', order: 2 }),
        item({ id: 'first', order: 1 }),
        item({ id: 'draft', isPublished: false, order: 0 }),
        item({ id: 'future', publishedAt: '2026-11-01T00:00:00.000Z', order: 0 }),
        item({ id: 'expired', expiresAt: '2026-10-01T00:00:00.000Z', order: 0 }),
        item({ id: 'bad-start', publishedAt: 'not-a-date', order: 0 }),
        item({ id: 'bad-expiry', expiresAt: 'not-a-date', order: 0 }),
      ],
    }), '2026-10-18T00:00:00.000Z');

    expect(visible.map(resource => resource.id)).toEqual(['first', 'visible']);
  });

  it('refreshes at the nearest scheduled boundary and idles without one', () => {
    const now = Date.parse('2026-10-18T00:00:00.000Z');
    expect(getNextResourceRefreshDelay(library({
      items: [item({ publishedAt: '2026-10-18T00:00:01.000Z' })],
    }), now)).toBe(1_025);
    expect(getNextResourceRefreshDelay(library(), now)).toBeNull();
  });

  it('derives only safe same-origin artwork paths and referral destinations', () => {
    expect(getShareableResourceImageUrl('promo_asset-1')).toBe('/api/assets/promo_asset-1');
    expect(getShareableResourceImageUrl('../secret')).toBeNull();
    expect(getResourceReferralDestination(item())).toEqual({ type: 'piece', id: 'piece-one' });
    expect(getResourceReferralDestination(item({ destination: { kind: 'home' } }))).toEqual({ type: 'home' });
  });

  it('renders approved copy, artwork actions, and an affiliate-specific tracked destination', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleResourcesLibrary
        library={library({ items: [item({ assetId: 'promo_asset-1', assetAlt: 'Blue book cover with gold lettering' })] })}
        affiliateCode="FOUNDER1"
        origin="https://inkandwitness-narratives.co.ke"
        onOpenLinkBuilder={vi.fn()}
        now="2026-10-18T00:00:00.000Z"
      />,
    );

    expect(markup).toContain('Partner campaign desk');
    expect(markup).toContain('Share this approved caption.');
    expect(markup).toContain('Blue book cover with gold lettering');
    expect(markup).toContain('/api/assets/promo_asset-1');
    expect(markup).toContain('Copy tracked link');
    expect(markup).not.toContain('data:image');
  });

  it('renders nothing when the writer disables the library', () => {
    expect(renderToStaticMarkup(
      <LiteraryCircleResourcesLibrary
        library={library({ enabled: false, items: [item()] })}
        affiliateCode="FOUNDER1"
        onOpenLinkBuilder={vi.fn()}
      />,
    )).toBe('');
  });
});

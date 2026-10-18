import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { LiteraryCircleSettings } from '../../types.js';
import {
  getNextCommunityRefreshDelay,
  getSafeCommunityActionUrl,
  getVisibleLiteraryCircleCommunityPosts,
  LiteraryCircleCommunity,
} from './LiteraryCircleCommunity.js';

const community = (overrides: Partial<LiteraryCircleSettings['community']> = {}): LiteraryCircleSettings['community'] => ({
  enabled: true,
  title: 'Private Circle Desk',
  description: 'Early reading and campaign notes.',
  posts: [],
  ...overrides,
});

describe('LiteraryCircleCommunity', () => {
  it('shows only published, started, unexpired posts in writer order', () => {
    const visible = getVisibleLiteraryCircleCommunityPosts(community({
      posts: [
        { id: 'later', type: 'announcement', title: 'Later', body: 'Later body', isPublished: true, order: 2 },
        { id: 'first', type: 'monthly_campaign', title: 'First', body: 'First body', isPublished: true, order: 1 },
        { id: 'draft', type: 'announcement', title: 'Draft', body: 'Draft body', isPublished: false, order: 0 },
        { id: 'future', type: 'release_preview', title: 'Future', body: 'Future body', isPublished: true, order: 0, publishedAt: '2026-11-01T00:00:00.000Z' },
        { id: 'expired', type: 'announcement', title: 'Expired', body: 'Expired body', isPublished: true, order: 0, expiresAt: '2026-10-01T00:00:00.000Z' },
        { id: 'invalid-schedule', type: 'announcement', title: 'Invalid schedule', body: 'Must fail closed', isPublished: true, order: 0, publishedAt: 'not-a-date' },
        { id: 'invalid-expiry', type: 'announcement', title: 'Invalid expiry', body: 'Must fail closed', isPublished: true, order: 0, expiresAt: 'not-a-date' },
      ],
    }), '2026-10-16T00:00:00.000Z');

    expect(visible.map(post => post.id)).toEqual(['first', 'later']);
  });

  it('rejects non-HTTPS or credential-bearing action links', () => {
    expect(getSafeCommunityActionUrl('https://example.com/resource')).toBe('https://example.com/resource');
    expect(getSafeCommunityActionUrl('http://example.com/resource')).toBeNull();
    expect(getSafeCommunityActionUrl('https://user:pass@example.com/resource')).toBeNull();
  });

  it('schedules a refresh at the nearest expiry instead of retaining an expired post', () => {
    const now = Date.parse('2026-10-16T00:00:00.000Z');
    const delay = getNextCommunityRefreshDelay(community({
      posts: [
        { id: 'soon', type: 'announcement', title: 'Soon', body: 'Expires soon.', isPublished: true, order: 0, expiresAt: '2026-10-16T00:00:01.000Z' },
        { id: 'later', type: 'announcement', title: 'Later', body: 'Expires later.', isPublished: true, order: 1, expiresAt: '2026-10-16T00:01:00.000Z' },
      ],
    }), now);

    expect(delay).toBe(1_025);
  });

  it('polls toward distant expiries but stays idle when nothing can expire', () => {
    const now = Date.parse('2026-10-16T00:00:00.000Z');
    expect(getNextCommunityRefreshDelay(community({
      posts: [
        { id: 'distant', type: 'announcement', title: 'Distant', body: 'Expires later.', isPublished: true, order: 0, expiresAt: '2026-10-16T01:00:00.000Z' },
      ],
    }), now)).toBe(60_000);
    expect(getNextCommunityRefreshDelay(community(), now)).toBeNull();
  });

  it('renders approved posts without exposing drafts', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleCommunity
        community={community({
          whatsappInviteUrl: 'https://chat.whatsapp.com/example',
          posts: [
            { id: 'approved', type: 'promotional_guidance', title: 'Share with context', body: 'Use the approved caption.', isPublished: true, order: 0 },
            { id: 'draft', type: 'announcement', title: 'Private draft', body: 'Not ready.', isPublished: false, order: 1 },
          ],
        })}
        articles={[]}
        onReadArticle={vi.fn()}
        now="2026-10-16T00:00:00.000Z"
      />,
    );

    expect(markup).toContain('Private Circle Desk');
    expect(markup).toContain('Share with context');
    expect(markup).not.toContain('Private draft');
    expect(markup).toContain('Open private WhatsApp invitation');
  });
});

import React from 'react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Category } from '../types.js';
import { NewsletterSignup, type NewsletterPublicConfig } from './NewsletterSignup.js';
import { ReaderCommunityHub } from './ReaderCommunityHub.js';

const enabledConfig: NewsletterPublicConfig = {
  enabled: true,
  consentVersion: 'reader-letter-v1',
  doubleOptIn: true,
};
const categories: Category[] = [
  { id: 'later', slug: 'later', name: 'Later interest', description: '', order: 2, isEnabled: true, createdAt: '2026-10-26T00:00:00.000Z' },
  { id: 'hidden', slug: 'hidden', name: 'Hidden interest', description: '', order: 0, isEnabled: false, createdAt: '2026-10-26T00:00:00.000Z' },
  { id: 'first', slug: 'first', name: 'First interest', description: '', order: 1, isEnabled: true, createdAt: '2026-10-26T00:00:00.000Z' },
];

describe('newsletter initial homepage snapshot', () => {
  it('renders the compact disclosure in the first render without waiting for an effect', () => {
    const html = renderToStaticMarkup(
      <NewsletterSignup variant="compact" initialConfig={enabledConfig} initialCategories={categories} />,
    );
    expect(html).toContain('<details');
    expect(html).toContain('New writing, delivered gently.');
    expect(html).toContain('aria-controls="newsletter-signup-panel"');
    expect(html).not.toMatch(/<details[^>]*\sopen/);
  });

  it('renders only enabled interests in writer-selected order without mutating the supplied categories', () => {
    const html = renderToStaticMarkup(
      <NewsletterSignup initialConfig={enabledConfig} initialCategories={categories} />,
    );
    expect(html).toContain('First interest');
    expect(html).toContain('Later interest');
    expect(html).not.toContain('Hidden interest');
    expect(html.indexOf('First interest')).toBeLessThan(html.indexOf('Later interest'));
    expect(categories.map(category => category.id)).toEqual(['later', 'hidden', 'first']);
  });

  it.each([null, { ...enabledConfig, enabled: false }])('does not flash an enabled form for known unavailable/disabled configuration %j', (config) => {
    expect(renderToStaticMarkup(
      <NewsletterSignup variant="compact" initialConfig={config} initialCategories={categories} />,
    )).toBe('');
  });

  it('keeps standalone callers on the existing fetch-after-mount path', () => {
    expect(renderToStaticMarkup(<NewsletterSignup variant="compact" />)).toBe('');
    const source = readFileSync(fileURLToPath(new URL('./NewsletterSignup.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('if (initialConfig !== undefined) return;');
    expect(source).toContain('api.getNewsletterConfig().catch(');
    expect(source).toContain('api.getCategories().catch(');
  });

  it('passes the known snapshot through the communication hub on its initial render', () => {
    const html = renderToStaticMarkup(
      <ReaderCommunityHub newsletterConfig={enabledConfig} categories={categories} />,
    );
    expect(html).toContain('Email Reader Letters');
    expect(html).toContain('<details');
    expect(html).toContain('New writing, delivered gently.');
    expect(html).toContain('WhatsApp Channel');
  });

  it('fetches newsletter and homepage together and passes known state without extending cache TTL', () => {
    const source = readFileSync(fileURLToPath(new URL('./views/HomeView.tsx', import.meta.url)), 'utf8');
    expect(source).toContain('const [data, freshNewsletterConfig] = await Promise.all([');
    expect(source).toContain('api.getHomepageData(),');
    expect(source).toContain('api.getNewsletterConfig(),');
    expect(source).toContain('setNewsletterConfig(freshNewsletterConfig || null);');
    expect(source).toContain('newsletterConfig={newsletterConfig}');
    expect(source).toContain('categories={categories}');
  });
});

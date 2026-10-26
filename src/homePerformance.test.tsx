import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App from './App.js';
import { HomeView } from './components/views/HomeView.js';

describe('initial public homepage rendering', () => {
  it('reserves a viewport instead of painting sections in an unsaved default order', () => {
    const html = renderToStaticMarkup(<HomeView
      author={null} articles={[]} categories={[]} unlockedTokens={{}}
      onReadArticle={vi.fn()} onUnlockArticle={vi.fn()} onPurchaseBundle={vi.fn()}
      onPurchaseSubscription={vi.fn()} onSelectCategory={vi.fn()} onNavigate={vi.fn()}
      onOpenTip={vi.fn()}
    />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('min-h-[100svh]');
    expect(html).not.toContain('id="home-hero"');
    expect(html).not.toContain('id="reader-community"');
    expect(html).not.toContain('id="home-reader-passes"');
  });

  it('does not mount, fetch or suspend on closed reader/account/payment features', () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain('id="main-navbar"');
    expect(html).toContain('id="home-view"');
    expect(html).not.toContain('Loading M-Pesa checkout');
    expect(html).not.toContain('Loading the reader');
    expect(html).not.toContain('Loading sign in');
    expect(html).not.toContain('could not finish loading');
    expect(html).not.toContain('<!--$!-->');
  });
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookState = vi.hoisted(() => ({ values: [] as unknown[] }));

// Inspect the two initial render branches without a browser or network. The
// keys are the reconciliation contract: the loading shell must not become the
// writer's banner element when the fresh homepage configuration resolves.
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const useMemo = <T,>(factory: () => T): T => factory();
  return {
    ...actual,
    default: { ...actual, useMemo },
    useMemo,
    useEffect: () => {},
    useState: (initial: unknown) => [
      hookState.values.length ? hookState.values.shift() : typeof initial === 'function' ? initial() : initial,
      () => {},
    ],
  };
});

import { HomeView } from './HomeView.js';
import { HomepageDiscovery } from '../HomepageDiscovery.js';

const props: Parameters<typeof HomeView>[0] = {
  author: null, articles: [], categories: [], unlockedTokens: {},
  onReadArticle: vi.fn(), onUnlockArticle: vi.fn(), onPurchaseBundle: vi.fn(),
  onPurchaseSubscription: vi.fn(), onSelectCategory: vi.fn(), onNavigate: vi.fn(),
  onOpenTip: vi.fn(),
};

type InspectedElement = React.ReactElement<{
  id?: string;
  className?: string;
  children?: React.ReactNode;
  config?: unknown;
  href?: string;
}>;

const writerConfig = {
  heroHeadline: 'The writer’s current headline',
  banners: [{
    id: 'writer-banner', isVisible: true, bgStyle: 'amber',
    text: 'The writer’s current announcement', linkText: 'Read it', linkUrl: '/?collection=one',
  }],
  sections: [
    { id: 'newsletter', order: 0, isVisible: true },
    { id: 'hero', order: 1, isVisible: true },
  ],
};

function loadedHome() {
  hookState.values = [writerConfig, [], [], [], [], null, true, true, null];
  return HomeView(props) as InspectedElement;
}

function elements(element: InspectedElement) {
  return React.Children.toArray(element.props.children)
    .filter(React.isValidElement) as InspectedElement[];
}

beforeEach(() => { hookState.values = []; });

describe('homepage initial paint stability', () => {
  it('gives the loading shell and configured homepage different reconciliation identities', () => {
    const loading = HomeView(props) as InspectedElement;
    const ready = loadedHome();
    expect(loading.props.id).toBe('home-view');
    expect(ready.props.id).toBe('home-view');
    expect(loading.key).toBe('homepage-loading');
    expect(ready.key).toBe('homepage-ready');
    expect(loading.key).not.toBe(ready.key);
  });

  it('does not animate a static announcement’s layout properties', () => {
    const banner = elements(loadedHome()).find(element => element.props.id === 'home-announcement-banner');
    expect(banner).toBeDefined();
    expect(banner?.props.className).not.toMatch(/\btransition-all\b/);
    expect(banner?.props.className).toContain('bg-amber-950');
  });

  it('keeps the writer’s announcement, destination and homepage configuration unchanged', () => {
    const originalConfig = JSON.stringify(writerConfig);
    const children = elements(loadedHome());
    const banner = children.find(element => element.props.id === 'home-announcement-banner');
    const bannerChildren = elements(banner!);
    expect(bannerChildren.find(element => element.type === 'span')?.props.children)
      .toBe('The writer’s current announcement');
    expect(bannerChildren.find(element => element.type === 'a')?.props.href).toBe('/?collection=one');
    expect(children.find(element => element.type === HomepageDiscovery)?.props.config).toBe(writerConfig);
    expect(JSON.stringify(writerConfig)).toBe(originalConfig);
  });
});

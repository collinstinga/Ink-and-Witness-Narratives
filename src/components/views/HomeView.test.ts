import { describe, expect, it } from 'vitest';

import { parseHomepageDeepLink } from './HomeView.js';

describe('homepage affiliate deep-link parsing', () => {
  it.each([
    ['collection', 'grief-and-grace'],
    ['bundle', 'starter.bundle'],
    ['subscription', 'reader-pass:3'],
  ] as const)('accepts one safe %s destination', (kind, id) => {
    expect(parseHomepageDeepLink(
      new URLSearchParams(),
      new URLSearchParams(`${kind}=${encodeURIComponent(id)}`),
    )).toEqual({ kind, id });
  });

  it('accepts a destination already normalized into the app hash', () => {
    expect(parseHomepageDeepLink(
      new URLSearchParams('bundle=starter-shelf'),
      new URLSearchParams(),
    )).toEqual({ kind: 'bundle', id: 'starter-shelf' });
  });

  it('fails ambiguous and unsafe destinations closed', () => {
    expect(parseHomepageDeepLink(
      new URLSearchParams(),
      new URLSearchParams('collection=one&bundle=two'),
    )).toBeNull();
    expect(parseHomepageDeepLink(
      new URLSearchParams(),
      new URLSearchParams('collection=../../writer'),
    )).toBeNull();
    expect(parseHomepageDeepLink(
      new URLSearchParams('bundle=one'),
      new URLSearchParams('bundle=two'),
    )).toBeNull();
  });
});

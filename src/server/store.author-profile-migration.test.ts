import { describe, expect, it } from 'vitest';
import { hasLegacyXIdentity } from './store.js';

describe('author X profile migration guard', () => {
  it('matches only the exact confirmed legacy identity', () => {
    expect(hasLegacyXIdentity({
      twitter: '@bigboy_jake',
      twitterUrl: 'https://twitter.com/bigboy_jake'
    })).toBe(true);

    expect(hasLegacyXIdentity({
      twitter: '@bigboyjake_',
      twitterUrl: 'https://x.com/bigboyjake_'
    })).toBe(false);
    expect(hasLegacyXIdentity({
      twitter: '@another_writer',
      twitterUrl: 'https://x.com/another_writer'
    })).toBe(false);
    expect(hasLegacyXIdentity(null)).toBe(false);
  });
});

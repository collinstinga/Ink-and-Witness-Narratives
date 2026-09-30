import { describe, expect, it } from 'vitest';
import { resolveDirectWriterTab } from './writerNavigation.js';

describe('writer navigation', () => {
  it.each([
    'newsletter',
    'topics',
    'affiliates',
    'readers',
    'payments'
  ])('preserves the %s workspace across a refresh', tab => {
    expect(resolveDirectWriterTab(tab)).toBe(tab);
  });

  it.each([
    undefined,
    '',
    'unknown',
    'pieces',
    'homepage',
    'editor'
  ])('leaves special or unknown route %s to the main parser', tab => {
    expect(resolveDirectWriterTab(tab)).toBeNull();
  });
});

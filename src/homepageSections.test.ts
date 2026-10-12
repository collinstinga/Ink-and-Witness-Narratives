import { describe, expect, it } from 'vitest';

import {
  HOMEPAGE_SECTION_IDS,
  normalizeHomepageSections,
} from './homepageSections.js';

describe('homepage section layout', () => {
  it('defaults old and missing configurations to the complete safe layout', () => {
    expect(normalizeHomepageSections(undefined).map(section => section.id)).toEqual(
      HOMEPAGE_SECTION_IDS,
    );
    expect(normalizeHomepageSections([
      { id: 'piece_of_the_week', isVisible: false, order: 1 },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'hero', isVisible: true, order: 1 }),
      expect.objectContaining({ id: 'subscriptions', isVisible: true, order: 2 }),
      expect.objectContaining({ id: 'pieces', isVisible: true, order: 7 }),
    ]));
  });

  it('inserts Reader Passes directly after the hero for legacy saved layouts', () => {
    const sections = normalizeHomepageSections([
      { id: 'hero', isVisible: true, order: 1 },
      { id: 'newsletter', isVisible: true, order: 2 },
      { id: 'bundles', isVisible: true, order: 3 },
      { id: 'library', isVisible: true, order: 4 },
      { id: 'collections', isVisible: true, order: 5 },
      { id: 'pieces', isVisible: true, order: 6 },
    ]);

    expect(sections.map(section => section.id)).toEqual([
      'hero',
      'subscriptions',
      'newsletter',
      'bundles',
      'library',
      'collections',
      'pieces',
    ]);
    expect(sections[1]).toMatchObject({
      id: 'subscriptions',
      isVisible: true,
      order: 2,
    });
  });

  it('preserves writer visibility and ordering while removing duplicates', () => {
    const sections = normalizeHomepageSections([
      { id: 'collections', isVisible: false, order: 1 },
      { id: 'newsletter', isVisible: true, order: 2 },
      { id: 'collections', isVisible: true, order: 3 },
      { id: 'bundles', isVisible: true, order: 4 },
    ]);

    expect(sections.map(section => section.id)).toEqual([
      'subscriptions',
      'collections',
      'newsletter',
      'bundles',
      'hero',
      'library',
      'pieces',
    ]);
    expect(sections[0]).toMatchObject({ id: 'subscriptions', isVisible: true, order: 1 });
    expect(sections[1]).toMatchObject({ id: 'collections', isVisible: false, order: 2 });
    expect(new Set(sections.map(section => section.id)).size).toBe(sections.length);
  });
});

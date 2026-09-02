import type { Article, AuthorProfile } from '../types.js';

const now = new Date().toISOString();

export const INITIAL_ARTICLES: Article[] = [
  {
    id: 'seed-welcome',
    title: 'Ink & Witness',
    subtitle: 'Narratives that linger',
    slug: 'ink-and-witness',
    excerpt: 'Welcome to Ink & Witness Narratives.',
    synopsis: 'A placeholder seed used only when no persisted articles are available.',
    content: 'Welcome to Ink & Witness Narratives.',
    category: 'General',
    status: 'draft',
    isPaid: false,
    priceKes: 0,
    readTimeMinutes: 1,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    downloadsCount: 0,
    previewParagraphs: ['Welcome to Ink & Witness Narratives.'],
    tags: ['welcome']
  }
];

export const JAKE_PROFILE: AuthorProfile = {
  name: 'Jake',
  handle: '@collinstinga',
  instagram: 'collinstinga',
  instagramUrl: '',
  title: 'Writer',
  bio: 'Writer and storyteller.',
  extendedBio: 'Ink & Witness Narratives explores stories, poetry, desire and the human experience.',
  location: 'Kenya',
  featuredQuote: 'Words that linger.',
  stats: {
    articlesCount: 0,
    readersCount: 0,
    satisfactionRate: '—',
    instagramFollowers: '—'
  }
};

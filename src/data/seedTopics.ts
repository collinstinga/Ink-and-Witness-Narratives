import type { Topic } from '../types.js';

const now = new Date().toISOString();

export const INITIAL_SEED_TOPICS: Topic[] = [
  {
    id: 'general',
    name: 'General',
    slug: 'general',
    description: 'General narratives and reflections.',
    displayOrder: 1,
    homepageVisible: true,
    pieceIds: [],
    sortMode: 'newest',
    createdAt: now
  }
];

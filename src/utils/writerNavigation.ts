import type { WriterNavTab } from '../types.js';

const DIRECT_WRITER_TABS = new Set<WriterNavTab>([
  'drafts',
  'published',
  'categories',
  'topics',
  'reader-experience',
  'media',
  'analytics',
  'readers',
  'newsletter',
  'payments',
  'tips',
  'comments',
  'affiliates',
  'settings'
]);

export function resolveDirectWriterTab(value: string | undefined): WriterNavTab | null {
  return value && DIRECT_WRITER_TABS.has(value as WriterNavTab)
    ? value as WriterNavTab
    : null;
}

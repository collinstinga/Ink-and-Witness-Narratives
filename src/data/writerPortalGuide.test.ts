import { describe, expect, it } from 'vitest';
import { WRITER_PORTAL_GUIDE } from './writerPortalGuide.js';

const text = JSON.stringify(WRITER_PORTAL_GUIDE);

describe('permanent Writer Studio guide content', () => {
  it('has unique searchable sections and a completely linked, read-only demo journey', () => {
    const ids = WRITER_PORTAL_GUIDE.sections.map(section => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(19);
    for (const section of WRITER_PORTAL_GUIDE.sections) {
      expect(section.title.trim()).not.toBe('');
      expect(section.summary.trim()).not.toBe('');
      expect(section.steps.length).toBeGreaterThanOrEqual(3);
      expect(section.keywords?.length).toBeGreaterThan(0);
      expect(section.destination).toBeUndefined();
    }
    for (const step of WRITER_PORTAL_GUIDE.journey) {
      expect(ids).toContain(step.sectionId);
      expect(step.description.length).toBeGreaterThan(30);
    }
    expect(WRITER_PORTAL_GUIDE.intro).toContain('without changing records');
  });

  it('names the real writer navigation labels and section-specific save controls', () => {
    for (const label of [
      'All Pieces', 'Private Drafts', 'Published', 'Write New Piece',
      'Homepage Layout', 'Topic Catalogue', 'Categories', 'Reader Experience',
      'Reader Passes', 'Media & Branding', 'Analytics & Sales', 'Readers & Licenses',
      'Email Terminal', 'Pay-to-Read M-Pesa', 'Reader Tips', 'Comments', 'Affiliates Control', 'Settings & Till',
      'Save Draft', 'Publish Live', 'Update Published', 'Save Homepage', 'Save Reader Pass',
      'Save collection', 'Save bundle', 'Save Literary Circle settings', 'Save payout minimum',
    ]) expect(text).toContain(label);
    expect(text).toContain('does not submit every open form');
  });

  it('distinguishes access, money, referral eligibility and unreleased automation', () => {
    for (const clause of [
      'same phone can receive a separate grant for a different piece',
      'binds access to that reader account and piece',
      'you cannot view or choose their password',
      'Every renewal requires a new confirmed M-Pesa payment',
      'Do not instruct the reader to pay again',
      'It must not give an affiliate every unrelated future purchase',
      'Historical earned commissions must not be reduced',
      'Complimentary reading is not a sale',
      'not proven net profit',
      'does not itself send or queue mail',
      'separate reviewed production delivery gate',
    ]) expect(text).toContain(clause);
  });

  it('contains no account credentials, personal emails or private WhatsApp invitation', () => {
    expect(text).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    expect(text).not.toMatch(/chat\.whatsapp\.com\//i);
    expect(text).not.toMatch(/Bearer\s+[A-Za-z0-9_-]+|-----BEGIN .*PRIVATE KEY-----/);
    expect(text).toContain('JPEG cover up to 5 MB');
  });
});

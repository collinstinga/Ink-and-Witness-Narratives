import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { PortalGuideDefinition } from '../../data/portalGuideTypes.js';
import { filterPortalGuideSections, PortalGuideDialog, PortalGuidePanel } from './PortalGuideDialog.js';

const guide: PortalGuideDefinition = {
  id: 'fixture', title: 'Fixture guide', intro: 'Read-only guidance.',
  sections: [
    { id: 'membership', title: 'Membership', summary: 'Your circle access.', keywords: ['founder'], steps: ['Look at your badge.'], notes: ['Not a paid purchase.'], destination: 'overview', destinationLabel: 'Open overview' },
    { id: 'payouts', title: 'Payout requests', summary: 'Check the wallet.', keywords: ['KES', 'ksh'], steps: ['Review available balance.'], notes: ['Café & safe notes.'] },
    { id: 'markup', title: '<script>alert(1)</script>', summary: '<img src=x onerror=alert(1)>', steps: ['Never render raw HTML.'] },
  ],
  journey: [{ title: 'Start here', description: 'Find your membership.', sectionId: 'membership' }],
};

describe('permanent portal help', () => {
  it('searches titles, steps, notes and keywords without changing source content', () => {
    expect(filterPortalGuideSections(guide.sections, '  PAYOUT  wallet ')).toEqual([guide.sections[1]]);
    expect(filterPortalGuideSections(guide.sections, 'founder')).toEqual([guide.sections[0]]);
    expect(filterPortalGuideSections(guide.sections, 'cafe')).toEqual([guide.sections[1]]);
    expect(filterPortalGuideSections(guide.sections, 'badge')).toEqual([guide.sections[0]]);
    expect(filterPortalGuideSections(guide.sections, '  ')).toBe(guide.sections);
    expect(filterPortalGuideSections(guide.sections, 'unknown topic')).toEqual([]);
    expect(guide.sections).toHaveLength(3);
  });

  it('bounds search and treats regex metacharacters as ordinary text', () => {
    expect(() => filterPortalGuideSections(guide.sections, '[')).not.toThrow();
    expect(filterPortalGuideSections(guide.sections, '[')).toEqual([]);
    expect(filterPortalGuideSections(guide.sections, 'x'.repeat(10000))).toEqual([]);
  });

  it('renders labelled search, semantic topic buttons, numbered steps and safe demo disclosure', () => {
    const navigate = vi.fn();
    const close = vi.fn();
    const markup = renderToStaticMarkup(<PortalGuidePanel guide={guide} onNavigate={navigate} onClose={close} />);
    expect(markup).toContain('Find a feature or task');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('maxLength="160"');
    expect(markup).toContain('aria-label="Fixture guide topics"');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('<ol');
    expect(markup).toContain('Start safe demo');
    expect(markup).toContain('it never saves, sends, pays or changes your account');
    expect(markup).toContain('Open overview');
    expect(navigate).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it('renders a usable no-result state and hides navigation for unsaved forms', () => {
    const empty = renderToStaticMarkup(<PortalGuidePanel guide={guide} onClose={vi.fn()} initialQuery="unknown" />);
    expect(empty).toContain('No matching topics');
    expect(empty).toContain('Clear search');
    expect(empty).toContain('0 topics found');
    const protectedForm = renderToStaticMarkup(<PortalGuidePanel guide={guide} onClose={vi.fn()} navigationNotice="Close the guide to return to your unsaved form." />);
    expect(protectedForm).not.toContain('Open overview');
    expect(protectedForm).toContain('return to your unsaved form');
  });

  it('escapes text content rather than inserting executable markup', () => {
    const markup = renderToStaticMarkup(<PortalGuidePanel guide={guide} onClose={vi.fn()} initialQuery="raw HTML" />);
    expect(markup).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).not.toContain('<script>');
    expect(markup).not.toContain('<img src=x');
  });

  it('keeps closed guides absent and open guides named without invoking actions', () => {
    expect(renderToStaticMarkup(<PortalGuideDialog guide={guide} open={false} onClose={vi.fn()} />)).toBe('');
    const markup = renderToStaticMarkup(<PortalGuideDialog guide={guide} open onClose={vi.fn()} />);
    expect(markup).toContain('<dialog');
    expect(markup).toContain('aria-label="Fixture guide"');
    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('localStorage');
  });
});

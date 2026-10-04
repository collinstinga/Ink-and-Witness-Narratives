import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { NewsletterSignupDisclosure } from './NewsletterSignupDisclosure.js';

describe('NewsletterSignupDisclosure', () => {
  it('renders a compact native disclosure with an associated panel', () => {
    const markup = renderToStaticMarkup(
      <NewsletterSignupDisclosure>
        <form aria-label="Newsletter form" />
      </NewsletterSignupDisclosure>,
    );

    expect(markup).toContain('<details class="group">');
    expect(markup).toContain('aria-controls="newsletter-signup-panel"');
    expect(markup).toContain('id="newsletter-signup-panel"');
    expect(markup).toContain('New writing, delivered gently.');
    expect(markup).toContain('aria-label="Newsletter form"');
  });

  it('can be expanded initially without changing its child content', () => {
    const markup = renderToStaticMarkup(
      <NewsletterSignupDisclosure defaultOpen>
        <p>Choose your interests</p>
      </NewsletterSignupDisclosure>,
    );

    expect(markup).toContain('<details class="group" open="">');
    expect(markup).toContain('Choose your interests');
  });
});

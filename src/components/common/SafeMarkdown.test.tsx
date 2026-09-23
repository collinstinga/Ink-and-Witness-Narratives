import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SafeMarkdown } from './SafeMarkdown.js';

function render(markdown: string): string {
  return renderToStaticMarkup(<SafeMarkdown markdown={markdown} variant="preview" />);
}

describe('SafeMarkdown', () => {
  it('renders inline emphasis and headings', () => {
    const html = render('# Heading\n\nA **bold** and *gentle* line.');
    expect(html).toContain('<h2');
    expect(html).toContain('<strong');
    expect(html).toContain('bold</strong>');
    expect(html).toContain('<em');
  });

  it('preserves ordered and unordered list semantics', () => {
    const html = render('- One\n- Two\n\n1. First\n2. Second');
    expect(html).toContain('<ul');
    expect(html).toContain('<ol');
    expect(html).toContain('<li');
  });

  it('renders quotes, safe links, safe images, and dividers', () => {
    const html = render('> A remembered line\n\n[Read](https://example.com/read)\n\n![Cover](/api/assets/cover_jpg)\n\n---');
    expect(html).toContain('<blockquote');
    expect(html).toContain('href="https://example.com/read"');
    expect(html).toContain('src="/api/assets/cover_jpg"');
    expect(html).toContain('<hr');
  });

  it('drops raw HTML and blocks unsafe URL schemes', () => {
    const html = render('<script>alert(1)</script>\n\n[Bad](javascript:alert(1))\n\n![Bad](data:text/html,bad)');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('data:text');
    expect(html).not.toContain('<img');
  });

  it('renders malformed markdown as harmless text', () => {
    const html = render('An **unfinished thought and [unfinished link');
    expect(html).toContain('unfinished thought');
    expect(html).not.toContain('<script');
  });
});

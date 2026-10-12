import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { HomepageConfig } from '../types.js';
import { ReaderCommunityHub } from './ReaderCommunityHub.js';

const config = (overrides: Partial<HomepageConfig> = {}): HomepageConfig => ({
  welcomeBackground: {
    imageUrl: '',
    fit: 'cover',
    positionX: 50,
    positionY: 50,
    zoom: 100,
    overlayStrength: 25,
  },
  mostSellingPieceIds: [],
  communicationHeading: 'Choose your update path',
  communicationDescription: 'Private email or the public channel.',
  communicationEmailEnabled: false,
  communicationWhatsappEnabled: true,
  communicationWhatsappLabel: 'Follow Jake on WhatsApp',
  communicationWhatsappDescription: 'Release notices posted by the writer.',
  communicationWhatsappUrl: 'https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z',
  ...overrides,
});

describe('ReaderCommunityHub', () => {
  it('renders the configured official channel as an isolated external link', () => {
    const markup = renderToStaticMarkup(<ReaderCommunityHub config={config()} />);

    expect(markup).toContain('Choose your update path');
    expect(markup).toContain('Follow Jake on WhatsApp');
    expect(markup).toContain('href="https://whatsapp.com/channel/0029Vb8zwQA0gcfBDoRCWM3z"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noopener noreferrer"');
    expect(markup).not.toContain('Subscribe to reader letters');
  });

  it('renders nothing when the writer disables both communication branches', () => {
    const markup = renderToStaticMarkup(
      <ReaderCommunityHub
        config={config({ communicationEmailEnabled: false, communicationWhatsappEnabled: false })}
      />,
    );
    expect(markup).toBe('');
  });
});

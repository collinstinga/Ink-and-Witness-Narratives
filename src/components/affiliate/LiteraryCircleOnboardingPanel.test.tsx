import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { AffiliateLiteraryCircleMembership } from '../../types.js';
import {
  LITERARY_CIRCLE_ONBOARDING_STEPS,
  LiteraryCircleOnboardingPanel,
} from './LiteraryCircleOnboardingPanel.js';

const onboarding = (
  overrides: Partial<AffiliateLiteraryCircleMembership['onboarding']> = {},
): AffiliateLiteraryCircleMembership['onboarding'] => ({
  version: 1,
  audience: 'existing_upgrade',
  status: 'not_started',
  completedStepIds: [],
  welcomeRequired: true,
  ...overrides,
});

describe('LiteraryCircleOnboardingPanel', () => {
  it('renders the eight-step existing-affiliate upgrade without implying a new account', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding()}
        affiliateCode="AMINA9"
        recommendedPieces={[
          { id: 'piece-1', title: 'The First Witness' },
          { id: 'piece-2', title: 'A Map of Longing' },
          { id: 'piece-3', title: 'Ink After Rain' },
        ]}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );

    expect(LITERARY_CIRCLE_ONBOARDING_STEPS).toHaveLength(8);
    for (const step of LITERARY_CIRCLE_ONBOARDING_STEPS) {
      expect(markup).toContain(step.title);
    }
    expect(markup).toContain('Your Literary Circle upgrade is ready');
    expect(markup).toContain('account, referral identity, sales history, commissions, and wallet remain intact');
    expect(markup).toContain('aria-current="step"');
  });

  it('uses persisted completed step ids to advance to the next step', () => {
    const markup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding({
          status: 'in_progress',
          completedStepIds: ['welcome', 'complimentary_access'],
        })}
        affiliateCode="AMINA9"
        recommendedPieces={[]}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );

    expect(markup).toContain('One-time guided welcome · 3 of 8');
    expect(markup).toContain('Step 3');
    expect(markup).toContain('Draft tier rates do not replace an existing arrangement until activated.');
  });

  it('stays hidden after the one-time guide is completed or dismissed', () => {
    const completedMarkup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding({ status: 'completed' })}
        affiliateCode="AMINA9"
        recommendedPieces={[]}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );
    const dismissedMarkup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding({ status: 'dismissed' })}
        affiliateCode="AMINA9"
        recommendedPieces={[]}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );

    expect(completedMarkup).toBe('');
    expect(dismissedMarkup).toBe('');
  });

  it('shows an external community invitation only when community access is enabled', () => {
    const finalStepIds = LITERARY_CIRCLE_ONBOARDING_STEPS.slice(0, -1).map(step => step.id);
    const enabledMarkup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding({ status: 'in_progress', completedStepIds: finalStepIds })}
        affiliateCode="AMINA9"
        recommendedPieces={[]}
        community={{
          enabled: true,
          title: 'Private Literary Circle',
          whatsappInviteUrl: 'https://chat.whatsapp.com/circle',
        }}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );
    const disabledMarkup = renderToStaticMarkup(
      <LiteraryCircleOnboardingPanel
        onboarding={onboarding({ status: 'in_progress', completedStepIds: finalStepIds })}
        affiliateCode="AMINA9"
        recommendedPieces={[]}
        community={{
          enabled: false,
          title: 'Private Literary Circle',
          whatsappInviteUrl: 'https://chat.whatsapp.com/circle',
        }}
        onUpdate={vi.fn(async () => undefined)}
      />,
    );

    expect(enabledMarkup).toContain('href="https://chat.whatsapp.com/circle"');
    expect(enabledMarkup).toContain('joining is optional');
    expect(disabledMarkup).not.toContain('chat.whatsapp.com/circle');
  });
});

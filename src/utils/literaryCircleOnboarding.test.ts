import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT, LITERARY_CIRCLE_ONBOARDING_STEP_IDS,
  normalizeLiteraryCircleOnboardingContent, projectLiteraryCircleOnboardingContent,
  selectLiteraryCircleOnboardingPieces, validateLiteraryCircleOnboardingContent
} from './literaryCircleOnboarding.js';
import { DEFAULT_LITERARY_CIRCLE_SETTINGS, isLiteraryCircleCommissionPolicyChange,
  normalizeLiteraryCircleSettings, validateLiteraryCircleSettings } from '../server/literaryCircle.js';

describe('writer-managed Literary Circle onboarding', () => {
  it('preserves all eight original IDs and independent default copies for legacy settings', () => {
    const content = normalizeLiteraryCircleOnboardingContent(undefined);
    expect(content).toEqual(DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT);
    expect(content.steps.map(step => step.id)).toEqual(LITERARY_CIRCLE_ONBOARDING_STEP_IDS);
    content.steps[0].title = 'Changed local copy';
    expect(normalizeLiteraryCircleOnboardingContent(undefined).steps[0].title).toBe('Welcome to the Circle');
    expect(normalizeLiteraryCircleSettings({}).onboardingContent?.welcomeTitle).toBe('Welcome to the Literary Circle');
  });

  it('allows bounded plain-text overrides without reordering progress or changing financial policy', () => {
    const content = validateLiteraryCircleOnboardingContent({ welcomeTitle: 'Your reading partnership',
      steps: [{ id: 'first_link', title: 'Share one genuine favourite', description: 'Use your own words and the approved link builder.' }],
      recommendedPieceIds: ['piece-c', 'piece-a'] });
    expect(content.steps.map(step => step.id)).toEqual(LITERARY_CIRCLE_ONBOARDING_STEP_IDS);
    expect(content.steps[5].title).toBe('Share one genuine favourite');
    const next = { ...DEFAULT_LITERARY_CIRCLE_SETTINGS, onboardingContent: content };
    expect(validateLiteraryCircleSettings(next).onboardingContent).toEqual(content);
    expect(isLiteraryCircleCommissionPolicyChange(DEFAULT_LITERARY_CIRCLE_SETTINGS, next)).toBe(false);
  });

  it.each([
    { unknown: 'unsupported' }, { welcomeTitle: '' }, { welcomeTitle: 'a'.repeat(121) },
    { description: 'a'.repeat(601) }, { description: '<script>unsafe</script>' },
    { steps: [{ id: 'replaced_progress', title: 'Bad', description: 'Bad' }] },
    { steps: [{ id: 'welcome', title: 'One', description: 'One' }, { id: 'welcome', title: 'Two', description: 'Two' }] },
    { steps: [{ id: 'welcome', title: 'One', description: 'One', published: true }] },
    { steps: [{ id: 'welcome', title: 'a'.repeat(121), description: 'Body' }] },
    { recommendedPieceIds: ['one', 'one'] }, { recommendedPieceIds: ['one', 'two', 'three', 'four'] },
    { recommendedPieceIds: ['unsafe/path'] }
  ])('rejects malformed writes instead of silently losing configuration: %j', content => {
    expect(() => validateLiteraryCircleOnboardingContent(content)).toThrow();
    expect(() => validateLiteraryCircleSettings({ ...DEFAULT_LITERARY_CIRCLE_SETTINGS, onboardingContent: content })).toThrow();
  });

  it('does not disclose configured draft or unknown IDs without explicit published evidence', () => {
    const content = { ...DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT, recommendedPieceIds: ['draft-private', 'piece-c', 'deleted-private'] };
    expect(projectLiteraryCircleOnboardingContent(content).recommendedPieceIds).toEqual([]);
    const projected = projectLiteraryCircleOnboardingContent(content, ['piece-c', 'piece-a']);
    expect(projected.recommendedPieceIds).toEqual(['piece-c']);
    expect(JSON.stringify(projected)).not.toMatch(/draft-private|deleted-private/);
  });

  it('honours curated order and excludes drafts and future releases from recommendations', () => {
    const pieces = [
      { id: 'piece-a', title: 'First Published', status: 'published' as const },
      { id: 'draft-private', title: 'Private Draft', status: 'draft' as const },
      { id: 'piece-c', title: 'Chosen First', status: 'published' as const },
      { id: 'future', title: 'Not Released', status: 'published' as const, publishedAt: '2035-01-01T00:00:00.000Z' }
    ];
    const content = { ...DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT, recommendedPieceIds: ['piece-c', 'draft-private', 'piece-a'] };
    expect(selectLiteraryCircleOnboardingPieces(content, pieces).map(piece => piece.id)).toEqual(['piece-c', 'piece-a']);
    expect(selectLiteraryCircleOnboardingPieces(undefined, pieces).map(piece => piece.id)).toEqual(['piece-a', 'piece-c']);
  });
});

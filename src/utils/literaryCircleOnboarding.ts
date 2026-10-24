import type { Article, LiteraryCircleOnboardingContent, LiteraryCircleOnboardingStepId } from '../types.js';

export const LITERARY_CIRCLE_ONBOARDING_STEP_IDS = [
  'welcome', 'complimentary_access', 'commissions', 'referral_links',
  'recommended_reads', 'first_link', 'promotional_resources', 'community_invitation'
] as const satisfies readonly LiteraryCircleOnboardingStepId[];

export const DEFAULT_LITERARY_CIRCLE_ONBOARDING_STEPS: LiteraryCircleOnboardingContent['steps'] = [
  { id: 'welcome', title: 'Welcome to the Circle', description: 'Meet your upgraded partnership space and the privileges attached to your membership.' },
  { id: 'complimentary_access', title: 'Unlock your reading', description: 'Every published piece and chapter is available to read while your complimentary access is active.' },
  { id: 'commissions', title: 'Understand earnings', description: 'Eligible commissions begin with verified purchases. Draft tier rates do not replace an existing arrangement until activated.' },
  { id: 'referral_links', title: 'Know your referral link', description: 'Your existing affiliate identity remains yours, including the link and history already attached to it.' },
  { id: 'recommended_reads', title: 'Choose three pieces', description: 'Start with a short reading list so your first recommendations come from genuine experience.' },
  { id: 'first_link', title: 'Create your first share', description: 'Build a link to the homepage, a piece, collection, bundle, or Reader Pass, then share it with the readers you know best.' },
  { id: 'promotional_resources', title: 'Use campaign resources', description: 'Pair your links with writer-approved campaign material, captions, covers, and release guidance.' },
  { id: 'community_invitation', title: 'Join the private community', description: 'Receive writer announcements and campaign direction; joining any external group is always your choice.' }
];

export const DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT: LiteraryCircleOnboardingContent = {
  welcomeTitle: 'Welcome to the Literary Circle',
  upgradeTitle: 'Your Literary Circle upgrade is ready',
  description: '',
  steps: DEFAULT_LITERARY_CIRCLE_ONBOARDING_STEPS,
  recommendedPieceIds: []
};

const STEP_IDS = new Set<string>(LITERARY_CIRCLE_ONBOARDING_STEP_IDS);
const PIECE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const MARKUP = /<\/?[A-Za-z][^>]*>/;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const plainText = (value: unknown, max: number, empty = false): value is string => typeof value === 'string'
  && value.length <= max && (empty || Boolean(value.trim())) && !CONTROL.test(value) && !MARKUP.test(value);

export class LiteraryCircleOnboardingValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'LiteraryCircleOnboardingValidationError'; }
}

/** Tolerant read normalization keeps legacy settings and all eight progress IDs valid. */
export function normalizeLiteraryCircleOnboardingContent(value: unknown): LiteraryCircleOnboardingContent {
  const raw = record(value) ? value : {};
  const overrides = new Map<string, Record<string, unknown>>();
  if (Array.isArray(raw.steps)) {
    for (const step of raw.steps.slice(0, 8)) {
      if (record(step) && typeof step.id === 'string' && STEP_IDS.has(step.id) && !overrides.has(step.id)) overrides.set(step.id, step);
    }
  }
  const defaults = DEFAULT_LITERARY_CIRCLE_ONBOARDING_CONTENT;
  return {
    welcomeTitle: plainText(raw.welcomeTitle, 120) ? raw.welcomeTitle.trim() : defaults.welcomeTitle,
    upgradeTitle: plainText(raw.upgradeTitle, 120) ? raw.upgradeTitle.trim() : defaults.upgradeTitle,
    description: plainText(raw.description, 600, true) ? raw.description.trim() : defaults.description,
    steps: DEFAULT_LITERARY_CIRCLE_ONBOARDING_STEPS.map(step => {
      const supplied = overrides.get(step.id);
      return { id: step.id,
        title: plainText(supplied?.title, 120) ? supplied.title.trim() : step.title,
        description: plainText(supplied?.description, 600) ? supplied.description.trim() : step.description };
    }),
    recommendedPieceIds: Array.isArray(raw.recommendedPieceIds)
      ? [...new Set(raw.recommendedPieceIds.filter((id): id is string => typeof id === 'string' && PIECE_ID.test(id)))].slice(0, 3)
      : []
  };
}

function allowFields(value: Record<string, unknown>, allowed: string[], label: string) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new LiteraryCircleOnboardingValidationError(`${label} contains unsupported fields.`);
}

/** Strict write validation never silently drops mistyped, duplicate or unknown steps. */
export function validateLiteraryCircleOnboardingContent(value: unknown): LiteraryCircleOnboardingContent {
  if (!record(value)) throw new LiteraryCircleOnboardingValidationError('Onboarding content must be an object.');
  allowFields(value, ['welcomeTitle', 'upgradeTitle', 'description', 'steps', 'recommendedPieceIds'], 'Onboarding content');
  for (const field of ['welcomeTitle', 'upgradeTitle', 'description'] as const) {
    if (value[field] !== undefined && !plainText(value[field], field === 'description' ? 600 : 120, field === 'description')) {
      throw new LiteraryCircleOnboardingValidationError(`Onboarding ${field} must be plain text within ${field === 'description' ? 600 : 120} characters.`);
    }
  }
  if (value.steps !== undefined) {
    if (!Array.isArray(value.steps) || value.steps.length > 8) throw new LiteraryCircleOnboardingValidationError('Configure at most the eight existing onboarding steps.');
    const seen = new Set<string>();
    for (const step of value.steps) {
      if (!record(step)) throw new LiteraryCircleOnboardingValidationError('Each onboarding step must be an object.');
      allowFields(step, ['id', 'title', 'description'], 'Onboarding step');
      if (typeof step.id !== 'string' || !STEP_IDS.has(step.id) || seen.has(step.id)) {
        throw new LiteraryCircleOnboardingValidationError('Onboarding step identifiers must be known and unique.');
      }
      seen.add(step.id);
      if (!plainText(step.title, 120) || !plainText(step.description, 600)) {
        throw new LiteraryCircleOnboardingValidationError('Each onboarding step needs a plain-text title (120 characters) and description (600 characters).');
      }
    }
  }
  if (value.recommendedPieceIds !== undefined) {
    if (!Array.isArray(value.recommendedPieceIds) || value.recommendedPieceIds.length > 3
      || value.recommendedPieceIds.some(id => typeof id !== 'string' || !PIECE_ID.test(id))
      || new Set(value.recommendedPieceIds).size !== value.recommendedPieceIds.length) {
      throw new LiteraryCircleOnboardingValidationError('Choose up to three distinct valid published piece identifiers.');
    }
  }
  return normalizeLiteraryCircleOnboardingContent(value);
}

/** Do not disclose configured draft, deleted or scheduled-piece identifiers. */
export function projectLiteraryCircleOnboardingContent(value: unknown, publishedPieceIds: readonly string[] = []): LiteraryCircleOnboardingContent {
  const content = normalizeLiteraryCircleOnboardingContent(value);
  const published = new Set(publishedPieceIds);
  return { ...content, recommendedPieceIds: content.recommendedPieceIds.filter(id => published.has(id)) };
}

export function publishedOnboardingPieces<T extends Pick<Article, 'id' | 'title'> & Partial<Pick<Article, 'status' | 'publishedAt'>>>(
  pieces: readonly T[], now = Date.now()
): T[] {
  return pieces.filter(piece => (!piece.status || piece.status === 'published')
    && (!piece.publishedAt || !Number.isFinite(Date.parse(piece.publishedAt)) || Date.parse(piece.publishedAt) <= now));
}

export function selectLiteraryCircleOnboardingPieces<T extends Pick<Article, 'id' | 'title'> & Partial<Pick<Article, 'status' | 'publishedAt'>>>(
  contentValue: unknown, pieces: readonly T[], now = Date.now()
): T[] {
  const piecesById = new Map(publishedOnboardingPieces(pieces, now).map(piece => [piece.id, piece]));
  const content = normalizeLiteraryCircleOnboardingContent(contentValue);
  const selected = content.recommendedPieceIds.flatMap(id => {
    const piece = piecesById.get(id);
    return piece ? [piece] : [];
  });
  return (selected.length ? selected : [...piecesById.values()]).slice(0, 3);
}

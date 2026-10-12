import type { HomepageSectionItem } from './types.js';

export const HOMEPAGE_SECTION_DEFINITIONS = [
  {
    id: 'hero',
    title: 'Welcome hero',
    description: 'The main introduction, background photo, quote, and opening button.',
  },
  {
    id: 'subscriptions',
    title: 'Reader passes',
    description: 'Time-limited full-catalogue access plans and renewal options.',
  },
  {
    id: 'newsletter',
    title: 'Reader community',
    description: 'The compact email and WhatsApp update hub.',
  },
  {
    id: 'bundles',
    title: 'Reader bundles',
    description: 'Paid sets that unlock every included piece after confirmed payment.',
  },
  {
    id: 'library',
    title: 'Library shelves',
    description: 'Category-based navigation such as healing, grief, or adventure.',
  },
  {
    id: 'collections',
    title: 'Curated collections',
    description: 'Editorial browsing groups selected in Writer Studio.',
  },
  {
    id: 'pieces',
    title: 'Individual pieces',
    description: 'The deduplicated standalone-piece shelf and full-archive link.',
  },
] as const;

export type HomepageSectionId = typeof HOMEPAGE_SECTION_DEFINITIONS[number]['id'];

export const HOMEPAGE_SECTION_IDS = HOMEPAGE_SECTION_DEFINITIONS.map(
  section => section.id,
) as HomepageSectionId[];

const HOMEPAGE_SECTION_ID_SET = new Set<string>(HOMEPAGE_SECTION_IDS);

export const isHomepageSectionId = (value: unknown): value is HomepageSectionId =>
  typeof value === 'string' && HOMEPAGE_SECTION_ID_SET.has(value);

export const normalizeHomepageSections = (
  input: HomepageSectionItem[] | null | undefined,
): HomepageSectionItem[] => {
  const configured = new Map<HomepageSectionId, HomepageSectionItem>();

  if (Array.isArray(input)) {
    [...input]
      .filter(section => section && isHomepageSectionId(section.id))
      .sort((left, right) => {
        const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
        const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      })
      .forEach(section => {
        const id = section.id as HomepageSectionId;
        if (!configured.has(id)) configured.set(id, section);
      });
  }

  const orderedIds: HomepageSectionId[] = configured.size === 0
    ? [...HOMEPAGE_SECTION_IDS]
    : [...configured.keys()];

  // Existing production configurations predate Reader Passes. Put the new
  // high-visibility section directly after the hero instead of silently
  // appending it below the archive.
  if (configured.size > 0 && !configured.has('subscriptions')) {
    const heroIndex = orderedIds.indexOf('hero');
    orderedIds.splice(heroIndex >= 0 ? heroIndex + 1 : 0, 0, 'subscriptions');
  }

  for (const id of HOMEPAGE_SECTION_IDS) {
    if (!orderedIds.includes(id)) orderedIds.push(id);
  }

  return orderedIds.map((id, index) => {
    const definition = HOMEPAGE_SECTION_DEFINITIONS.find(section => section.id === id)!;
    const saved = configured.get(id);
    return {
      id,
      title: definition.title,
      isVisible: saved?.isVisible !== false,
      order: index + 1,
    };
  });
};

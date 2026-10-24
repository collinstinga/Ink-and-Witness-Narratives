import type { AffiliateSettings } from '../../types.js';

/** Persisted summary values are authoritative, but an unsaved editor is not a cache. */
export function resolveAffiliateSettingsDraft(
  currentDraft: AffiliateSettings | null,
  authoritativeSettings: AffiliateSettings,
  dirty: boolean,
): AffiliateSettings {
  return dirty && currentDraft ? currentDraft : authoritativeSettings;
}

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Spark-safe financial dashboard refresh', () => {
  it('does not repeatedly poll whole financial ledgers in the writer or affiliate dashboard', () => {
    for (const [path, guard] of [
      ['./AffiliatesAdminTab.tsx', 'summaryRequestIdRef'],
      ['../affiliate/AffiliateDashboardModal.tsx', 'dashboardRequestIdRef'],
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(source).not.toContain('setInterval(');
      expect(source).toContain(guard);
      expect(source).toContain('Refresh');
    }
  });

  it('uses the single authoritative summary for refreshes and a guarded unsaved settings draft', () => {
    const source = readFileSync(new URL('./AffiliatesAdminTab.tsx', import.meta.url), 'utf8');
    const loadSummary = source.slice(source.indexOf('const loadSummary = async'), source.indexOf('const loadResourceLibrary = async'));
    expect(loadSummary).toContain('await api.getAdminAffiliatesSummary()');
    expect(loadSummary).toContain('setSummary(res)');
    expect(loadSummary).toContain('resolveAffiliateSettingsDraft(current, res.settings, settingsDirtyRef.current)');
    expect(loadSummary).not.toContain('api.getAdminAffiliateSettings(');
    expect(loadSummary).not.toContain('api.getAdminLiteraryCircleSettings(');
    expect(loadSummary).not.toContain('api.getAdminAffiliateCampaigns(');
    expect(loadSummary).not.toContain('current?.settings');
    expect(loadSummary).not.toContain('current?.campaigns');
  });
});

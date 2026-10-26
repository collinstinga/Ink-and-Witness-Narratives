import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./WriterDashboard.tsx', import.meta.url), 'utf8');

describe('WriterDashboard permanent guide integration boundary', () => {
  it('keeps help available in mobile header, desktop header and sidebar', () => {
    for (const id of ['mobile-writer-guide-btn', 'desktop-writer-guide-btn', 'sidebar-writer-guide-btn']) {
      expect(source).toContain(`id="${id}"`);
    }
    expect(source.match(/aria-haspopup="dialog"/g)).toHaveLength(3);
  });

  it('loads help only on demand without replacing the current editor or settings', () => {
    expect(source).toContain("lazy(() => import('./WriterPortalGuide.js')");
    expect(source).toContain('{guideOpen ? (');
    expect(source).toContain('<PortalGuideLoadBoundary onClose={() => setGuideOpen(false)}>');
    expect(source).toContain('<WriterPortalGuide open={guideOpen} onClose={() => setGuideOpen(false)} />');
    expect(source).not.toContain('guideOpen ? <WriterEditor');
    expect(source).not.toContain("setCurrentTab('guide')");
    expect(source).not.toContain('onNavigate={');
    expect(source).toContain('<PortalGuideLoading onClose={() => setGuideOpen(false)} />');
  });

  it('limits guide-open handlers to help state and mobile navigation visibility', () => {
    const helpButtons = [...source.matchAll(/<button\s+id="(?:mobile|desktop|sidebar)-writer-guide-btn"[\s\S]*?<\/button>/g)];
    expect(helpButtons).toHaveLength(3);
    for (const [button] of helpButtons) {
      expect(button).toContain('setGuideOpen(true)');
      expect(button).not.toMatch(/handleSave|api\.|setEditingPiece|handleTabChange|setCurrentTab|onPreviewArticle/);
    }
  });
});

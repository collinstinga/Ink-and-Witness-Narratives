import React from 'react';
import { WRITER_PORTAL_GUIDE } from '../../data/writerPortalGuide.js';
import { PortalGuideDialog } from '../guides/PortalGuideDialog.js';

interface WriterPortalGuideProps {
  open: boolean;
  onClose: () => void;
}

// Deliberately no workspace-navigation callback: local editor/settings drafts
// must stay mounted while the writer reads help or follows the explanatory demo.
export function WriterPortalGuide({ open, onClose }: WriterPortalGuideProps) {
  return <PortalGuideDialog guide={WRITER_PORTAL_GUIDE} open={open} onClose={onClose} />;
}

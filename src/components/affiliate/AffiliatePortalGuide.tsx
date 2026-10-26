import React from 'react';
import { affiliatePortalGuide } from '../../data/affiliatePortalGuide.js';
import { PortalGuideDialog } from '../guides/PortalGuideDialog.js';

interface AffiliatePortalGuideProps {
  open: boolean;
  onClose: () => void;
  onNavigate?: (destination: string) => void;
  navigationNotice?: string;
}

export const AffiliatePortalGuide: React.FC<AffiliatePortalGuideProps> = (props) => (
  <PortalGuideDialog {...props} guide={affiliatePortalGuide} />
);

export default AffiliatePortalGuide;

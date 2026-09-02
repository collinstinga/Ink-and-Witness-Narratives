import React, { useState, useEffect } from 'react';
import { AffiliateAuthModal } from './AffiliateAuthModal.js';
import { AffiliateDashboardModal } from './AffiliateDashboardModal.js';
import { getAffiliateToken, clearAffiliateToken } from '../../utils/api.js';
import { Article, AffiliateAccount } from '../../types.js';

interface AffiliatePortalProps {
  isOpen: boolean;
  onClose: () => void;
  articles: Article[];
}

export const AffiliatePortal: React.FC<AffiliatePortalProps> = ({
  isOpen,
  onClose,
  articles
}) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [affiliate, setAffiliate] = useState<AffiliateAccount | null>(null);

  useEffect(() => {
    if (isOpen) {
      const token = getAffiliateToken();
      setIsAuthenticated(Boolean(token));
    }
  }, [isOpen]);

  const handleAuthSuccess = (loggedAffiliate: AffiliateAccount) => {
    setAffiliate(loggedAffiliate);
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    clearAffiliateToken();
    setAffiliate(null);
    setIsAuthenticated(false);
  };

  if (!isOpen) return null;

  if (isAuthenticated) {
    return (
      <AffiliateDashboardModal
        isOpen={isOpen}
        onClose={onClose}
        articles={articles}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <AffiliateAuthModal
      isOpen={isOpen}
      onClose={onClose}
      onSuccess={handleAuthSuccess}
    />
  );
};

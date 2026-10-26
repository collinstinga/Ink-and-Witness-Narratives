/** Local help content only. Opening a guide must never fetch or mutate account data. */
export interface PortalGuideSection {
  id: string;
  title: string;
  summary: string;
  keywords?: string[];
  steps: string[];
  notes?: string[];
  destination?: string;
  destinationLabel?: string;
}

export interface PortalGuideJourneyStep {
  title: string;
  description: string;
  sectionId: string;
}

export interface PortalGuideDefinition {
  id: string;
  title: string;
  intro: string;
  sections: PortalGuideSection[];
  journey: PortalGuideJourneyStep[];
}

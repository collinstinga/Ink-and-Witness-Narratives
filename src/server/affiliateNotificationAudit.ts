import crypto from 'crypto';

function digest(values: unknown[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 48);
}

/** Stable document references for NEW atomic saves, never historical backfill. */
export function campaignNotificationAuditId(campaignId: string, revision: number): string {
  return `aud_campaign_${digest(['campaign_saved', campaignId, revision])}`;
}

export function literaryCircleNotificationAuditId(revision: number): string {
  return `aud_circle_${digest(['literary_circle_settings_updated', revision])}`;
}

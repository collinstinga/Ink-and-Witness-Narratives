import type { AffiliateCampaign } from '../types.js';

export interface AffiliateCampaignDraft {
  code: string;
  name: string;
  description: string;
  commissionRate: string;
  attributionDays: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  eligiblePieceIds: string[];
}

/** datetime-local displays the writer's device time, not a truncated UTC date. */
export function campaignLocalTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const pad = (number: number, length = 2) => String(number).padStart(length, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

export function createAffiliateCampaignDraft(campaign?: AffiliateCampaign, now = new Date()): AffiliateCampaignDraft {
  return {
    code: campaign?.code || '', name: campaign?.name || '', description: campaign?.description || '',
    commissionRate: String(campaign?.commissionRate ?? 20),
    attributionDays: String(campaign?.attributionDays ?? 30),
    startDate: campaignLocalTime(campaign?.startDate || now.toISOString()),
    endDate: campaignLocalTime(campaign?.endDate || new Date(now.getTime() + 30 * 86_400_000).toISOString()),
    isActive: campaign?.isActive ?? true,
    eligiblePieceIds: [...(campaign?.eligiblePieceIds || [])],
  };
}

export function buildAffiliateCampaignUpdate(draft: AffiliateCampaignDraft, campaign?: AffiliateCampaign):
  Partial<AffiliateCampaign> & { code: string; name: string } {
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_]{0,63}$/.test(code)) throw new Error('Use 1–64 letters, numbers or underscores, starting with a letter or number.');
  const name = draft.name.trim();
  const description = draft.description.trim();
  if (!name || name.length > 120 || description.length > 2_000) throw new Error('Enter a campaign name up to 120 characters and a description up to 2,000 characters.');
  const commissionRate = Number(draft.commissionRate);
  const attributionDays = Number(draft.attributionDays);
  if (!Number.isFinite(commissionRate) || commissionRate <= 0 || commissionRate > 100) throw new Error('Commission must be greater than 0 and no more than 100 percent.');
  if (!Number.isSafeInteger(attributionDays) || attributionDays < 1 || attributionDays > 90) throw new Error('Attribution must be a whole number from 1 to 90 days.');
  const parseLocal = (value: string): Date => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value)) throw new Error('Choose a valid campaign date and time.');
    const date = new Date(value);
    const [year, month, day, hour, minute, second = '0'] = value.split(/[-T:.]/);
    if (date.getFullYear() !== Number(year) || date.getMonth() + 1 !== Number(month) || date.getDate() !== Number(day)
      || date.getHours() !== Number(hour) || date.getMinutes() !== Number(minute) || date.getSeconds() !== Number(second)) {
      throw new Error('Choose a valid campaign date and time.');
    }
    return date;
  };
  const start = parseLocal(draft.startDate);
  const end = parseLocal(draft.endDate);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw new Error('Choose a valid end time later than the start time.');
  // Only editable fields and the optimistic revision cross the network. Never
  // send stale click/revenue/commission totals from the editor back to storage.
  return {
    ...(campaign ? { id: campaign.id, revision: campaign.revision ?? 0 } : {}),
    code, name, description, commissionRate, attributionDays,
    ...(campaign && draft.startDate === campaignLocalTime(campaign.startDate) ? {} : { startDate: start.toISOString() }),
    ...(campaign && draft.endDate === campaignLocalTime(campaign.endDate) ? {} : { endDate: end.toISOString() }),
    isActive: draft.isActive,
    eligiblePieceIds: [...draft.eligiblePieceIds],
  };
}

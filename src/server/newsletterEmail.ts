import type { NewsletterCampaignContent } from '../types.js';

const RESEND_EMAIL_ENDPOINT = 'https://api.resend.com/emails';

export class NewsletterProviderConfigurationError extends Error {
  constructor(message = 'Newsletter email delivery is not configured.') {
    super(message);
    this.name = 'NewsletterProviderConfigurationError';
  }
}

export class NewsletterProviderError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = 'NewsletterProviderError';
    this.status = status;
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeHttpUrl(value: unknown, baseUrl?: string): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const resolved = new URL(value.trim(), baseUrl);
    if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return undefined;
    if (process.env.NODE_ENV === 'production' && resolved.protocol !== 'https:') return undefined;
    return resolved.toString();
  } catch {
    return undefined;
  }
}

function textToParagraphs(value: string): string {
  return value
    .trim()
    .split(/\n{2,}/)
    .filter(Boolean)
    .map(paragraph => `<p style="margin:0 0 18px;line-height:1.75;color:#334155;">${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('');
}

function emailShell(options: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  coverImageUrl?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  unsubscribeUrl?: string;
}): string {
  const cover = options.coverImageUrl
    ? `<img src="${escapeHtml(options.coverImageUrl)}" alt="" width="560" style="display:block;width:100%;max-width:560px;height:auto;border-radius:16px;margin:0 0 28px;" />`
    : '';
  const cta = options.ctaLabel && options.ctaUrl
    ? `<p style="margin:28px 0;"><a href="${escapeHtml(options.ctaUrl)}" style="display:inline-block;background:#0369a1;color:#ffffff;text-decoration:none;font-weight:700;padding:13px 22px;border-radius:10px;">${escapeHtml(options.ctaLabel)}</a></p>`
    : '';
  const unsubscribe = options.unsubscribeUrl
    ? `<p style="margin:26px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">You are receiving this because you subscribed to Ink &amp; Witness updates. <a href="${escapeHtml(options.unsubscribeUrl)}" style="color:#64748b;">Manage or unsubscribe</a>.</p>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(options.heading)}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:Georgia,'Times New Roman',serif;color:#0f172a;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(options.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;"><tr><td style="padding:36px 30px;">
<p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#0369a1;">Ink &amp; Witness Narratives</p>
${cover}<h1 style="margin:0 0 22px;font-size:32px;line-height:1.2;color:#0f172a;">${escapeHtml(options.heading)}</h1>
${options.bodyHtml}${cta}
<p style="margin:32px 0 0;padding-top:22px;border-top:1px solid #e2e8f0;font-style:italic;color:#475569;">Stay close to the ink.</p>
${unsubscribe}
</td></tr></table></td></tr></table></body></html>`;
}

export function isNewsletterProviderConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() &&
    process.env.NEWSLETTER_FROM_EMAIL?.trim()
  );
}

export function buildNewsletterConfirmationEmail(options: {
  name?: string;
  confirmationUrl: string;
}): { subject: string; html: string; text: string } {
  const greeting = options.name ? `Hello ${options.name},` : 'Hello,';
  const body = `${greeting}\n\nPlease confirm that you would like to receive new writing and occasional updates from Ink & Witness. Nothing will be sent until you confirm.`;
  return {
    subject: 'Confirm your Ink & Witness subscription',
    html: emailShell({
      preheader: 'Confirm your subscription to Ink & Witness Narratives.',
      heading: 'One quiet confirmation',
      bodyHtml: textToParagraphs(body),
      ctaLabel: 'Confirm subscription',
      ctaUrl: options.confirmationUrl
    }),
    text: `${body}\n\nConfirm subscription: ${options.confirmationUrl}`
  };
}

export function buildNewsletterCampaignEmail(options: {
  content: NewsletterCampaignContent;
  recipientName?: string;
  baseUrl: string;
  unsubscribeUrl: string;
}): { subject: string; html: string; text: string } {
  const { content } = options;
  const heading = content.heading?.trim() || content.subject.trim();
  const coverImageUrl = safeHttpUrl(content.coverImageUrl, options.baseUrl);
  const ctaUrl = safeHttpUrl(content.ctaUrl, options.baseUrl);
  const unsubscribeUrl = safeHttpUrl(options.unsubscribeUrl, options.baseUrl);
  const greeting = options.recipientName ? `Hello ${options.recipientName},\n\n` : '';
  const bodyText = `${greeting}${content.body.trim()}`;
  const ctaText = ctaUrl && content.ctaLabel ? `\n\n${content.ctaLabel}: ${ctaUrl}` : '';
  return {
    subject: content.subject.trim(),
    html: emailShell({
      preheader: content.preheader?.trim() || content.subject.trim(),
      heading,
      bodyHtml: textToParagraphs(bodyText),
      coverImageUrl,
      ctaLabel: content.ctaLabel?.trim(),
      ctaUrl,
      unsubscribeUrl
    }),
    text: `${bodyText}${ctaText}\n\nUnsubscribe: ${unsubscribeUrl || options.unsubscribeUrl}`
  };
}

export async function sendNewsletterEmail(options: {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  unsubscribeUrl?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ providerMessageId: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.NEWSLETTER_FROM_EMAIL?.trim();
  if (!apiKey || !from) throw new NewsletterProviderConfigurationError();

  const request = options.fetchImpl || fetch;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey.slice(0, 256)
  };
  const emailHeaders: Record<string, string> = {};
  if (options.unsubscribeUrl) emailHeaders['List-Unsubscribe'] = `<${options.unsubscribeUrl}>`;

  let response: Response;
  try {
    response = await request(RESEND_EMAIL_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
        text: options.text,
        reply_to: process.env.NEWSLETTER_REPLY_TO?.trim() || undefined,
        headers: Object.keys(emailHeaders).length ? emailHeaders : undefined
      }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch {
    throw new NewsletterProviderError('The email provider could not be reached.', 503);
  }

  const payload = await response.json().catch(() => ({})) as { id?: string; message?: string };
  if (!response.ok || !payload.id) {
    throw new NewsletterProviderError(
      response.status >= 500 ? 'The email provider is temporarily unavailable.' : (payload.message || 'The email provider rejected the message.'),
      response.status || 502
    );
  }
  return { providerMessageId: payload.id };
}


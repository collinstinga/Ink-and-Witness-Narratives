import type { UserRecord } from '../types.js';
import type { PasswordResetStore } from './passwordResetStore.js';
import { buildReaderPasswordResetEmail, NewsletterProviderConfigurationError, NewsletterProviderError,
  type sendNewsletterEmail } from './newsletterEmail.js';
import { hashPasswordResetToken, PASSWORD_RESET_TOKEN_TTL_MS } from './passwordResetSecurity.js';

/** Explicit pre-send configuration failures and definitive 4xx rejections did
 * not accept this message. Timeouts/5xx/ambiguous idempotency results might have. */
export function readerResetDeliveryDefinitelyRejected(error: unknown): boolean {
  return error instanceof NewsletterProviderConfigurationError || (error instanceof NewsletterProviderError
    && error.status >= 400 && error.status < 500 && ![408, 409, 425].includes(error.status));
}

export async function deliverReaderPasswordResetEmail(input: {
  user: UserRecord;
  baseUrl: string;
  service: Pick<PasswordResetStore, 'issue' | 'discard'>;
  sendEmail: typeof sendNewsletterEmail;
}): Promise<'accepted' | 'unconfirmed'> {
  if (input.user.role !== 'client') throw new Error('Only reader accounts can use this password recovery flow.');
  const issued = await input.service.issue(input.user.id);
  const tokenHash = hashPasswordResetToken(issued.token);
  if (!tokenHash) throw new Error('A secure reader reset capability could not be issued.');
  const url = new URL('/password-reset', input.baseUrl);
  url.searchParams.set('token', issued.token);
  const email = buildReaderPasswordResetEmail({ name: input.user.name, resetUrl: url.toString(),
    expiresInMinutes: PASSWORD_RESET_TOKEN_TTL_MS / 60_000 });
  try {
    await input.sendEmail({ to: input.user.email, ...email, idempotencyKey: `reader-password-reset-${tokenHash}` });
    return 'accepted';
  } catch (error) {
    if (readerResetDeliveryDefinitelyRejected(error)) {
      // A definite rejection must not leave an active, undelivered capability.
      // Propagate cleanup failure rather than claiming that revocation succeeded.
      await input.service.discard(issued.token);
      throw error;
    }
    // A response can time out after acceptance. Keep the one-hour, single-use
    // capability valid if its email arrives. Never resend automatically.
    return 'unconfirmed';
  }
}

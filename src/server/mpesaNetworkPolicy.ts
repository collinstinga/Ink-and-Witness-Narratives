/** Server configuration only; request bodies and saved merchant settings cannot opt in. */
export function mpesaNetworkBlockReason(
  environment: Record<string, string | undefined> = process.env,
): string | null {
  const mode = (environment.MPESA_NETWORK_MODE || '').trim().toLowerCase();
  if (mode && mode !== 'live' && mode !== 'disabled') {
    return 'M-Pesa network mode is invalid. Payments are unavailable.';
  }
  if (mode === 'disabled') {
    return 'M-Pesa network requests are disabled in this environment.';
  }
  const darajaEnvironment = (environment.MPESA_ENV || '').trim().toLowerCase();
  // This integration currently implements the live Daraja protocol only. Never
  // interpret a sandbox label as permission to send to the production endpoint.
  if (darajaEnvironment && darajaEnvironment !== 'production') {
    return 'This M-Pesa integration requires production mode; sandbox requests are disabled.';
  }
  const vercelEnvironment = (environment.VERCEL_ENV || '').trim().toLowerCase();
  if (vercelEnvironment && vercelEnvironment !== 'production' && mode !== 'live') {
    return 'M-Pesa network requests are disabled in preview and development deployments.';
  }
  return null;
}

/** Recheck at each network boundary, including retries and cached-token paths. */
export function assertMpesaNetworkEnabled(): void {
  const reason = mpesaNetworkBlockReason();
  if (reason) throw new Error(reason);
}

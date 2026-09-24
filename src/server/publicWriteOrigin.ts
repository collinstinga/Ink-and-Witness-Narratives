const ALLOWED_FETCH_SITES = new Set(['same-origin', 'same-site', 'none']);

export interface PublicWriteOriginCheck {
  origin?: string | null;
  requestOrigin?: string | null;
  configuredBaseUrl?: string | null;
  fetchSite?: string | null;
  production: boolean;
}

function parseOrigin(value: string | null | undefined): URL | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    // Origin headers never contain credentials, paths, queries, or fragments.
    // Requiring the canonical serialized origin avoids accepting a misleading
    // value that URL() would otherwise reduce to a trusted host.
    if (candidate !== parsed.origin) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseConfiguredOrigin(value: string | null | undefined): URL | null {
  const candidate = value?.trim();
  if (!candidate) return null;

  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function configuredOrigins(configuredBaseUrl: string | null | undefined): Set<string> | null {
  const configured = parseConfiguredOrigin(configuredBaseUrl);
  if (!configured) return null;

  const origins = new Set([configured.origin]);
  const alias = new URL(configured.origin);
  alias.hostname = alias.hostname.startsWith('www.')
    ? alias.hostname.slice(4)
    : `www.${alias.hostname}`;
  origins.add(alias.origin);
  return origins;
}

export function isAllowedPublicWriteOrigin(input: PublicWriteOriginCheck): boolean {
  const origin = parseOrigin(input.origin);
  const requestOrigin = parseConfiguredOrigin(input.requestOrigin);
  if (!origin || !requestOrigin) return false;

  const fetchSite = input.fetchSite?.trim().toLowerCase();
  if (fetchSite && !ALLOWED_FETCH_SITES.has(fetchSite)) return false;

  if (input.production && (origin.protocol !== 'https:' || requestOrigin.protocol !== 'https:')) {
    return false;
  }

  const hasConfiguredBaseUrl = Boolean(input.configuredBaseUrl?.trim());
  const trustedConfiguredOrigins = configuredOrigins(input.configuredBaseUrl);
  if (hasConfiguredBaseUrl && !trustedConfiguredOrigins) return false;
  if (trustedConfiguredOrigins) {
    return trustedConfiguredOrigins.has(origin.origin)
      && trustedConfiguredOrigins.has(requestOrigin.origin);
  }

  return origin.origin === requestOrigin.origin;
}

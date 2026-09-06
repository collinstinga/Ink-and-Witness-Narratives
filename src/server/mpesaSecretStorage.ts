export const MPESA_SECRET_FIELDS = ['consumerKey', 'consumerSecret', 'passkey'] as const;
export const MPESA_SECRET_STORAGE_VERSION = 2;

type EnvironmentLike = Record<string, string | undefined>;

export interface RuntimeMpesaSecrets {
  consumerKey: string;
  consumerSecret: string;
  passkey: string;
}

export function getRuntimeMpesaSecrets(env: EnvironmentLike = process.env): RuntimeMpesaSecrets {
  return {
    consumerKey: (env.MPESA_CONSUMER_KEY || env.MPESA_TILL_CONSUMER_KEY || '').trim(),
    consumerSecret: (env.MPESA_CONSUMER_SECRET || env.MPESA_TILL_SECRET_KEY || '').trim(),
    passkey: (env.MPESA_PASSKEY || env.MPESA_PASSKEY_ || '').trim()
  };
}

export function getStoredMpesaSecrets(value: unknown): RuntimeMpesaSecrets {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { consumerKey: '', consumerSecret: '', passkey: '' };
  }
  const record = value as Record<string, unknown>;
  return {
    consumerKey: typeof record.consumerKey === 'string' ? record.consumerKey.trim() : '',
    consumerSecret: typeof record.consumerSecret === 'string' ? record.consumerSecret.trim() : '',
    passkey: typeof record.passkey === 'string' ? record.passkey.trim() : ''
  };
}

export function hasCompleteMpesaSecretSet(secrets: RuntimeMpesaSecrets): boolean {
  return Boolean(secrets.consumerKey && secrets.consumerSecret && secrets.passkey);
}

export function resolveMpesaSecretSource(
  runtimeSecrets: RuntimeMpesaSecrets,
  legacySecrets: RuntimeMpesaSecrets | null
): {
  secrets: RuntimeMpesaSecrets;
  credentialsEnvironmentManaged: boolean;
  credentialsLegacyFallback: boolean;
} {
  if (hasCompleteMpesaSecretSet(runtimeSecrets)) {
    return {
      secrets: runtimeSecrets,
      credentialsEnvironmentManaged: true,
      credentialsLegacyFallback: false
    };
  }
  if (legacySecrets && hasCompleteMpesaSecretSet(legacySecrets)) {
    return {
      secrets: legacySecrets,
      credentialsEnvironmentManaged: false,
      credentialsLegacyFallback: true
    };
  }
  return {
    secrets: runtimeSecrets,
    credentialsEnvironmentManaged: false,
    credentialsLegacyFallback: false
  };
}

export function hasCompleteRuntimeMpesaSecrets(env: EnvironmentLike = process.env): boolean {
  return hasCompleteMpesaSecretSet(getRuntimeMpesaSecrets(env));
}

export function containsStoredMpesaSecrets(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return MPESA_SECRET_FIELDS.some(field => typeof record[field] === 'string' && record[field] !== '');
}

export function stripStoredMpesaSecrets<T extends Record<string, unknown>>(value: T): Omit<T, typeof MPESA_SECRET_FIELDS[number]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {} as Omit<T, typeof MPESA_SECRET_FIELDS[number]>;
  }
  const safe: Record<string, unknown> = { ...value };
  for (const field of MPESA_SECRET_FIELDS) delete safe[field];
  return safe as Omit<T, typeof MPESA_SECRET_FIELDS[number]>;
}

export function hasUnsafeMpesaSecretUpdate(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return MPESA_SECRET_FIELDS.some(field => {
    if (!Object.prototype.hasOwnProperty.call(record, field)) return false;
    const candidate = record[field];
    return typeof candidate === 'string' && candidate.trim() !== '' && !candidate.includes('••••');
  });
}

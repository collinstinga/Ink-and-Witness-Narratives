const COMPROMISED_HISTORICAL_PASSWORD = 'affiliate123';
const MAX_AFFILIATE_PASSWORD_LENGTH = 256;

export function validateAffiliatePasswordForInput(password: string, label = 'Password'): string | null {
  if (password.length < 8) {
    return `${label} must be at least 8 characters long.`;
  }
  if (password.length > MAX_AFFILIATE_PASSWORD_LENGTH) {
    return `${label} must be 256 characters or fewer.`;
  }
  if (!/[a-zA-Z]/.test(password)) {
    return `${label} must contain at least one letter.`;
  }
  if (!/[0-9!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return `${label} must contain at least one number or special character.`;
  }
  if (password === COMPROMISED_HISTORICAL_PASSWORD) {
    return 'This password is not permitted. Please choose a different password.';
  }
  return null;
}

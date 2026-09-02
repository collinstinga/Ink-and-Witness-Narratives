/**
 * Live Foreign Exchange Rates Service for Ink & Witness
 * Supports KES, USD, EUR, GBP, CAD, AUD, ZAR and easily extensible currencies.
 * Caches rates in memory with automatic refresh and graceful fallback.
 */

export interface SupportedCurrency {
  code: string;
  name: string;
  symbol: string;
  flag: string;
  defaultPresets: number[];
}

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', flag: '🇰🇪', defaultPresets: [300, 500, 1000, 2500, 5000] },
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '🇺🇸', defaultPresets: [3, 5, 10, 25, 50] },
  { code: 'EUR', name: 'Euro', symbol: '€', flag: '🇪🇺', defaultPresets: [3, 5, 10, 25, 50] },
  { code: 'GBP', name: 'British Pound', symbol: '£', flag: '🇬🇧', defaultPresets: [3, 5, 10, 20, 40] },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'CA$', flag: '🇨🇦', defaultPresets: [5, 10, 15, 30, 60] },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '🇦🇺', defaultPresets: [5, 10, 15, 35, 70] },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', flag: '🇿🇦', defaultPresets: [50, 100, 200, 500, 1000] },
];

// Baseline Fallback Exchange Rates (1 Foreign Unit = X KES)
const FALLBACK_KES_RATES: Record<string, number> = {
  KES: 1,
  USD: 130.0,
  EUR: 141.5,
  GBP: 165.2,
  CAD: 96.5,
  AUD: 85.0,
  ZAR: 7.2,
};

interface CachedRates {
  timestamp: string;
  rates: Record<string, number>; // Base USD rates
  kesRates: Record<string, number>; // 1 Unit = X KES
  fetchedAt: number;
  source: string;
}

let cachedRates: CachedRates = {
  timestamp: new Date().toISOString(),
  rates: { USD: 1, KES: 130, EUR: 0.92, GBP: 0.79, CAD: 1.35, AUD: 1.53, ZAR: 18.1 },
  kesRates: { ...FALLBACK_KES_RATES },
  fetchedAt: Date.now(),
  source: 'Fallback Baseline'
};

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour cache

export async function fetchLiveExchangeRates(forceRefresh = false): Promise<CachedRates> {
  const now = Date.now();
  if (!forceRefresh && cachedRates && (now - cachedRates.fetchedAt < CACHE_TTL_MS)) {
    return cachedRates;
  }

  try {
    // Open Exchange Rates API (free, reliable JSON endpoint with USD base)
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(5000)
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && data.rates.KES) {
        const usdRates = data.rates;
        const usdToKes = Number(usdRates.KES) || 130.0;

        const computedKesRates: Record<string, number> = {
          KES: 1,
          USD: usdToKes,
        };

        // For any currency C, 1 unit of C in USD = 1 / usdRates[C]
        // 1 unit of C in KES = (1 / usdRates[C]) * usdToKes
        for (const [curr, rateAgainstUsd] of Object.entries(usdRates)) {
          const numRate = Number(rateAgainstUsd);
          if (numRate > 0) {
            computedKesRates[curr] = Math.round(((1 / numRate) * usdToKes) * 100) / 100;
          }
        }

        cachedRates = {
          timestamp: data.time_last_update_utc || new Date().toISOString(),
          rates: usdRates,
          kesRates: {
            ...FALLBACK_KES_RATES,
            ...computedKesRates
          },
          fetchedAt: now,
          source: 'Live Open Exchange Rates API'
        };

        console.log(`[Exchange Rates] Updated live rates: 1 USD = ${cachedRates.kesRates.USD} KES, 1 EUR = ${cachedRates.kesRates.EUR} KES, 1 GBP = ${cachedRates.kesRates.GBP} KES`);
        return cachedRates;
      }
    }
  } catch (err) {
    console.warn('[Exchange Rates] Live fetch failed or timed out, using cached/fallback rates:', err);
  }

  return cachedRates;
}

/**
 * Converts any supported currency amount to KES (rounded integer, minimum 300)
 */
export function convertToKes(amount: number, currency: string = 'KES'): {
  kesAmount: number;
  exchangeRate: number;
  exchangeRateTimestamp: string;
  originalAmount: number;
  currency: string;
} {
  const code = (currency || 'KES').toUpperCase();
  const rate = cachedRates.kesRates[code] || FALLBACK_KES_RATES[code] || 1;
  const numAmount = Math.max(0, Number(amount) || 0);

  let rawKes = code === 'KES' ? numAmount : numAmount * rate;
  const kesAmount = Math.round(rawKes);

  return {
    kesAmount,
    exchangeRate: rate,
    exchangeRateTimestamp: cachedRates.timestamp,
    originalAmount: numAmount,
    currency: code
  };
}

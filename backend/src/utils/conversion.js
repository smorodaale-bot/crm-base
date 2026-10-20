/** Closed sample below this is not shown as a percent. */
export const CONVERSION_MIN_DEALS = 5;
/** Open deals older than this count in the denominator. */
export const CONVERSION_STALE_DAYS = 14;

export const CONVERSION_FORMULA =
  'выигранные / (выигранные + проигранные + открытые старше 14 дней)';

/**
 * @returns {{ conversion: number|null, conversionLabel: string|null, conversionFormula: string }}
 */
export function conversionRate({ won = 0, lost = 0, staleOpen = 0, totalDeals = 0 }) {
  const sample = won + lost + staleOpen;
  if (totalDeals < CONVERSION_MIN_DEALS || sample <= 0) {
    return {
      conversion: null,
      conversionLabel: 'мало данных',
      conversionFormula: CONVERSION_FORMULA,
    };
  }
  return {
    conversion: Math.round((won / sample) * 100),
    conversionLabel: null,
    conversionFormula: CONVERSION_FORMULA,
  };
}

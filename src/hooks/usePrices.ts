import { useQuery } from '@tanstack/react-query';

/** Wrapped SOL mint — used as the USD/SOL reference. */
export const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** mint -> USD price */
export type PriceMap = Record<string, number>;

async function fetchPricesV3(mints: string[]): Promise<PriceMap | null> {
  const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${mints.join(',')}`);
  if (!res.ok) return null;
  const json = await res.json();
  const out: PriceMap = {};
  for (const mint of mints) {
    const price = json?.[mint]?.usdPrice;
    if (typeof price === 'number' && isFinite(price) && price > 0) out[mint] = price;
  }
  return Object.keys(out).length > 0 ? out : null;
}

async function fetchPricesV2(mints: string[]): Promise<PriceMap | null> {
  const res = await fetch(`https://api.jup.ag/price/v2?ids=${mints.join(',')}`);
  if (!res.ok) return null;
  const json = await res.json();
  const out: PriceMap = {};
  for (const mint of mints) {
    const price = parseFloat(json?.data?.[mint]?.price);
    if (isFinite(price) && price > 0) out[mint] = price;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * USD prices for the given mints via Jupiter's public price API
 * (v3, falling back to v2). Returns `data: null` when unreachable —
 * callers must degrade to SOL-only display in that case.
 */
export const usePrices = (mints: string[]) => {
  const key = [...new Set([SOL_MINT, ...mints])].sort();

  return useQuery({
    queryKey: ['usdPrices', key],
    queryFn: async (): Promise<PriceMap | null> => {
      const v3 = await fetchPricesV3(key).catch(() => null);
      if (v3) return v3;
      return await fetchPricesV2(key).catch(() => null);
    },
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
};

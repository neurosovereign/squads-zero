import { useQuery } from '@tanstack/react-query';
import { getHeliumKey } from './useSettings';
import { fetchAllActivity, type ActivityEvent } from './useActivity';
import type { VaultSnapshot } from './useTreasury';

/**
 * Portfolio value-over-time series for the dashboard hero chart.
 *
 * Method (no backend, gentle on the Helius free tier):
 * 1. Walk the vaults' enhanced-transaction history (bounded) and aggregate
 *    net SOL/token flows per UTC day.
 * 2. End-of-day balances = current balances minus all flows after that day.
 * 3. Daily USD prices from CoinGecko's free API for mappable symbols
 *    (SOL, JitoSOL, PAXG, …); unmapped tokens use their current price.
 * 4. Native stake-account movements are not reconstructed (they don't appear
 *    as vault transfers) — the series tracks liquid + token value.
 */

const CG_BASE = 'https://api.coingecko.com/api/v3/coins';

/** CoinGecko ids by token symbol (symbol beats mint: survives wrapped variants). */
const SYMBOL_TO_CG: Record<string, string> = {
  SOL: 'solana',
  JitoSOL: 'jito-staked-sol',
  mSOL: 'marinade-staked-sol',
  jupSOL: 'jupiter-staked-sol',
  JUP: 'jupiter-exchange-solana',
  BONK: 'bonk',
  RAY: 'raydium',
  bSOL: 'blazestake-staked-sol',
  PAXG: 'pax-gold',
  wBTC: 'bitcoin',
  ETH: 'ethereum',
};
/** Symbols pegged to USD — no price feed needed. */
const USD_STABLES = new Set(['USDC', 'USDT', 'USD1', 'PYUSD']);

export type PortfolioPoint = { t: number; v: number };

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (ts: number): string => new Date(ts).toISOString().slice(0, 10);

type DayFlows = { sol: number; tokens: Map<string, number> }; // net in (positive) / out (negative)

/** Net squad-level flows per UTC day across all vaults. */
const aggregateFlows = (events: ActivityEvent[], vaultSet: Set<string>): Map<string, DayFlows> => {
  const days = new Map<string, DayFlows>();
  const ensure = (k: string): DayFlows => {
    let d = days.get(k);
    if (!d) {
      d = { sol: 0, tokens: new Map() };
      days.set(k, d);
    }
    return d;
  };
  for (const e of events) {
    const v = e.vault;
    if (!vaultSet.has(v)) continue;
    const d = ensure(dayKey(e.timestamp * 1000));
    for (const t of e.nativeTransfers) {
      if (t.to === v) d.sol += t.amount;
      if (t.from === v) d.sol -= t.amount;
    }
    for (const t of e.tokenTransfers) {
      const mint = t.mint ?? '';
      if (!mint) continue;
      const cur = d.tokens.get(mint) ?? 0;
      const next = t.to === v ? cur + t.amount : t.from === v ? cur - t.amount : cur;
      d.tokens.set(mint, next);
    }
  }
  return days;
};

const fetchWithTimeout = async (url: string, timeoutMs = 8000): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch daily USD closes for one CoinGecko id. Returns [] on failure (caller falls back). */
const fetchCgDaily = async (cgId: string): Promise<[number, number][]> => {
  const res = await fetchWithTimeout(
    `${CG_BASE}/${cgId}/market_chart?vs_currency=usd&days=365&interval=daily`
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const json = (await res.json()) as { prices?: [number, number][] };
  return json.prices ?? [];
};

/** Binance daily klines — fallback feed for SOL when CoinGecko is unavailable. */
const fetchSolDailyBinance = async (): Promise<[number, number][]> => {
  const res = await fetchWithTimeout(
    'https://data.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1d&limit=365'
  );
  if (!res.ok) throw new Error(`Binance ${res.status}`);
  const json = (await res.json()) as unknown[][];
  // kline: [openTime, open, high, low, close, ...]
  return json.map((k) => [Number(k[0]), Number(k[4])] as [number, number]);
};

/** Collapse CoinGecko points to the last price per UTC day. */
const toDailyCloses = (points: [number, number][]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const [ts, price] of points) map.set(dayKey(ts), price);
  return map;
};

/** Price of asset on day k: exact close, else the most recent earlier close, else fallback. */
const priceOn = (
  closes: Map<string, number> | null,
  k: string,
  fallback: number | null
): number | null => {
  if (!closes || closes.size === 0) return fallback;
  const exact = closes.get(k);
  if (exact != null) return exact;
  // walk backwards up to 14 days for an earlier close (sparse feeds)
  let t = new Date(k + 'T00:00:00Z').getTime();
  for (let i = 0; i < 14; i++) {
    t -= DAY_MS;
    const p = closes.get(dayKey(t));
    if (p != null) return p;
  }
  return fallback;
};

export type PortfolioHistory = {
  series: PortfolioPoint[];
  /** Assets valued at current (not historical) prices, e.g. no feed available. */
  approximatedSymbols: string[];
};

export const usePortfolioHistory = (
  vaults: VaultSnapshot[],
  solPriceUsd: number | null,
  jupPrices: Record<string, number> | undefined,
  opts: { symbolOf: (mint: string) => string; currentUsdOf: (mint: string) => number | null },
  /** How far back to reconstruct: 30 keeps loading cheap, null = full walk (ALL). */
  windowDays: 30 | null = 30,
  /** Set false to defer the query (e.g. the ALL walk until the tab is selected). */
  enabled = true
) => {
  const apiKey = getHeliumKey();
  const addresses = vaults.map((v) => v.address);
  const ready = enabled && !!apiKey && vaults.length > 0 && solPriceUsd != null;

  return useQuery<PortfolioHistory>({
    queryKey: [
      'portfolioHistory',
      windowDays ?? 'all',
      [...addresses].sort().join(','),
      solPriceUsd ?? 0,
      // Rebuild when holdings change materially
      vaults.map((v) => `${v.lamports}:${(v.tokens ?? []).map((t) => t.uiAmount).join('.')}`).join('|'),
    ],
    queryFn: async () => {
      const events = await fetchAllActivity(addresses, apiKey!);
      const vaultSet = new Set(addresses);
      const flowsByDay = aggregateFlows(events, vaultSet);

      // Current squad-level balances.
      const currentSol = vaults.reduce((s, v) => s + v.lamports / 1e9, 0);
      const currentTokens = new Map<string, number>();
      for (const v of vaults) {
        for (const t of v.tokens ?? []) {
          currentTokens.set(t.mint, (currentTokens.get(t.mint) ?? 0) + t.uiAmount);
        }
      }

      // Price feeds for every mappable symbol that ever appeared.
      const mintsInvolved = new Set<string>(currentTokens.keys());
      for (const d of flowsByDay.values()) for (const m of d.tokens.keys()) mintsInvolved.add(m);

      const approximated = new Set<string>();
      const cgBySymbol = new Map<string, Map<string, number> | null>();
      const wantedCg = new Map<string, string>(); // cgId -> symbol
      for (const mint of mintsInvolved) {
        const sym = opts.symbolOf(mint);
        if (USD_STABLES.has(sym)) continue; // constant $1
        const cgId = SYMBOL_TO_CG[sym];
        if (cgId) wantedCg.set(cgId, sym);
        else approximated.add(sym);
      }
      wantedCg.set('solana', 'SOL');

      // Sequential with a small gap: CoinGecko's anonymous tier rate-limits bursts.
      for (const [cgId, sym] of [...wantedCg.entries()]) {
        try {
          cgBySymbol.set(sym, toDailyCloses(await fetchCgDaily(cgId)));
        } catch {
          if (sym === 'SOL') {
            try {
              cgBySymbol.set(sym, toDailyCloses(await fetchSolDailyBinance()));
            } catch {
              cgBySymbol.set(sym, null);
            }
          } else {
            cgBySymbol.set(sym, null); // falls back to current price
            approximated.add(sym);
          }
        }
        await new Promise((r) => setTimeout(r, 350));
      }

      // Day list: from earliest flow (or the window start) through today.
      const today = dayKey(Date.now());
      const windowStart =
        windowDays !== null ? dayKey(Date.now() - (windowDays - 1) * DAY_MS) : null;
      const allDays = [...flowsByDay.keys()].sort();
      const firstDay =
        windowStart !== null
          ? windowStart
          : (allDays[0] ?? dayKey(Date.now() - 7 * DAY_MS));
      const days: string[] = [];
      for (let t = new Date(firstDay + 'T00:00:00Z').getTime(); dayKey(t) <= today; t += DAY_MS) {
        days.push(dayKey(t));
      }
      if (days[days.length - 1] !== today) days.push(today);

      // Walk backwards from current balances, undoing each day's flows.
      const series: PortfolioPoint[] = [];
      let sol = currentSol;
      const tokens = new Map(currentTokens);
      const valueOf = (k: string): number => {
        let v = sol * (priceOn(cgBySymbol.get('SOL') ?? null, k, solPriceUsd) ?? solPriceUsd!);
        for (const [mint, amount] of tokens) {
          if (amount <= 0) continue;
          const sym = opts.symbolOf(mint);
          const price = USD_STABLES.has(sym)
            ? 1
            : priceOn(cgBySymbol.get(sym) ?? null, k, opts.currentUsdOf(mint));
          if (price != null) v += amount * price;
        }
        return v;
      };
      // Value at end of today = current state (== live dashboard total).
      series.push({ t: new Date(today + 'T00:00:00Z').getTime(), v: valueOf(today) });
      for (let i = days.length - 1; i >= 1; i--) {
        const d = days[i];
        const flows = flowsByDay.get(d);
        if (flows) {
          sol -= flows.sol;
          for (const [mint, amt] of flows.tokens) {
            tokens.set(mint, (tokens.get(mint) ?? 0) - amt);
          }
        }
        series.push({ t: new Date(days[i - 1] + 'T00:00:00Z').getTime(), v: Math.max(0, valueOf(days[i - 1])) });
      }
      series.sort((a, b) => a.t - b.t);

      return { series, approximatedSymbols: [...approximated] };
    },
    enabled: ready,
    staleTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
  });
};

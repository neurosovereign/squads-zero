import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useTreasury, type TokenHolding, type VaultSnapshot } from './useTreasury';
import { usePrices, SOL_MINT } from './usePrices';

/** Same pricing rule as the dashboard hero: DAS-enriched value/price first, then Jupiter. */
const tokenPrice = (t: TokenHolding, jup: Record<string, number> | null): number | null =>
  t.priceUsd ?? jup?.[t.mint] ?? null;

const tokenValueUsd = (t: TokenHolding, jup: Record<string, number> | null): number | null => {
  if (t.valueUsd != null) return t.valueUsd;
  const p = tokenPrice(t, jup);
  return p != null ? p * t.uiAmount : null;
};

const stakedLamports = (vault: VaultSnapshot): number =>
  (vault.stakes ?? []).reduce((sum, s) => sum + s.lamports, 0);

export type TreasuryTotals = {
  /** Liquid SOL across all vaults. */
  liquidSol: number;
  /** Native stake-account SOL (all states). */
  stakedSol: number;
  /** USD value of all SPL token holdings (JitoSOL, PAXG, …). */
  tokensUsd: number;
  /** SOL price used for the total conversion, null when no feed is available. */
  solPriceUsd: number | null;
  /** liquid + staked + tokens converted at the SOL price. */
  totalSolEquivalent: number;
  /** Full USD total — identical to the hero card's big number when priced. */
  totalUsd: number | null;
  loading: boolean;
};

/**
 * Squad-wide totals computed exactly like the dashboard hero card, so the
 * sidebar card and the hero never disagree. Shares the treasury/prices
 * React Query caches — no extra RPC load.
 */
export const useTreasuryTotals = (): TreasuryTotals => {
  const { data: treasury, isLoading } = useTreasury();
  const { data: jupPrices } = usePrices([SOL_MINT]);

  const vaults = treasury?.vaults ?? [];
  const liquidSol = vaults.reduce((s, v) => s + v.lamports, 0) / LAMPORTS_PER_SOL;
  const stakedSol = vaults.reduce((s, v) => s + stakedLamports(v), 0) / LAMPORTS_PER_SOL;
  const tokensUsd = vaults.reduce(
    (sum, v) =>
      sum +
      (v.tokens ?? []).reduce((a, t) => a + (tokenValueUsd(t, jupPrices ?? null) ?? 0), 0),
    0
  );

  const solPriceUsd = treasury?.solPriceUsd ?? jupPrices?.[SOL_MINT] ?? null;
  const totalSolEquivalent =
    solPriceUsd !== null ? liquidSol + stakedSol + tokensUsd / solPriceUsd : liquidSol + stakedSol;
  const totalUsd = solPriceUsd !== null ? totalSolEquivalent * solPriceUsd : null;

  return {
    liquidSol,
    stakedSol,
    tokensUsd,
    solPriceUsd,
    totalSolEquivalent,
    totalUsd,
    loading: isLoading && !treasury,
  };
};

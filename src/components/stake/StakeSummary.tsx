import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useQuery } from '@tanstack/react-query';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useTreasury } from '@/hooks/useTreasury';
import { solPerPoolToken, StakePoolState } from '~/lib/jitoPool';
import { fetchAllPoolStates, LIQUID_POOLS, LiquidPoolProvider } from '~/lib/liquidPools';

/** Mainnet target slot time used for the epoch countdown estimate. */
const SLOT_SECONDS = 0.42;

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Current epoch + rough time remaining, refreshed once a minute. */
export const useEpochCountdown = () => {
  const { connection } = useMultisigData();
  return useQuery({
    queryKey: ['epochInfo', connection.rpcEndpoint],
    queryFn: async () => {
      const info = await connection.getEpochInfo();
      const remainingSlots = Math.max(0, info.slotsInEpoch - info.slotIndex);
      return {
        epoch: info.epoch,
        remainingSeconds: remainingSlots * SLOT_SECONDS,
      };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
};

/** Pool state for every configured liquid staking provider, one RPC call. */
export const useAllPoolStates = () => {
  const { connection } = useMultisigData();
  return useQuery({
    queryKey: ['liquidPoolStates', connection.rpcEndpoint],
    queryFn: () => fetchAllPoolStates(connection),
    staleTime: 5 * 60_000,
  });
};

export type LstPosition = {
  provider: LiquidPoolProvider;
  /** Squad-wide balance of this LST (UI units) across all probed vaults. */
  balance: number;
  poolState: StakePoolState | undefined;
  /** SOL per LST from the pool's on-chain state, null when unavailable. */
  nav: number | null;
  solEquivalent: number | null;
};

/** Squad-wide positions in every supported LST, valued at each pool's NAV. */
export const useLiquidPositions = () => {
  const { data: treasury } = useTreasury();
  const { data: poolStates } = useAllPoolStates();

  const positions: LstPosition[] = LIQUID_POOLS.map((provider) => {
    const balance =
      treasury?.vaults.reduce((sum, vault) => {
        const holding = vault.tokens?.find((t) => t.mint === provider.mint);
        return sum + (holding?.uiAmount ?? 0);
      }, 0) ?? 0;
    const poolState = poolStates?.get(provider.symbol);
    const nav = poolState ? solPerPoolToken(poolState) : null;
    return {
      provider,
      balance,
      poolState,
      nav,
      solEquivalent: nav !== null ? balance * nav : null,
    };
  });

  const totalSol = positions.reduce((sum, p) => sum + (p.solEquivalent ?? 0), 0);
  const held = positions.filter((p) => p.balance > 0);
  return { positions, totalSol, held };
};

const StatBlock = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
  <div className="min-w-0">
    <p className="holo-label">{label}</p>
    <p className="mt-1 truncate font-display text-lg font-semibold">{value}</p>
    {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
  </div>
);

/**
 * Position strip on top of the Stake page: liquid (LST) and validator stake
 * totals plus the epoch countdown. Read-only; all data comes from shared
 * React Query caches (treasury / pool state / epoch info).
 */
const StakeSummary = () => {
  const { data: treasury } = useTreasury();
  const { totalSol, held } = useLiquidPositions();
  const { data: epoch } = useEpochCountdown();

  const stakesKnown = !!treasury && treasury.vaults.every((v) => v.stakes !== null);
  const validatorLamports =
    treasury?.vaults.reduce(
      (sum, v) =>
        sum +
        (v.stakes ?? [])
          .filter((s) => s.state === 'active' || s.state === 'deactivating')
          .reduce((a, s) => a + s.lamports, 0),
      0
    ) ?? 0;

  return (
    <div className="mb-4 grid grid-cols-2 gap-4 rounded-lg border border-primary/15 bg-black/30 p-4 sm:grid-cols-3">
      <StatBlock
        label="Liquid staked"
        value={`${totalSol.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL`}
        sub={
          held.length > 0
            ? held
                .map(
                  (p) =>
                    `${p.balance.toLocaleString(undefined, { maximumFractionDigits: 5 })} ${p.provider.symbol}`
                )
                .join(' · ')
            : 'no LST positions'
        }
      />
      <StatBlock
        label="Validator staked"
        value={
          stakesKnown
            ? `${(validatorLamports / LAMPORTS_PER_SOL).toLocaleString(undefined, {
                maximumFractionDigits: 4,
              })} SOL`
            : '—'
        }
        sub={stakesKnown ? undefined : 'RPC cannot list stake accounts'}
      />
      <StatBlock
        label="Epoch"
        value={epoch ? `${epoch.epoch}` : '…'}
        sub={epoch ? `ends in ~${formatDuration(epoch.remainingSeconds)}` : undefined}
      />
    </div>
  );
};

export default StakeSummary;

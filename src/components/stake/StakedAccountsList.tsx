import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useState } from 'react';
import { toast } from 'sonner';
import { useTreasury } from '@/hooks/useTreasury';
import { useValidators } from '~/hooks/useValidators';
import { truncateAddress } from '@/components/tokenMeta';
import { StakeAccountActions } from '../StakeAccountActions';

const fmtSol = (sol: number): string =>
  sol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const copy = (value: string, label: string) => {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error('Copy failed'));
};

function ValidatorAvatar({ image, seed }: { image: string | null; seed: string }) {
  const [broken, setBroken] = useState(false);
  if (!image || broken) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[9px] text-primary">
        {seed.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={image}
      alt=""
      className="h-8 w-8 shrink-0 rounded-full border border-border/50 object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * "Your stake accounts" — every native stake account owned by any squad vault,
 * enriched with validator name/icon from the StakeWiz directory (address-only
 * fallback when unreachable). Deactivate/withdraw build squad proposals;
 * withdrawn lamports always return to the vault that owns the stake account.
 */
export default function StakedAccountsList() {
  const { data: treasury } = useTreasury();
  const directory = useValidators();

  const allStakes = (treasury?.vaults ?? []).flatMap((vault) =>
    (vault.stakes ?? []).map((stake) => ({ vault, stake }))
  );

  if (allStakes.length === 0) return null;

  return (
    <section>
      <p className="holo-label mb-2">Your stake accounts</p>
      <div className="holo-panel divide-y rounded-lg">
        {allStakes.map(({ vault, stake }) => {
          const validator = stake.voter ? directory.data?.get(stake.voter) : undefined;
          return (
            <div key={stake.address} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <ValidatorAvatar
                  image={validator?.image ?? null}
                  seed={stake.voter ?? stake.address}
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {validator?.name ||
                      (stake.voter ? truncateAddress(stake.voter, 6) : 'Not delegated')}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                    <button
                      onClick={() => copy(stake.address, 'Stake account')}
                      className="transition-colors hover:text-primary"
                      title={`Stake account ${stake.address} — click to copy`}
                    >
                      {truncateAddress(stake.address, 6)}
                    </button>
                    {' · '}Vault #{vault.index}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] ${
                    stake.deactivating
                      ? 'border-warning/40 text-warning'
                      : stake.state === 'active'
                        ? 'border-success/40 text-success'
                        : 'border-border text-muted-foreground'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      stake.deactivating
                        ? 'bg-warning'
                        : stake.state === 'active'
                          ? 'bg-success'
                          : 'bg-muted-foreground/50'
                    }`}
                  />
                  {stake.deactivating ? 'deactivating' : stake.state}
                </span>
                <p className="font-mono text-sm">{fmtSol(stake.lamports / LAMPORTS_PER_SOL)} SOL</p>
                <StakeAccountActions
                  stakeAddress={stake.address}
                  vaultIndex={vault.index}
                  deactivating={stake.deactivating}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Unstaking is two steps: deactivate (takes effect at the next epoch boundary), then withdraw
        — the SOL always returns to the vault that owns the stake account. Both steps create a squad
        proposal; approve and execute them from Transactions.
      </p>
    </section>
  );
}

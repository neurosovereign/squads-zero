import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, PencilLine } from 'lucide-react';
import { useMultisigData } from '~/hooks/useMultisigData';
import { useValidators, ValidatorInfo } from '~/hooks/useValidators';
import { truncateAddress } from '@/components/tokenMeta';
import { cn } from '~/lib/utils';

/** 14 curated validators + the custom card = a clean 5 × 3 grid. */
const TOP_COUNT = 14;

type PickerEntry = {
  voteAccount: string;
  name: string;
  image: string | null;
  apy: number | null;
  commission: number;
  stakeSol: number;
};

/** Rich entry from the StakeWiz directory. */
function toEntry(v: ValidatorInfo): PickerEntry {
  return {
    voteAccount: v.voteIdentity,
    name: v.name,
    image: v.image,
    apy: v.apy,
    commission: v.commission,
    stakeSol: v.activatedStakeSol,
  };
}

function ValidatorIcon({ entry }: { entry: PickerEntry }) {
  const [broken, setBroken] = useState(false);
  if (!entry.image || broken) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] text-primary">
        {entry.voteAccount.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={entry.image}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full border border-border/50 object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export default function ValidatorPicker({
  value,
  onChange,
}: {
  /** Currently selected vote account (empty string = none). */
  value: string;
  onChange: (voteAccount: string) => void;
}) {
  const { connection } = useMultisigData();
  const directory = useValidators();
  const [customOpen, setCustomOpen] = useState(false);

  // Fallback (and sanity) source: the live vote accounts from the RPC itself.
  const rpcValidators = useQuery({
    queryKey: ['vote-accounts'],
    queryFn: async () => {
      const { current } = await connection.getVoteAccounts();
      return current;
    },
    staleTime: 5 * 60_000,
  });

  const curated = useMemo<PickerEntry[]>(() => {
    if (directory.data && directory.data.size > 0) {
      return [...directory.data.values()]
        .filter((v) => !v.delinquent && v.commission < 100 && v.activatedStakeSol > 50_000)
        .sort((a, b) => b.activatedStakeSol - a.activatedStakeSol)
        .slice(0, TOP_COUNT)
        .map(toEntry);
    }
    // Directory unreachable → fall back to plain RPC vote accounts (address-only cards).
    const current = rpcValidators.data ?? [];
    return [...current]
      .filter((v) => v.commission < 100)
      .sort((a, b) => b.activatedStake - a.activatedStake)
      .slice(0, TOP_COUNT)
      .map((v) => ({
        voteAccount: v.votePubkey,
        name: truncateAddress(v.votePubkey, 8),
        image: null,
        apy: null,
        commission: v.commission,
        stakeSol: v.activatedStake / 1e9,
      }));
  }, [directory.data, rpcValidators.data]);

  const isCustom = value !== '' && !curated.some((e) => e.voteAccount === value);
  const showCustomInput = customOpen || isCustom;

  return (
    <div className="space-y-2">
      {directory.isError && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The validator directory (StakeWiz) is currently unreachable, so names, icons and APY
            estimates are unavailable. The cards below fall back to plain vote-account addresses —
            staking still works, double-check the address before proposing.
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {curated.map((entry) => {
          const selected = value === entry.voteAccount;
          return (
            <button
              key={entry.voteAccount}
              type="button"
              onClick={() => onChange(entry.voteAccount)}
              className={cn(
                'group relative rounded-lg border border-border/60 bg-muted/20 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/40',
                selected && 'border-primary bg-primary/10 ring-1 ring-primary'
              )}
            >
              {selected && (
                <span className="absolute right-2 top-2 rounded-full bg-primary p-0.5 text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <div className="flex items-center gap-2.5">
                <ValidatorIcon entry={entry} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{entry.name}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {truncateAddress(entry.voteAccount, 6)}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                {entry.apy !== null && (
                  <span>
                    APY{' '}
                    <span className="font-semibold text-primary">{entry.apy.toFixed(2)}%</span>
                  </span>
                )}
                <span>Fee {entry.commission}%</span>
                <span>{(entry.stakeSol / 1e6).toFixed(1)}M SOL</span>
              </div>
            </button>
          );
        })}

        {/* Custom vote account escape hatch */}
        <button
          type="button"
          onClick={() => setCustomOpen(true)}
          className={cn(
            'rounded-lg border border-dashed border-border/60 bg-muted/10 p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30',
            showCustomInput && 'border-primary/60'
          )}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted/40">
              <PencilLine className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-semibold">Custom validator</p>
              <p className="text-[10px] text-muted-foreground">Paste any vote account address</p>
            </div>
          </div>
        </button>
      </div>

      {showCustomInput && (
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          placeholder="Vote account address (e.g. from solana.com/stake/validators)"
          value={isCustom ? value : ''}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      )}

      {directory.isLoading && (
        <p className="text-xs text-muted-foreground">Loading validator directory…</p>
      )}
    </div>
  );
}

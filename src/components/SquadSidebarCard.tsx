import { Link } from 'react-router-dom';
import { Settings2 } from 'lucide-react';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useTreasuryTotals } from '@/hooks/useTreasuryTotals';
import { truncateAddress } from '@/components/tokenMeta';

/**
 * Persistent squad overview pinned under the sidebar logo: total SOL-equivalent
 * as the big number, full USD value small underneath — computed exactly like
 * the dashboard hero card, so the two always agree. A gear icon appears on
 * hover and opens the combined squad-settings page (threshold, timelock,
 * program management).
 */
const SquadSidebarCard = () => {
  const { multisigAddress } = useMultisigData();
  const totals = useTreasuryTotals();

  if (!multisigAddress) return null;

  return (
    <div className="group relative mx-1 mb-4 rounded-lg border border-primary/15 bg-black/30 px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="holo-label">Squad</p>
        <p className="pr-4 font-mono text-[10px] text-muted-foreground">
          {truncateAddress(multisigAddress)}
        </p>
      </div>
      <p className="solana-gradient-text mt-1 font-display text-xl font-semibold leading-tight">
        {totals.loading
          ? '…'
          : totals.totalSolEquivalent.toLocaleString(undefined, { maximumFractionDigits: 4 })}{' '}
        <span className="text-xs font-normal">SOL</span>
      </p>
      <p className="text-xs text-muted-foreground">
        {totals.totalUsd !== null
          ? `≈ $${totals.totalUsd.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}`
          : '≈ $ —'}
      </p>

      <Link
        to="/squad-settings/"
        title="Squad settings — threshold, timelock, program management"
        className="absolute right-1.5 top-1.5 rounded-md p-1 text-muted-foreground/70 opacity-0 transition-opacity hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Settings2 className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
};

export default SquadSidebarCard;

import { useMemo } from 'react';
import { ArrowDownLeft, ArrowUpRight, RefreshCw, Shuffle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSquadActivity, hasHeliumKey, type ActivityEvent } from '@/hooks/useActivity';
import { useTreasury } from '@/hooks/useTreasury';
import { useExplorerUrl, useRpcUrl } from '@/hooks/useSettings';
import { KNOWN_TOKENS, tokenSymbol, truncateAddress } from './tokenMeta';
import { MemberLabel } from './MemberName';
import { cn } from '@/lib/utils';

const fmtAmount = (n: number): string =>
  n.toLocaleString('en-US', { maximumFractionDigits: n < 1 ? 6 : 4 });

const mintSymbol = (mint?: string): string =>
  mint ? KNOWN_TOKENS[mint]?.symbol ?? tokenSymbol(mint) : 'tokens';

/** Human one-liner for a vault-relative view of an enhanced transaction. */
function summarize(event: ActivityEvent): { direction: 'in' | 'out' | 'mixed'; parts: React.ReactNode[] } {
  const v = event.vault;
  const parts: React.ReactNode[] = [];
  let hasIn = false;
  let hasOut = false;

  const nativeIn = event.nativeTransfers.filter((t) => t.to === v).reduce((s, t) => s + t.amount, 0);
  const nativeOut = event.nativeTransfers.filter((t) => t.from === v).reduce((s, t) => s + t.amount, 0);
  if (nativeIn > 0) {
    hasIn = true;
    const from = event.nativeTransfers.find((t) => t.to === v)?.from ?? '';
    parts.push(
      <span key="nin">
        Received <span className="text-foreground">{fmtAmount(nativeIn)} SOL</span>
        {from && (
          <>
            {' from '}
            <MemberLabel memberKey={from} className="text-muted-foreground" />
          </>
        )}
      </span>
    );
  }
  if (nativeOut > 0) {
    hasOut = true;
    const to = event.nativeTransfers.find((t) => t.from === v)?.to ?? '';
    parts.push(
      <span key="nout">
        Sent <span className="text-foreground">{fmtAmount(nativeOut)} SOL</span>
        {to && (
          <>
            {' to '}
            <MemberLabel memberKey={to} className="text-muted-foreground" />
          </>
        )}
      </span>
    );
  }

  const byMint = new Map<string, { in: number; out: number; to?: string; from?: string }>();
  for (const t of event.tokenTransfers) {
    const e = byMint.get(t.mint ?? '') ?? { in: 0, out: 0 };
    if (t.to === v) {
      e.in += t.amount;
      e.from = e.from ?? t.from;
    }
    if (t.from === v) {
      e.out += t.amount;
      e.to = e.to ?? t.to;
    }
    byMint.set(t.mint ?? '', e);
  }
  for (const [mint, agg] of byMint) {
    const sym = mintSymbol(mint || undefined);
    if (agg.in > 0) {
      hasIn = true;
      parts.push(
        <span key={`tin-${mint}`}>
          Received <span className="text-foreground">{fmtAmount(agg.in)} {sym}</span>
          {agg.from && (
            <>
              {' from '}
              <MemberLabel memberKey={agg.from} className="text-muted-foreground" />
            </>
          )}
        </span>
      );
    }
    if (agg.out > 0) {
      hasOut = true;
      parts.push(
        <span key={`tout-${mint}`}>
          Sent <span className="text-foreground">{fmtAmount(agg.out)} {sym}</span>
          {agg.to && (
            <>
              {' to '}
              <MemberLabel memberKey={agg.to} className="text-muted-foreground" />
            </>
          )}
        </span>
      );
    }
  }

  if (parts.length === 0 && event.description) {
    parts.push(<span key="desc">{event.description}</span>);
  }
  const direction = hasIn && hasOut ? 'mixed' : hasOut ? 'out' : 'in';
  return { direction, parts };
}

function ActivityRow({
  event,
  vaultIndex,
  txUrl,
}: {
  event: ActivityEvent;
  vaultIndex: number | undefined;
  txUrl: string;
}) {
  const { direction, parts } = summarize(event);
  const Icon = direction === 'in' ? ArrowDownLeft : direction === 'out' ? ArrowUpRight : Shuffle;
  return (
    <div className="flex items-center gap-3 p-4">
      <span
        className={cn(
          'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border [&>svg]:h-3.5 [&>svg]:w-3.5',
          event.error
            ? 'border-destructive/30 bg-destructive/10 text-destructive'
            : direction === 'in'
              ? 'border-success/30 bg-success/10 text-success'
              : direction === 'out'
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-primary/25 bg-primary/10 text-primary'
        )}
      >
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-muted-foreground">
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5 text-muted-foreground/40">·</span>}
              {p}
            </span>
          ))}
          {event.error && <span className="ml-2 text-destructive">(failed)</span>}
        </p>
        <p className="mt-0.5 font-mono text-[11px] text-muted-foreground/70">
          {vaultIndex != null && <span className="mr-2 font-display font-semibold text-primary">V{vaultIndex}</span>}
          {new Date(event.timestamp * 1000).toLocaleString()} · {event.type.toLowerCase().replace(/_/g, ' ')}
        </p>
      </div>
      <Link
        to={txUrl}
        target="_blank"
        className="hidden shrink-0 font-mono text-xs text-primary/80 transition-colors hover:text-primary hover:underline sm:block"
        title={event.signature}
      >
        {truncateAddress(event.signature, 5)}
      </Link>
    </div>
  );
}

export function ActivityFeed() {
  const { data: treasury } = useTreasury();
  const { explorerUrl } = useExplorerUrl();
  const { rpcUrl } = useRpcUrl();
  const vaults = treasury?.vaults ?? [];
  const addresses = useMemo(() => vaults.map((v) => v.address), [vaults]);
  const indexByAddress = useMemo(
    () => new Map(vaults.map((v) => [v.address, v.index])),
    [vaults]
  );

  const { data, isLoading, isFetching, isError, hasNextPage, fetchNextPage, refetch } =
    useSquadActivity(addresses);

  const txUrl = (sig: string) =>
    `${explorerUrl}/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl ?? '')}`;

  const events = useMemo(() => {
    const seen = new Set<string>();
    return (data?.pages ?? [])
      .flatMap((p) => p.events)
      .filter((e) => {
        if (seen.has(e.signature + e.vault)) return false;
        seen.add(e.signature + e.vault);
        return true;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [data]);

  if (!hasHeliumKey()) {
    return (
      <div className="holo-panel rounded-lg p-4 text-sm text-muted-foreground">
        Add a Helius API key in <span className="text-foreground">Settings</span> to enable the
        parsed activity feed — transfers in and out of every vault, human-readable.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="holo-panel divide-y rounded-lg">
        {isLoading && (
          <p className="p-6 text-center text-sm text-muted-foreground">Loading activity…</p>
        )}
        {isError && (
          <p className="p-6 text-center text-sm text-destructive">
            Failed to load activity from Helius. Check the API key in Settings.
          </p>
        )}
        {!isLoading && !isError && events.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">No vault activity yet.</p>
        )}
        {events.map((e) => (
          <ActivityRow
            key={e.signature + e.vault}
            event={e}
            vaultIndex={indexByAddress.get(e.vault)}
            txUrl={txUrl(e.signature)}
          />
        ))}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/70">
          Parsed history via Helius · fetched on demand, 10 per vault per page
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-xs text-primary/80 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3 w-3', isFetching && 'animate-spin')} />
            Refresh
          </button>
          {hasNextPage && (
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isFetching}
              className="rounded-md border border-primary/20 bg-primary/[0.06] px-2.5 py-1 text-xs text-primary/80 transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
            >
              {isFetching ? 'Loading…' : 'Load older'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

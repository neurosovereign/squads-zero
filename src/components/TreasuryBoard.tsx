import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Copy, TrendingUp, Wallet, Landmark, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { useTreasury, type VaultSnapshot, type TokenHolding } from '@/hooks/useTreasury';
import { usePrices, SOL_MINT } from '@/hooks/usePrices';
import { KNOWN_TOKENS, tokenSymbol, truncateAddress } from './tokenMeta';
import SendSol from './SendSolButton';
import SendTokens from './SendTokensButton';
import { ReceiveButton } from './ReceiveButton';
import { StakeAccountActions } from './StakeAccountActions';

/** USD price for a token: DAS-enriched value first, then the Jupiter map. */
const tokenPrice = (t: TokenHolding, jup: Record<string, number> | null): number | null =>
  t.priceUsd ?? jup?.[t.mint] ?? null;

const tokenValueUsd = (t: TokenHolding, jup: Record<string, number> | null): number | null => {
  if (t.valueUsd != null) return t.valueUsd;
  const p = tokenPrice(t, jup);
  return p != null ? p * t.uiAmount : null;
};

const displaySymbol = (t: TokenHolding): string =>
  t.symbol || KNOWN_TOKENS[t.mint]?.symbol || tokenSymbol(t.mint);
const displayName = (t: TokenHolding): string | undefined =>
  t.name || KNOWN_TOKENS[t.mint]?.name;

const fmtSol = (sol: number): string =>
  sol.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

const fmtUsd = (usd: number): string =>
  usd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtAmount = (amount: number): string =>
  amount.toLocaleString('en-US', { maximumFractionDigits: amount < 1 ? 6 : 4 });

const copy = (value: string, label: string) => {
  navigator.clipboard
    .writeText(value)
    .then(() => toast.success(`${label} copied`))
    .catch(() => toast.error('Copy failed'));
};

const stakedLamports = (vault: VaultSnapshot): number =>
  (vault.stakes ?? []).reduce((sum, s) => sum + s.lamports, 0);

/** USD value of a vault's token holdings; also returns count of unpriced assets. */
const tokenUsd = (
  vault: VaultSnapshot,
  jup: Record<string, number> | null
): { usd: number; unpriced: number } => {
  let usd = 0;
  let unpriced = 0;
  for (const token of vault.tokens ?? []) {
    const v = tokenValueUsd(token, jup);
    if (v != null) usd += v;
    else unpriced += 1;
  }
  return { usd, unpriced };
};

function StatPanel({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="holo-panel rounded-lg p-4">
      <div className="flex items-center gap-2">
        <span className="text-primary/80 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
        <p className="holo-label">{label}</p>
      </div>
      <p className="font-display mt-3 text-xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {sub && <p className="mt-1 font-mono text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function TreasuryBoard() {
  const { multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const { data: treasury, isLoading, isError } = useTreasury();

  const allMints = (treasury?.vaults ?? []).flatMap((v) => (v.tokens ?? []).map((t) => t.mint));
  const { data: prices } = usePrices(allMints);
  // Prefer the DAS-supplied SOL price; fall back to Jupiter.
  const solUsd = treasury?.solPriceUsd ?? prices?.[SOL_MINT] ?? null;

  if (!multisigAddress) return null;

  const vaults = treasury?.vaults ?? [];
  const liquidSol = vaults.reduce((sum, v) => sum + v.lamports, 0) / LAMPORTS_PER_SOL;
  const stakedSol = vaults.reduce((sum, v) => sum + stakedLamports(v), 0) / LAMPORTS_PER_SOL;
  const stakeCount = vaults.reduce((sum, v) => sum + (v.stakes?.length ?? 0), 0);
  const tokenTotals = vaults.reduce(
    (acc, v) => {
      const { usd, unpriced } = tokenUsd(v, prices ?? null);
      return { usd: acc.usd + usd, unpriced: acc.unpriced + unpriced };
    },
    { usd: 0, unpriced: 0 }
  );
  const nativeSol = liquidSol + stakedSol;
  const totalUsd = solUsd != null ? nativeSol * solUsd + tokenTotals.usd : null;
  const totalSol = solUsd != null && solUsd > 0 ? nativeSol + tokenTotals.usd / solUsd : nativeSol;
  const stakesUnsupported = vaults.some((v) => v.stakes === null);
  const tokensUnsupported = vaults.some((v) => v.tokens === null);

  // Aggregate token holdings across vaults, keeping per-vault attribution.
  type HoldingEntry = {
    rep: TokenHolding;
    mint: string;
    total: number;
    totalUsd: number | null;
    perVault: { vault: VaultSnapshot; token: TokenHolding }[];
  };
  const holdings = new Map<string, HoldingEntry>();
  for (const vault of vaults) {
    for (const token of vault.tokens ?? []) {
      let entry = holdings.get(token.mint);
      if (!entry) {
        entry = { rep: token, mint: token.mint, total: 0, totalUsd: 0, perVault: [] };
        holdings.set(token.mint, entry);
      }
      entry.total += token.uiAmount;
      const v = tokenValueUsd(token, prices ?? null);
      if (v == null) entry.totalUsd = null;
      else if (entry.totalUsd != null) entry.totalUsd += v;
      // keep the richest representative (logo/symbol) for display
      if (!entry.rep.logoUri && token.logoUri) entry.rep = token;
      entry.perVault.push({ vault, token });
    }
  }
  const sortedHoldings = [...holdings.values()].sort((a, b) => {
    const aUsd = a.totalUsd ?? 0;
    const bUsd = b.totalUsd ?? 0;
    return bUsd - aUsd || a.mint.localeCompare(b.mint);
  });

  // Flatten stake accounts for the management section.
  const allStakes = vaults.flatMap((v) =>
    (v.stakes ?? []).map((s) => ({ vault: v, stake: s }))
  );

  return (
    <div className="space-y-6">
      <div>
        <p className="holo-label">Squad Treasury</p>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-2xl font-semibold tracking-tight">Overview</h1>
          <button
            onClick={() => copy(multisigAddress, 'Multisig address')}
            className="group flex items-center gap-1.5 rounded-md border border-primary/15 bg-black/30 px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
            title={multisigAddress}
          >
            {truncateAddress(multisigAddress, 6)}
            <Copy className="h-3 w-3 opacity-50 transition-opacity group-hover:opacity-100" />
          </button>
        </div>
      </div>

      {isError && (
        <div className="holo-panel rounded-lg border-destructive/40 p-4 text-sm text-destructive">
          Failed to load treasury data from the configured RPC. Check Settings → RPC URL.
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="holo-panel h-24 animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatPanel
            icon={<TrendingUp />}
            label="Total Value"
            value={totalUsd != null ? fmtUsd(totalUsd) : `${fmtSol(totalSol)} SOL`}
            sub={totalUsd != null ? `${fmtSol(totalSol)} SOL` : 'USD prices unavailable'}
          />
          <StatPanel
            icon={<Wallet />}
            label="Liquid"
            value={`${fmtSol(liquidSol)} SOL`}
            sub={solUsd != null ? fmtUsd(liquidSol * solUsd) : undefined}
          />
          <StatPanel
            icon={<Landmark />}
            label="Staked"
            value={`${fmtSol(stakedSol)} SOL`}
            sub={
              stakeCount > 0
                ? `${stakeCount} stake account${stakeCount === 1 ? '' : 's'}` +
                  (solUsd != null ? ` · ${fmtUsd(stakedSol * solUsd)}` : '')
                : solUsd != null
                  ? fmtUsd(0)
                  : undefined
            }
          />
          <StatPanel
            icon={<Users />}
            label="Squad"
            value={
              multisigConfig
                ? `${multisigConfig.threshold} of ${multisigConfig.members.length}`
                : '—'
            }
            sub={
              multisigConfig
                ? `threshold · members · tx #${Number(multisigConfig.transactionIndex)}`
                : undefined
            }
          />
        </div>
      )}

      {/* Accounts */}
      <section>
        <p className="holo-label mb-2">Accounts</p>
        <div className="holo-panel overflow-hidden rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-black/30">
              <tr className="border-b">
                <th className="h-10 px-4 text-left font-display text-[11px] font-medium uppercase tracking-[0.15em] text-primary/70">Vault</th>
                <th className="hidden h-10 px-4 text-left font-display text-[11px] font-medium uppercase tracking-[0.15em] text-primary/70 md:table-cell">Address</th>
                <th className="h-10 px-4 text-right font-display text-[11px] font-medium uppercase tracking-[0.15em] text-primary/70">Liquid</th>
                <th className="h-10 px-4 text-right font-display text-[11px] font-medium uppercase tracking-[0.15em] text-primary/70">Staked</th>
                <th className="h-10 px-4 text-right font-display text-[11px] font-medium uppercase tracking-[0.15em] text-primary/70">Value</th>
                <th className="h-10 w-10 px-4" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    Scanning vault accounts…
                  </td>
                </tr>
              )}
              {!isLoading && vaults.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-sm text-muted-foreground">
                    No funded vault accounts found (indices 0–15).
                  </td>
                </tr>
              )}
              {vaults.map((vault) => {
                const liquid = vault.lamports / LAMPORTS_PER_SOL;
                const staked = stakedLamports(vault) / LAMPORTS_PER_SOL;
                const { usd: tokensUsd } = tokenUsd(vault, prices ?? null);
                const vaultUsd =
                  solUsd != null ? (liquid + staked) * solUsd + tokensUsd : null;
                const vaultSol =
                  solUsd != null && solUsd > 0
                    ? liquid + staked + tokensUsd / solUsd
                    : liquid + staked;
                const symbols = [...new Set((vault.tokens ?? []).map((t) => displaySymbol(t)))];
                return (
                  <tr key={vault.address} className="border-b transition-colors last:border-0 hover:bg-primary/[0.04]">
                    <td className="p-4">
                      <span className="inline-flex items-center gap-2">
                        <span className="font-display font-semibold text-primary">V{vault.index}</span>
                        {symbols.length > 0 && (
                          <span className="hidden text-xs text-muted-foreground sm:inline">
                            {symbols.slice(0, 3).join(', ')}
                            {symbols.length > 3 && ` +${symbols.length - 3}`}
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="hidden p-4 md:table-cell">
                      <button
                        onClick={() => copy(vault.address, 'Vault address')}
                        className="group flex items-center gap-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-primary"
                        title={vault.address}
                      >
                        {truncateAddress(vault.address)}
                        <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
                    </td>
                    <td className="p-4 text-right font-mono text-xs">{fmtSol(liquid)}</td>
                    <td className="p-4 text-right font-mono text-xs">
                      {staked > 0 ? (
                        <span className="text-warning">{fmtSol(staked)}</span>
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <span className="block font-mono text-xs">{fmtSol(vaultSol)} SOL</span>
                      <span className="block font-mono text-[11px] text-muted-foreground">
                        {vaultUsd != null ? fmtUsd(vaultUsd) : '—'}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-end gap-1.5">
                        <ReceiveButton address={vault.address} vaultIndex={vault.index} />
                        <SendSol multisigPda={multisigAddress} vaultIndex={vault.index} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {stakesUnsupported && (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              This RPC does not serve stake account queries — staked balances may be incomplete.
            </p>
          )}
        </div>
      </section>

      {/* Holdings */}
      {(sortedHoldings.length > 0 || tokensUnsupported) && (
        <section>
          <p className="holo-label mb-2">Holdings</p>
          <div className="holo-panel divide-y rounded-lg">
            {sortedHoldings.map((holding) => {
              const rep = holding.rep;
              const name = displayName(rep);
              return (
                <div key={holding.mint} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    {rep.logoUri ? (
                      <img
                        src={rep.logoUri}
                        alt={displaySymbol(rep)}
                        className="h-7 w-7 shrink-0 rounded-full border border-primary/20 object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 font-display text-[10px] font-semibold text-primary">
                        {displaySymbol(rep).slice(0, 3)}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold">
                        {displaySymbol(rep)}
                        {name && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">{name}</span>
                        )}
                      </p>
                      <button
                        onClick={() => copy(holding.mint, 'Mint address')}
                        className="mt-0.5 block font-mono text-[11px] text-muted-foreground/70 transition-colors hover:text-primary"
                        title={holding.mint}
                      >
                        {truncateAddress(holding.mint, 6)}
                      </button>
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-mono text-sm">{fmtAmount(holding.total)}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {holding.totalUsd != null ? fmtUsd(holding.totalUsd) : 'unpriced'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {holding.perVault.map(({ vault, token }) => (
                      <span
                        key={token.tokenAccount || token.mint + vault.index}
                        className="inline-flex items-center gap-1.5 rounded-md border border-primary/15 bg-black/30 px-2 py-1 font-mono text-[11px] text-muted-foreground"
                      >
                        <span className="font-display font-semibold text-primary">V{vault.index}</span>
                        {fmtAmount(token.uiAmount)}
                        <SendTokens
                          mint={holding.mint}
                          tokenAccount={token.tokenAccount}
                          decimals={token.decimals}
                          multisigPda={multisigAddress}
                          vaultIndex={vault.index}
                          programId={programId.toBase58()}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {tokensUnsupported && (
              <p className="px-4 py-2 text-xs text-muted-foreground">
                This RPC does not serve token account queries — token balances may be incomplete.
              </p>
            )}
          </div>
          {tokenTotals.unpriced > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {tokenTotals.unpriced} asset{tokenTotals.unpriced === 1 ? '' : 's'} without a USD price
              {totalUsd != null ? ' — excluded from the total value' : ''}.
            </p>
          )}
        </section>
      )}

      {/* Stake accounts */}
      {allStakes.length > 0 && (
        <section>
          <p className="holo-label mb-2">Stake Accounts</p>
          <div className="holo-panel divide-y rounded-lg">
            {allStakes.map(({ vault, stake }) => (
              <div
                key={stake.address}
                className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`status-dot ${
                      stake.deactivating ? 'bg-warning' : stake.state === 'active' ? 'bg-success' : 'bg-muted-foreground/50'
                    }`}
                  />
                  <div className="min-w-0">
                    <button
                      onClick={() => copy(stake.address, 'Stake account')}
                      className="block truncate font-mono text-xs text-foreground transition-colors hover:text-primary"
                      title={stake.address}
                    >
                      {truncateAddress(stake.address, 6)}
                    </button>
                    <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                      V{vault.index} · {stake.deactivating ? 'deactivating' : stake.state}
                      {stake.voter && (
                        <>
                          {' '}· <span title={`Validator ${stake.voter}`}>{truncateAddress(stake.voter, 4)}</span>
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <p className="font-mono text-sm">
                  {fmtSol(stake.lamports / LAMPORTS_PER_SOL)} SOL
                </p>
                <StakeAccountActions
                  stakeAddress={stake.address}
                  vaultIndex={vault.index}
                  deactivating={stake.deactivating}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Deactivate/withdraw create a proposal — approve and execute it from Transactions.
          </p>
        </section>
      )}
    </div>
  );
}

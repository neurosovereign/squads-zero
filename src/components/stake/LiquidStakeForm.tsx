import { useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { useTreasury } from '@/hooks/useTreasury';
import { truncateAddress } from '@/components/tokenMeta';
import { formatTransactionError } from '@/lib/utils';
import { cn } from '~/lib/utils';
import { buildProposalIx } from '~/lib/multisigUtils';
import {
  buildJitoDepositInstructions,
  estimateDeposit,
  formatFeePercent,
  simulateVaultInstructions,
  solPerPoolToken,
} from '~/lib/jitoPool';
import { LIQUID_POOLS, LiquidPoolProvider } from '~/lib/liquidPools';
import { waitForConfirmation } from '@/lib/transactionConfirmation';
import { useAllPoolStates, useEpochCountdown, useLiquidPositions } from './StakeSummary';

/** Parses a decimal SOL string into lamports; null when invalid or <= 0. */
export function parseSolToLamports(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '000000000').slice(0, 9);
  const lamports = BigInt(whole) * BigInt(1000000000) + BigInt(fracPadded);
  return lamports > BigInt(0) ? lamports : null;
}

function formatPoolTokens(amount: bigint): string {
  return (Number(amount) / LAMPORTS_PER_SOL).toLocaleString(undefined, {
    maximumFractionDigits: 9,
  });
}

/** Shared vault picker: dropdown of the squad's active vaults with balances. */
export const VaultSelect = ({
  value,
  onChange,
}: {
  value: number;
  onChange: (index: number) => void;
}) => {
  const { data: treasury } = useTreasury();
  const vaults = treasury?.vaults ?? [];
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(parseInt(v, 10))}>
      <SelectTrigger>
        <SelectValue placeholder="Select a vault" />
      </SelectTrigger>
      <SelectContent>
        {vaults.length === 0 && <SelectItem value="0">Vault #0</SelectItem>}
        {vaults.map((v) => (
          <SelectItem key={v.index} value={String(v.index)}>
            Vault #{v.index} — {truncateAddress(v.address)} (
            {(v.lamports / LAMPORTS_PER_SOL).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}{' '}
            SOL)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

function ProviderLogo({ provider }: { provider: LiquidPoolProvider }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] text-primary">
        {provider.symbol.slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      src={provider.logoUri}
      alt=""
      className="h-10 w-10 shrink-0 rounded-full border border-border/50 object-cover"
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

/**
 * Liquid tab: pick a liquid staking provider (card grid) and deposit vault
 * SOL into its stake pool, receiving the pool's LST at execution-time NAV.
 * Every listed provider was simulation-verified for direct vault deposits;
 * pools on incompatible programs (mSOL, jupSOL, INF) are not offered.
 */
const LiquidStakeForm = () => {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { connection, multisigAddress, programId } = useMultisigData();
  const isMember = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: treasury } = useTreasury();
  const { positions } = useLiquidPositions();
  const { data: poolStates, isError: poolsFailed } = useAllPoolStates();
  const { data: epoch } = useEpochCountdown();

  const [symbol, setSymbol] = useState(LIQUID_POOLS[0].symbol);
  const [vaultIndex, setVaultIndex] = useState(0);
  const [amount, setAmount] = useState('');

  const provider = LIQUID_POOLS.find((p) => p.symbol === symbol) ?? LIQUID_POOLS[0];
  const poolState = poolStates?.get(provider.symbol);
  const position = positions.find((p) => p.provider.symbol === provider.symbol);

  const depositLamports = parseSolToLamports(amount);

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigAddress!),
    index: vaultIndex,
    programId,
  });

  const vault = treasury?.vaults.find((v) => v.index === vaultIndex);
  const vaultSol = vault ? vault.lamports / LAMPORTS_PER_SOL : null;
  // Headroom for the inner ATA rent + execution fees when going all-in.
  const maxDeposit = vaultSol !== null ? Math.max(0, vaultSol - 0.005) : null;

  const poolStale =
    !!poolState && !!epoch && poolState.lastUpdateEpoch < BigInt(epoch.epoch);

  const estimate =
    poolState && depositLamports !== null ? estimateDeposit(poolState, depositLamports) : null;

  const formValid = depositLamports !== null && !!poolState && !poolStale;

  const proposeDeposit = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (!poolState || depositLamports === null) throw 'Invalid amount or pool state unavailable';

    const { instructions } = buildJitoDepositInstructions({
      vaultPubkey: vaultPda,
      lamports: depositLamports,
      poolState,
      stakePoolAddress: new PublicKey(provider.pool),
      stakePoolProgramId: new PublicKey(provider.programId),
    });

    toast.loading('Simulating...', { id: 'transaction', duration: Infinity });
    await simulateVaultInstructions(connection, instructions, vaultPda);

    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      new PublicKey(multisigAddress!)
    );

    const blockhash = (await connection.getLatestBlockhash()).blockhash;

    const depositMessage = new TransactionMessage({
      instructions,
      payerKey: vaultPda,
      recentBlockhash: blockhash,
    });

    const transactionIndex = Number(multisigInfo.transactionIndex) + 1;
    const transactionIndexBN = BigInt(transactionIndex);

    const multisigTransactionIx = multisig.instructions.vaultTransactionCreate({
      multisigPda: new PublicKey(multisigAddress!),
      creator: wallet.publicKey,
      ephemeralSigners: 0,
      transactionMessage: depositMessage,
      transactionIndex: transactionIndexBN,
      addressLookupTableAccounts: [],
      rentPayer: wallet.publicKey,
      vaultIndex,
      programId,
    });
    const proposalIx = buildProposalIx(
      new PublicKey(multisigAddress!),
      wallet.publicKey,
      transactionIndexBN,
      programId
    );

    const message = new TransactionMessage({
      instructions: [multisigTransactionIx, proposalIx],
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(message);

    toast.loading('Waiting for wallet approval...', { id: 'transaction', duration: Infinity });

    const signature = await wallet.sendTransaction(transaction, connection, {
      skipPreflight: true,
    });

    const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
    toast.info(`Sent: ${signature}`, { duration: 6000 });
    toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) {
      throw `Transaction failed or timed out. Check ${signature}`;
    }
    toast.success(`${provider.symbol} deposit proposal created. (${signature})`, {
      id: 'transaction',
    });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stake SOL, receive liquid staking tokens</CardTitle>
        <CardDescription>
          Liquid staking: the vault deposits SOL directly into the selected stake pool (no swap, no
          slippage) and receives its LST at the pool's on-chain NAV. Rewards accrue into the NAV
          automatically. Creates a squad proposal — approve and execute it from the Transactions
          page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {poolsFailed && (
          <p className="text-xs text-red-500">
            Failed to load the stake pool states from this RPC — try again or switch RPC in
            Settings.
          </p>
        )}

        <label className="text-xs text-muted-foreground">Provider</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {LIQUID_POOLS.map((p) => {
            const state = poolStates?.get(p.symbol);
            const selected = p.symbol === provider.symbol;
            return (
              <button
                key={p.symbol}
                type="button"
                onClick={() => setSymbol(p.symbol)}
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
                  <ProviderLogo provider={p} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">{p.symbol}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{p.name}</p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {state ? (
                    <>
                      <span>
                        NAV{' '}
                        <span className="font-semibold text-foreground">
                          {solPerPoolToken(state).toFixed(4)}
                        </span>
                      </span>
                      <span>Fee {formatFeePercent(state.solDepositFee)}</span>
                      <span>
                        {(Number(state.totalLamports) / LAMPORTS_PER_SOL / 1e6).toFixed(2)}M SOL
                      </span>
                    </>
                  ) : (
                    <span>pool state unavailable</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-md border border-primary/15 bg-primary/5 p-3 text-sm">
          Current position:{' '}
          <span className="font-semibold">
            {(position?.balance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 5 })}{' '}
            {provider.symbol}
          </span>
          {position?.solEquivalent != null && (
            <span className="text-muted-foreground">
              {' '}
              ≈ {position.solEquivalent.toLocaleString(undefined, { maximumFractionDigits: 4 })} SOL
            </span>
          )}
          {position?.nav != null && (
            <span className="block text-xs text-muted-foreground">
              Pool NAV: 1 {provider.symbol} ={' '}
              {position.nav.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL
              {poolState ? ` · deposit fee ${formatFeePercent(poolState.solDepositFee)}` : ''}
            </span>
          )}
        </div>

        {poolStale && (
          <p className="text-xs text-yellow-400">
            The pool has not been updated in the current epoch — the on-chain program rejects
            deposits until its balance is updated (crank). Try again later.
          </p>
        )}

        <label className="text-xs text-muted-foreground">From vault</label>
        <VaultSelect value={vaultIndex} onChange={setVaultIndex} />

        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Amount (SOL)</label>
          {maxDeposit !== null && (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setAmount(maxDeposit.toFixed(4))}
            >
              MAX {maxDeposit.toFixed(4)}
            </button>
          )}
        </div>
        <Input placeholder="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {depositLamports === null && amount.length > 0 && (
          <p className="text-xs text-red-500">Invalid amount</p>
        )}

        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          You receive ≈{' '}
          <span className="font-semibold">
            {estimate ? `${formatPoolTokens(estimate.net)} ${provider.symbol}` : '?'}
          </span>
          {estimate && estimate.fee > BigInt(0) && (
            <span className="text-xs text-muted-foreground">
              {' '}
              (deposit fee: {formatPoolTokens(estimate.fee)} {provider.symbol})
            </span>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            The estimate uses the current on-chain pool state; the minted amount is determined at
            execution time and may differ slightly as the pool accrues rewards.
          </p>
        </div>

        <details className="rounded-md border border-border/60 p-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced details
          </summary>
          <div className="mt-2 space-y-1 break-all">
            <p>
              Vault #{vaultIndex} ({vaultPda.toBase58()})
            </p>
            {poolState ? (
              <>
                <p>
                  Pool state last updated: epoch {poolState.lastUpdateEpoch.toString()}
                  {epoch ? ` (current epoch: ${epoch.epoch})` : ''}
                </p>
                <p>Pool account: {provider.pool}</p>
                <p>Pool program: {provider.programId}</p>
                <p>Reserve stake: {poolState.reserveStake.toBase58()}</p>
                <p>Pool mint: {poolState.poolMint.toBase58()}</p>
              </>
            ) : (
              <p>pool state unavailable</p>
            )}
            <p className="text-muted-foreground">
              Instructions: createAssociatedTokenAccountIdempotent (vault {provider.symbol} ATA),
              DepositSol ({provider.name} stake pool)
            </p>
          </div>
        </details>

        {!isMember && (
          <p className="text-xs text-yellow-400">
            Connect a wallet with Initiate permission on this multisig to create the proposal.
          </p>
        )}

        <Button
          onClick={async () => {
            if (!wallet.publicKey) {
              walletModal.setVisible(true);
              return;
            }
            try {
              await proposeDeposit();
            } catch (e) {
              toast.error(`Failed to propose: ${formatTransactionError(e)}`, {
                id: 'transaction',
              });
            }
          }}
          disabled={!formValid || !isMember}
        >
          Simulate &amp; create deposit proposal
        </Button>
      </CardContent>
    </Card>
  );
};

export default LiquidStakeForm;

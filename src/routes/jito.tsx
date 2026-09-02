import { Suspense, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { LAMPORTS_PER_SOL, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { formatTransactionError } from '@/lib/utils';
import { buildProposalIx } from '~/lib/multisigUtils';
import {
  buildJitoDepositInstructions,
  estimateDeposit,
  fetchStakePool,
  formatFeePercent,
  simulateVaultInstructions,
  solPerPoolToken,
} from '~/lib/jitoPool';
import { waitForConfirmation } from '../lib/transactionConfirmation';

/** Parses a decimal SOL string into lamports; null when invalid or <= 0. */
function parseSolToLamports(value: string): bigint | null {
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

const JitoPage = () => {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { connection, multisigAddress, programId } = useMultisigData();
  const isMember = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [vaultIndex, setVaultIndex] = useState('0');
  const [amount, setAmount] = useState('');

  const parsedVaultIndex = /^\d+$/.test(vaultIndex.trim()) ? parseInt(vaultIndex.trim(), 10) : NaN;
  const vaultIndexValid = !isNaN(parsedVaultIndex) && parsedVaultIndex >= 0 && parsedVaultIndex <= 255;
  const depositLamports = parseSolToLamports(amount);

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigAddress!),
    index: vaultIndexValid ? parsedVaultIndex : 0,
    programId,
  });

  const {
    data: poolState,
    error: poolError,
    isFetching: poolFetching,
  } = useQuery({
    queryKey: ['jitoStakePool', connection.rpcEndpoint],
    queryFn: () => fetchStakePool(connection),
  });

  const { data: epochInfo } = useQuery({
    queryKey: ['epochInfo', connection.rpcEndpoint],
    queryFn: () => connection.getEpochInfo(),
  });

  const poolStale =
    !!poolState && !!epochInfo && poolState.lastUpdateEpoch < BigInt(epochInfo.epoch);

  const estimate =
    poolState && depositLamports !== null ? estimateDeposit(poolState, depositLamports) : null;

  const formValid = vaultIndexValid && depositLamports !== null && !!poolState && !poolStale;

  const proposeDeposit = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (!poolState || depositLamports === null) throw 'Invalid amount or pool state unavailable';

    const { instructions } = buildJitoDepositInstructions({
      vaultPubkey: vaultPda,
      lamports: depositLamports,
      poolState,
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
      vaultIndex: parsedVaultIndex,
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
    toast.success(`JitoSOL deposit proposal created. (${signature})`, { id: 'transaction' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div className="max-w-2xl">
          <h1 className="mb-4 text-3xl font-bold">Deposit into JitoSOL</h1>
          <Card>
            <CardHeader>
              <CardTitle>Convert vault SOL into JitoSOL</CardTitle>
              <CardDescription>
                Creates a proposal for a vault transaction that deposits SOL directly into the Jito
                stake pool (no swap, no quote, no slippage) and receives JitoSOL at the pool's
                on-chain NAV at execution time. Approve and execute it from the Transactions page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {poolError && (
                <p className="text-xs text-red-500">
                  Failed to load the Jito stake pool state: {formatTransactionError(poolError)}
                </p>
              )}

              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <p className="mb-1 font-semibold">Pool (read from on-chain state):</p>
                {poolState ? (
                  <>
                    <p>
                      Pool NAV:{' '}
                      {solPerPoolToken(poolState).toLocaleString(undefined, {
                        maximumFractionDigits: 9,
                      })}{' '}
                      SOL per JitoSOL
                    </p>
                    <p>SOL deposit fee: {formatFeePercent(poolState.solDepositFee)}</p>
                    <p>
                      Pool state last updated: epoch {poolState.lastUpdateEpoch.toString()}
                      {epochInfo ? ` (current epoch: ${epochInfo.epoch})` : ''}
                    </p>
                    <p className="break-all">Reserve stake: {poolState.reserveStake.toBase58()}</p>
                    <p className="break-all">Pool mint: {poolState.poolMint.toBase58()}</p>
                  </>
                ) : (
                  <p>{poolFetching ? 'loading...' : 'unavailable'}</p>
                )}
              </div>

              {poolStale && (
                <p className="text-xs text-yellow-400">
                  The pool has not been updated in the current epoch — the on-chain program rejects
                  deposits until its balance is updated (crank). Try again later.
                </p>
              )}

              <label className="text-xs text-muted-foreground">Vault index</label>
              <Input
                type="number"
                value={vaultIndex}
                onChange={(e) => setVaultIndex(e.target.value)}
              />
              {!vaultIndexValid && <p className="text-xs text-red-500">Vault index must be 0-255</p>}

              <label className="text-xs text-muted-foreground">Amount (SOL)</label>
              <Input placeholder="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {depositLamports === null && amount.length > 0 && (
                <p className="text-xs text-red-500">Invalid amount</p>
              )}

              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <p className="mb-1 font-semibold">Proposal contents:</p>
                <p>
                  Vault #{vaultIndexValid ? parsedVaultIndex : '?'} ({vaultPda.toBase58()})
                </p>
                <p>Deposit: {depositLamports !== null ? `${amount} SOL` : '?'}</p>
                <p>
                  Estimated JitoSOL to receive:{' '}
                  {estimate ? `${formatPoolTokens(estimate.net)} JitoSOL` : '?'}
                  {estimate && estimate.fee > BigInt(0)
                    ? ` (deposit fee: ${formatPoolTokens(estimate.fee)} JitoSOL)`
                    : ''}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Instructions: createAssociatedTokenAccountIdempotent (vault JitoSOL ATA), DepositSol
                  (Jito stake pool)
                </p>
                <p className="mt-1 text-muted-foreground">
                  The estimate uses the current on-chain pool state; the minted amount is determined
                  at execution time and may differ slightly as the pool accrues rewards.
                </p>
              </div>

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
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default JitoPage;

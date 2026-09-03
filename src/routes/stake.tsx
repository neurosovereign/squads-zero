import { Suspense, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { isPublickey } from '~/lib/isPublickey';
import { formatTransactionError } from '@/lib/utils';
import { buildProposalIx } from '~/lib/multisigUtils';
import { buildStakeInstructions, STAKE_ACCOUNT_SPACE } from '~/lib/staking';
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

function defaultSeed(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `stake-${y}${m}${day}`;
}

const StakePage = () => {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { connection, multisigAddress, programId } = useMultisigData();
  const isMember = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [vaultIndex, setVaultIndex] = useState('0');
  const [amount, setAmount] = useState('');
  const [voteAccount, setVoteAccount] = useState('');
  const [seed, setSeed] = useState(defaultSeed());

  const parsedVaultIndex = /^\d+$/.test(vaultIndex.trim()) ? parseInt(vaultIndex.trim(), 10) : NaN;
  const vaultIndexValid = !isNaN(parsedVaultIndex) && parsedVaultIndex >= 0 && parsedVaultIndex <= 255;
  const stakeLamports = parseSolToLamports(amount);
  const voteValid = isPublickey(voteAccount.trim());
  const seedValid = seed.length > 0 && seed.length <= 32;

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigAddress!),
    index: vaultIndexValid ? parsedVaultIndex : 0,
    programId,
  });

  const { data: rentExemptMinimum } = useQuery({
    queryKey: ['stakeRent', connection.rpcEndpoint],
    queryFn: () => connection.getMinimumBalanceForRentExemption(STAKE_ACCOUNT_SPACE),
  });

  const { data: stakeAddress } = useQuery({
    queryKey: ['stakeAddress', vaultPda.toBase58(), seed],
    queryFn: () => PublicKey.createWithSeed(vaultPda, seed, StakeProgram.programId),
    enabled: seedValid,
  });

  const formValid =
    vaultIndexValid && stakeLamports !== null && voteValid && seedValid && rentExemptMinimum != null;

  const proposeStake = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (stakeLamports === null || rentExemptMinimum == null) throw 'Invalid amount';

    const totalLamports = Number(stakeLamports) + rentExemptMinimum;

    const { instructions } = await buildStakeInstructions({
      vaultPubkey: vaultPda,
      seed,
      lamports: totalLamports,
      votePubkey: new PublicKey(voteAccount.trim()),
    });

    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      new PublicKey(multisigAddress!)
    );

    const blockhash = (await connection.getLatestBlockhash()).blockhash;

    const stakeMessage = new TransactionMessage({
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
      transactionMessage: stakeMessage,
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
    toast.success(`Stake proposal created. (${signature})`, { id: 'transaction' });
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
          <h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Stake SOL</h1>
          <Card>
            <CardHeader>
              <CardTitle>Delegate vault SOL to a validator</CardTitle>
              <CardDescription>
                Creates a proposal for a vault transaction that creates a stake account (owned and
                authorized by the vault), initializes it and delegates it to a validator vote
                account. Approve and execute it from the Transactions page. Find validator vote
                accounts on public lists such as{' '}
                <a
                  className="underline"
                  href="https://solana.com/stake/validators"
                  target="_blank"
                  rel="noreferrer"
                >
                  solana.com/stake/validators
                </a>{' '}
                or validators.app.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-xs text-muted-foreground">Vault index</label>
              <Input
                type="number"
                value={vaultIndex}
                onChange={(e) => setVaultIndex(e.target.value)}
              />
              {!vaultIndexValid && <p className="text-xs text-red-500">Vault index must be 0-255</p>}

              <label className="text-xs text-muted-foreground">Amount (SOL)</label>
              <Input placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {stakeLamports === null && amount.length > 0 && (
                <p className="text-xs text-red-500">Invalid amount</p>
              )}

              <label className="text-xs text-muted-foreground">Validator vote account</label>
              <Input
                placeholder="Vote account address"
                value={voteAccount}
                onChange={(e) => setVoteAccount(e.target.value)}
              />
              {!voteValid && voteAccount.length > 0 && (
                <p className="text-xs text-red-500">Invalid vote account address</p>
              )}

              <label className="text-xs text-muted-foreground">
                Stake account seed (max 32 chars — the account is derived from vault + seed)
              </label>
              <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
              {!seedValid && <p className="text-xs text-red-500">Seed must be 1-32 characters</p>}

              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <p className="mb-1 font-semibold">Proposal contents:</p>
                <p>
                  Vault #{vaultIndexValid ? parsedVaultIndex : '?'} ({vaultPda.toBase58()})
                </p>
                <p>Stake account: {stakeAddress ? stakeAddress.toBase58() : '(enter a seed)'}</p>
                <p>Stake amount: {stakeLamports !== null ? `${amount} SOL` : '?'}</p>
                <p>
                  Rent-exempt reserve:{' '}
                  {rentExemptMinimum != null
                    ? `${(rentExemptMinimum / LAMPORTS_PER_SOL).toFixed(6)} SOL`
                    : 'loading...'}
                </p>
                <p>
                  Total out of vault:{' '}
                  {stakeLamports !== null && rentExemptMinimum != null
                    ? `${((Number(stakeLamports) + rentExemptMinimum) / LAMPORTS_PER_SOL).toFixed(9)} SOL`
                    : '?'}
                </p>
                <p>Delegate to: {voteValid ? voteAccount.trim() : '(enter a vote account)'}</p>
                <p>Staker / withdrawer authority: {vaultPda.toBase58()} (the vault)</p>
                <p className="mt-1 text-muted-foreground">
                  Instructions: SystemProgram.createAccountWithSeed, StakeProgram.initialize,
                  StakeProgram.delegate
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
                    await proposeStake();
                  } catch (e) {
                    toast.error(`Failed to propose: ${formatTransactionError(e)}`, {
                      id: 'transaction',
                    });
                  }
                }}
                disabled={!formValid || !isMember}
              >
                Create stake proposal
              </Button>
            </CardContent>
          </Card>
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default StakePage;

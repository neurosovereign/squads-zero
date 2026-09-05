import { useState } from 'react';
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
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { isPublickey } from '~/lib/isPublickey';
import { formatTransactionError } from '@/lib/utils';
import { buildProposalIx } from '~/lib/multisigUtils';
import { buildStakeInstructions, STAKE_ACCOUNT_SPACE } from '~/lib/staking';
import { waitForConfirmation } from '@/lib/transactionConfirmation';
import { parseSolToLamports, VaultSelect } from './LiquidStakeForm';
import ValidatorPicker from './ValidatorPicker';

function defaultSeed(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `stake-${y}${m}${day}`;
}

/**
 * Validator tab: classic native staking — creates a stake account owned by the
 * vault and delegates it to a validator vote account. The proposal flow is
 * identical to the old Stake page; the form got a live validator dropdown and
 * hides the seed/rent mechanics behind Advanced details.
 */
const ValidatorStakeForm = () => {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { connection, multisigAddress, programId } = useMultisigData();
  const isMember = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [vaultIndex, setVaultIndex] = useState(0);
  const [amount, setAmount] = useState('');
  const [voteAccount, setVoteAccount] = useState('');
  const [seed, setSeed] = useState(defaultSeed());

  const stakeLamports = parseSolToLamports(amount);
  const voteValid = isPublickey(voteAccount);
  const seedValid = seed.length > 0 && seed.length <= 32;

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigAddress!),
    index: vaultIndex,
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

  const formValid = stakeLamports !== null && voteValid && seedValid && rentExemptMinimum != null;

  const proposeStake = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (stakeLamports === null || rentExemptMinimum == null) throw 'Invalid amount';

    const totalLamports = Number(stakeLamports) + rentExemptMinimum;

    const { instructions } = await buildStakeInstructions({
      vaultPubkey: vaultPda,
      seed,
      lamports: totalLamports,
      votePubkey: new PublicKey(voteAccount),
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
    toast.success(`Stake proposal created. (${signature})`, { id: 'transaction' });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Delegate vault SOL to a validator</CardTitle>
        <CardDescription>
          Classic staking: creates a stake account owned and authorized by the vault and delegates
          it to a validator. Rewards accrue to the vault; unstaking takes effect at the next epoch.
          Creates a squad proposal — approve and execute it from the Transactions page.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="text-xs text-muted-foreground">Validator</label>
        <ValidatorPicker value={voteAccount} onChange={setVoteAccount} />
        {!voteValid && voteAccount.length > 0 && (
          <p className="text-xs text-red-500">Invalid vote account address</p>
        )}

        <label className="text-xs text-muted-foreground">From vault</label>
        <VaultSelect value={vaultIndex} onChange={setVaultIndex} />

        <label className="text-xs text-muted-foreground">Amount (SOL)</label>
        <Input placeholder="1.0" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {stakeLamports === null && amount.length > 0 && (
          <p className="text-xs text-red-500">Invalid amount</p>
        )}

        <details className="rounded-md border border-border/60 p-3 text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
            Advanced details
          </summary>
          <div className="mt-2 space-y-2">
            <label className="text-muted-foreground">
              Stake account seed (max 32 chars — the account is derived from vault + seed)
            </label>
            <Input value={seed} onChange={(e) => setSeed(e.target.value)} />
            {!seedValid && <p className="text-red-500">Seed must be 1-32 characters</p>}
            <div className="space-y-1 break-all">
              <p>
                Vault #{vaultIndex} ({vaultPda.toBase58()})
              </p>
              <p>Stake account: {stakeAddress ? stakeAddress.toBase58() : '(enter a seed)'}</p>
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
              <p>Staker / withdrawer authority: {vaultPda.toBase58()} (the vault)</p>
              <p className="text-muted-foreground">
                Instructions: SystemProgram.createAccountWithSeed, StakeProgram.initialize,
                StakeProgram.delegate
              </p>
            </div>
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
  );
};

export default ValidatorStakeForm;

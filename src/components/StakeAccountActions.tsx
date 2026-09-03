import { useState } from 'react';
import * as multisig from '@sqds/multisig';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  StakeProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, Undo2 } from 'lucide-react';
import { Button } from './ui/button';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useAccess } from '@/hooks/useAccess';
import { buildProposalIx } from '~/lib/multisigUtils';
import { formatTransactionError } from '@/lib/utils';
import { waitForConfirmation } from '~/lib/transactionConfirmation';

type Action = 'deactivate' | 'withdraw';

/**
 * Proposes a vault transaction that deactivates or withdraws a native stake
 * account owned by the given vault. Read-only until approved/executed from the
 * Transactions page — this only creates the proposal, like the Stake page.
 */
export function StakeAccountActions({
  stakeAddress,
  vaultIndex,
  deactivating,
}: {
  stakeAddress: string;
  vaultIndex: number;
  deactivating: boolean;
}) {
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const { connection, multisigAddress, programId, multisigVault } = useMultisigData();
  const isMember = useAccess();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<Action | null>(null);

  const propose = async (action: Action) => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (!multisigAddress || !multisigVault) throw 'No multisig loaded';

    const stakePubkey = new PublicKey(stakeAddress);
    const instructions =
      action === 'deactivate'
        ? StakeProgram.deactivate({ stakePubkey, authorizedPubkey: multisigVault }).instructions
        : StakeProgram.withdraw({
            stakePubkey,
            authorizedPubkey: multisigVault,
            toPubkey: multisigVault,
            lamports: await connection.getBalance(stakePubkey),
          }).instructions;

    const multisigInfo = await multisig.accounts.Multisig.fromAccountAddress(
      connection,
      new PublicKey(multisigAddress)
    );
    const blockhash = (await connection.getLatestBlockhash()).blockhash;
    const txMessage = new TransactionMessage({
      instructions,
      payerKey: multisigVault,
      recentBlockhash: blockhash,
    });
    const transactionIndex = BigInt(Number(multisigInfo.transactionIndex) + 1);

    const multisigTransactionIx = multisig.instructions.vaultTransactionCreate({
      multisigPda: new PublicKey(multisigAddress),
      creator: wallet.publicKey,
      ephemeralSigners: 0,
      transactionMessage: txMessage,
      transactionIndex,
      addressLookupTableAccounts: [],
      rentPayer: wallet.publicKey,
      vaultIndex,
      programId,
    });
    const proposalIx = buildProposalIx(
      new PublicKey(multisigAddress),
      wallet.publicKey,
      transactionIndex,
      programId
    );

    const message = new TransactionMessage({
      instructions: [multisigTransactionIx, proposalIx],
      payerKey: wallet.publicKey,
      recentBlockhash: blockhash,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);

    toast.loading('Waiting for wallet approval...', { id: 'stake-action', duration: Infinity });
    const signature = await wallet.sendTransaction(transaction, connection, {
      skipPreflight: true,
    });
    toast.info(`Confirming: ${signature.slice(0, 8)}…`, { id: 'stake-action', duration: Infinity });
    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) throw `Transaction failed or timed out. Check ${signature}`;
    toast.success(
      `${action === 'deactivate' ? 'Deactivate' : 'Withdraw'} proposal created.`,
      { id: 'stake-action' }
    );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['treasury'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  const run = (action: Action) => {
    if (!wallet.publicKey) {
      walletModal.setVisible(true);
      return;
    }
    setBusy(action);
    toast.promise(
      propose(action).finally(() => setBusy(null)),
      {
        loading: `Building ${action} proposal…`,
        success: 'Proposal created.',
        error: (e) => `Failed: ${formatTransactionError(e)}`,
      }
    );
  };

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-warning hover:bg-warning/10"
        disabled={!isMember || busy !== null || deactivating}
        title={deactivating ? 'Already deactivating' : 'Propose deactivate'}
        onClick={() => run('deactivate')}
      >
        <Ban className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-primary hover:bg-primary/10"
        disabled={!isMember || busy !== null || !deactivating}
        title={deactivating ? 'Propose withdraw (after cooldown)' : 'Withdraw available after deactivation'}
        onClick={() => run('withdraw')}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
    </span>
  );
}

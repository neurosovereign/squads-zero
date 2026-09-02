import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Button } from './ui/button';
import { formatTransactionError } from '@/lib/utils';
import { useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { toast } from 'sonner';
import { useMultisigData } from '~/hooks/useMultisigData';
import { useMultisig } from '~/hooks/useServices';
import { useQueryClient } from '@tanstack/react-query';
import { waitForConfirmation } from '../lib/transactionConfirmation';
import {
  buildRemoveLimitTx,
  formatLastReset,
  formatLimitAmount,
  formatPeriod,
  isNativeMint,
  simulateTx,
} from '~/lib/spendingLimits';

type RemoveLimitProps = {
  multisigPda: string;
  limit: PublicKey;
  account: multisig.accounts.SpendingLimit;
  disabled: boolean;
};

const RemoveLimitButton = ({ multisigPda, limit, account, disabled }: RemoveLimitProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeDialog = () => setIsOpen(false);
  const wallet = useWallet();
  const { connection, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const queryClient = useQueryClient();

  const native = isNativeMint(account.mint);
  const rentCollector = multisigConfig?.rentCollector ?? null;

  const removeLimit = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (!rentCollector) throw 'This multisig has no rent collector configured';

    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const transaction = buildRemoveLimitTx({
      multisigPda: new PublicKey(multisigPda),
      configAuthority: wallet.publicKey,
      spendingLimit: limit,
      rentCollector,
      recentBlockhash,
      programId,
    });

    toast.loading('Simulating...', { id: 'transaction', duration: Infinity });
    await simulateTx(connection, transaction);

    toast.loading('Waiting for wallet approval...', { id: 'transaction', duration: Infinity });
    const signature = await wallet.sendTransaction(transaction, connection, {
      skipPreflight: false,
    });

    const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
    toast.info(`Sent: ${signature}`, { duration: 6000 });
    toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) {
      throw `Transaction failed or timed out. Check ${signature}`;
    }
    toast.success(`Spending limit removed: ${limit.toBase58()}`, { id: 'transaction' });
    closeDialog();
    await queryClient.invalidateQueries({ queryKey: ['spendingLimits'] });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="sm" disabled={disabled} onClick={() => setIsOpen(true)}>
          Remove
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove spending limit</DialogTitle>
          <DialogDescription>
            Signed directly by the config authority — no proposal. The limit account is closed and
            its rent returned to the multisig's rent collector. Simulate runs before the wallet
            prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-md border bg-muted/40 p-3 text-xs">
          <p className="mb-1 font-semibold">You will sign:</p>
          <p>RemoveSpendingLimit on multisig {multisigPda}</p>
          <p>Limit: {limit.toBase58()}</p>
          <p>Vault: #{account.vaultIndex}</p>
          <p>Mint: {native ? 'SOL (native)' : account.mint.toBase58()}</p>
          <p>
            Amount: {formatLimitAmount(BigInt(account.amount.toString()), native)} /{' '}
            {formatPeriod(Number(account.period))}
          </p>
          <p>
            Remaining: {formatLimitAmount(BigInt(account.remainingAmount.toString()), native)} (last
            reset: {formatLastReset(BigInt(account.lastReset.toString()))})
          </p>
          <p>Members: {account.members.map((m) => m.toBase58()).join(', ') || '(none)'}</p>
          <p>
            Destinations:{' '}
            {account.destinations.length > 0
              ? account.destinations.map((d) => d.toBase58()).join(', ')
              : 'ANY ADDRESS'}
          </p>
          <p>Rent collector: {rentCollector ? rentCollector.toBase58() : '(not configured)'}</p>
        </div>

        <Button
          variant="destructive"
          onClick={async () => {
            try {
              await removeLimit();
            } catch (e) {
              toast.error(`Failed to remove limit: ${formatTransactionError(e)}`, {
                id: 'transaction',
              });
            }
          }}
          disabled={!wallet.publicKey || !rentCollector}
        >
          Simulate &amp; remove
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default RemoveLimitButton;

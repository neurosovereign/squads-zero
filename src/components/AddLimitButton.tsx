import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '~/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { formatTransactionError, renderPermissions } from '@/lib/utils';
import { useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { toast } from 'sonner';
import { isPublickey } from '~/lib/isPublickey';
import { useMultisigData } from '~/hooks/useMultisigData';
import { useMultisig } from '~/hooks/useServices';
import { useQueryClient } from '@tanstack/react-query';
import { waitForConfirmation } from '../lib/transactionConfirmation';
import { buildAddLimitTx, formatPeriod, simulateTx } from '~/lib/spendingLimits';

type AddLimitProps = {
  multisigPda: string;
  disabled: boolean;
  onWalletRequired: () => void;
};

/** Parses a decimal SOL string into lamports; null when invalid or <= 0. */
function parseSolToLamports(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = (frac + '000000000').slice(0, 9);
  const lamports = BigInt(whole) * BigInt(1000000000) + BigInt(fracPadded);
  return lamports > BigInt(0) ? lamports : null;
}

/** Parses a base-unit integer string; null when invalid or <= 0. */
function parseBaseUnits(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const amount = BigInt(trimmed);
  return amount > BigInt(0) ? amount : null;
}

const PERIODS = ['OneTime', 'Day', 'Week', 'Month'] as const;

const AddLimitButton = ({ multisigPda, disabled, onWalletRequired }: AddLimitProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const closeDialog = () => setIsOpen(false);
  const wallet = useWallet();
  const { connection, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const queryClient = useQueryClient();

  const [vaultIndex, setVaultIndex] = useState('0');
  const [mint, setMint] = useState('');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>('Week');
  const [selectedMembers, setSelectedMembers] = useState<Record<string, boolean>>({});
  const [destinations, setDestinations] = useState('');
  const [memo, setMemo] = useState('');

  const nativeMint = mint.trim() === '';
  const mintValid = nativeMint || isPublickey(mint.trim());
  const parsedVaultIndex = /^\d+$/.test(vaultIndex.trim()) ? parseInt(vaultIndex.trim(), 10) : NaN;
  const vaultIndexValid = !isNaN(parsedVaultIndex) && parsedVaultIndex >= 0 && parsedVaultIndex <= 255;
  const parsedAmount = nativeMint ? parseSolToLamports(amount) : parseBaseUnits(amount);
  const destinationLines = destinations
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const destinationsValid = destinationLines.every(isPublickey);
  const memberKeys = Object.keys(selectedMembers).filter((key) => selectedMembers[key]);
  const formValid =
    mintValid && vaultIndexValid && parsedAmount !== null && memberKeys.length > 0 && destinationsValid;

  const [vaultPda] = multisig.getVaultPda({
    multisigPda: new PublicKey(multisigPda),
    index: vaultIndexValid ? parsedVaultIndex : 0,
    programId,
  });

  const addLimit = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (parsedAmount === null) throw 'Invalid amount';

    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const { transaction, spendingLimitPda } = buildAddLimitTx({
      multisigPda: new PublicKey(multisigPda),
      configAuthority: wallet.publicKey,
      vaultIndex: parsedVaultIndex,
      mint: nativeMint ? PublicKey.default : new PublicKey(mint.trim()),
      amountLamports: parsedAmount,
      period: multisig.types.Period[period],
      members: memberKeys.map((key) => new PublicKey(key)),
      destinations: destinationLines.map((line) => new PublicKey(line)),
      memo: memo.trim() === '' ? undefined : memo.trim(),
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
    toast.success(`Spending limit created: ${spendingLimitPda.toBase58()}`, { id: 'transaction' });
    closeDialog();
    await queryClient.invalidateQueries({ queryKey: ['spendingLimits'] });
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button
          disabled={disabled}
          onClick={(e) => {
            if (!wallet.publicKey) {
              e.preventDefault();
              onWalletRequired();
              return;
            }
            setIsOpen(true);
          }}
        >
          Add limit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add spending limit</DialogTitle>
          <DialogDescription>
            Signed directly by the config authority — no proposal. Simulate runs before the wallet
            prompt.
          </DialogDescription>
        </DialogHeader>

        <label className="text-xs text-muted-foreground">Vault index</label>
        <Input type="number" value={vaultIndex} onChange={(e) => setVaultIndex(e.target.value)} />
        {!vaultIndexValid && <p className="text-xs text-red-500">Vault index must be 0-255</p>}

        <label className="text-xs text-muted-foreground">Mint (empty = SOL)</label>
        <Input placeholder="11111... (native SOL)" value={mint} onChange={(e) => setMint(e.target.value)} />
        {!mintValid && <p className="text-xs text-red-500">Invalid mint address</p>}

        <label className="text-xs text-muted-foreground">
          Amount per period {nativeMint ? '(SOL)' : '(base units)'}
        </label>
        <Input placeholder={nativeMint ? '0.30' : '300000000'} value={amount} onChange={(e) => setAmount(e.target.value)} />
        {parsedAmount === null && amount.length > 0 && (
          <p className="text-xs text-red-500">Invalid amount</p>
        )}

        <label className="text-xs text-muted-foreground">Period</label>
        <Select value={period} onValueChange={(v) => setPeriod(v as (typeof PERIODS)[number])}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <label className="text-xs text-muted-foreground">Members allowed to use this limit</label>
        <div className="space-y-1">
          {(multisigConfig?.members ?? []).map((member) => {
            const key = member.key.toBase58();
            return (
              <label key={key} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!selectedMembers[key]}
                  onChange={(e) =>
                    setSelectedMembers((prev) => ({ ...prev, [key]: e.target.checked }))
                  }
                />
                <span className="font-mono">{key}</span>
                <span className="text-muted-foreground">({renderPermissions(member.permissions.mask)})</span>
              </label>
            );
          })}
        </div>
        {memberKeys.length === 0 && (
          <p className="text-xs text-red-500">Select at least one member</p>
        )}

        <label className="text-xs text-muted-foreground">
          Destinations (one address per line)
        </label>
        <textarea
          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          placeholder="Leave empty to allow ANY address"
          value={destinations}
          onChange={(e) => setDestinations(e.target.value)}
        />
        {!destinationsValid && <p className="text-xs text-red-500">Invalid destination address</p>}
        {destinationLines.length === 0 && (
          <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-xs text-yellow-200">
            WARNING: empty destinations means this limit can send to ANY address.
          </p>
        )}

        <label className="text-xs text-muted-foreground">Memo (optional)</label>
        <Input value={memo} onChange={(e) => setMemo(e.target.value)} />

        <div className="rounded-md border bg-muted/40 p-3 text-xs">
          <p className="mb-1 font-semibold">You will sign:</p>
          <p>AddSpendingLimit on multisig {multisigPda}</p>
          <p>
            Vault #{vaultIndexValid ? parsedVaultIndex : '?'} ({vaultPda.toBase58()})
          </p>
          <p>Mint: {nativeMint ? 'SOL (native)' : mint.trim()}</p>
          <p>
            Amount: {amount || '?'} {nativeMint ? 'SOL' : 'base units'} / {formatPeriod(multisig.types.Period[period])}
          </p>
          <p>Members: {memberKeys.length > 0 ? memberKeys.join(', ') : '(none selected)'}</p>
          <p>
            Destinations:{' '}
            {destinationLines.length > 0 ? destinationLines.join(', ') : 'ANY ADDRESS'}
          </p>
          {memo.trim() !== '' && <p>Memo: {memo.trim()}</p>}
          <p>Rent payer / fee payer: {wallet.publicKey?.toBase58() ?? '(connect wallet)'}</p>
        </div>

        <Button
          onClick={async () => {
            try {
              await addLimit();
            } catch (e) {
              toast.error(`Failed to add limit: ${formatTransactionError(e)}`, {
                id: 'transaction',
              });
            }
          }}
          disabled={!formValid || !wallet.publicKey}
        >
          Simulate &amp; sign
        </Button>
      </DialogContent>
    </Dialog>
  );
};

export default AddLimitButton;

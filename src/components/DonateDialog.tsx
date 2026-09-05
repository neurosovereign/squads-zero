import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import {
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useMultisigData } from '~/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { useTreasury } from '@/hooks/useTreasury';
import { useAccess } from '~/hooks/useAccess';
import { formatTransactionError } from '@/lib/utils';
import { buildProposalIx } from '~/lib/multisigUtils';
import { simulateVaultInstructions } from '~/lib/jitoPool';
import { waitForConfirmation } from '~/lib/transactionConfirmation';
import { APP_NAME, DONATION_ADDRESS, DONATION_MEMO, DONATION_PRESETS } from '~/lib/donation';

type Step = 'form' | 'created' | 'executed';

const PRESET_SET = new Set<string>(DONATION_PRESETS.map((p) => String(p)));

/**
 * Donation overlay. (a) address + copy for external wallets, (b) Solana Pay
 * QR, (c) a one-click prefilled vault-transfer proposal into the currently
 * open multisig — a thin template over the existing send-SOL flow
 * (create + approve batched, optional immediate execute at threshold 1).
 */
export function DonateDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const wallet = useWallet();
  const { connection, multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const { data: treasury } = useTreasury();
  const canInitiate = useAccess();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('form');
  const [vaultIndex, setVaultIndex] = useState(0);
  const [amount, setAmount] = useState('0.25');
  const [busy, setBusy] = useState(false);
  const [createdIndex, setCreatedIndex] = useState<number | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  // Reset whenever the overlay opens.
  useEffect(() => {
    if (open) {
      setStep('form');
      setAmount('0.25');
      setCreatedIndex(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    QRCode.toDataURL(`solana:${DONATION_ADDRESS}`, {
      margin: 2,
      width: 220,
      color: { dark: '#d9f6fb', light: '#071114' },
    })
      .then((url) => !cancelled && setQrUrl(url))
      .catch(() => !cancelled && setQrUrl(null));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const parsedAmount = parseFloat(amount);
  const amountValid = !isNaN(parsedAmount) && parsedAmount > 0;
  const lamports = amountValid ? Math.round(parsedAmount * LAMPORTS_PER_SOL) : 0;

  const vault = treasury?.vaults.find((v) => v.index === vaultIndex);
  const vaultLamports = vault?.lamports ?? null;
  // 0.005 SOL headroom covers inner fees + wiggle room.
  const sufficient = vaultLamports !== null && lamports + 0.005 * LAMPORTS_PER_SOL <= vaultLamports;

  const threshold = multisigConfig ? Number(multisigConfig.threshold) : null;

  const disabledReason = !multisigAddress
    ? 'Open a multisig first.'
    : !wallet.publicKey
      ? 'Connect a wallet that is a member of this multisig.'
      : !canInitiate
        ? 'The connected wallet needs Initiate permission on this multisig.'
        : !amountValid
          ? 'Enter an amount above 0 SOL.'
          : !sufficient
            ? `Vault #${vaultIndex} does not hold enough SOL for this tip.`
            : null;

  const createProposal = async () => {
    if (!wallet.publicKey || !multisigAddress) throw 'Wallet not connected';
    const multisigPda = new PublicKey(multisigAddress);
    const [vaultPda] = multisig.getVaultPda({ multisigPda, index: vaultIndex, programId });

    const transferIx = SystemProgram.transfer({
      fromPubkey: vaultPda,
      toPubkey: new PublicKey(DONATION_ADDRESS),
      lamports,
    });

    // Same pre-flight as the other vault flows: simulate the inner transfer.
    toast.loading('Simulating...', { id: 'donate', duration: Infinity });
    await simulateVaultInstructions(connection, [transferIx], vaultPda);

    // Transaction index fetched at click time; retry once on an index race.
    const build = (transactionIndexBN: bigint, blockhash: string) => {
      const innerMessage = new TransactionMessage({
        instructions: [transferIx],
        payerKey: vaultPda,
        recentBlockhash: blockhash,
      });
      const createIx = multisig.instructions.vaultTransactionCreate({
        multisigPda,
        creator: wallet.publicKey!,
        ephemeralSigners: 0,
        transactionMessage: innerMessage,
        transactionIndex: transactionIndexBN,
        addressLookupTableAccounts: [],
        rentPayer: wallet.publicKey!,
        vaultIndex,
        memo: DONATION_MEMO,
        programId,
      });
      const proposalIx = buildProposalIx(multisigPda, wallet.publicKey!, transactionIndexBN, programId);
      // Batched like the official app: create + first approve in one signature.
      const approveIx = multisig.instructions.proposalApprove({
        multisigPda,
        transactionIndex: transactionIndexBN,
        member: wallet.publicKey!,
        programId,
      });
      const message = new TransactionMessage({
        instructions: [createIx, proposalIx, approveIx],
        payerKey: wallet.publicKey!,
        recentBlockhash: blockhash,
      }).compileToV0Message();
      return new VersionedTransaction(message);
    };

    const nextIndex = async () => {
      const info = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigPda);
      return BigInt(Number(info.transactionIndex) + 1);
    };

    toast.loading('Waiting for wallet approval...', { id: 'donate', duration: Infinity });

    let signature: string;
    let indexUsed: bigint;
    try {
      indexUsed = await nextIndex();
      const blockhash = (await connection.getLatestBlockhash()).blockhash;
      signature = await wallet.sendTransaction(build(indexUsed, blockhash), connection, {
        skipPreflight: true,
      });
    } catch (e) {
      // Index race (another proposal landed meanwhile): refetch and retry once.
      indexUsed = await nextIndex();
      const blockhash = (await connection.getLatestBlockhash()).blockhash;
      signature = await wallet.sendTransaction(build(indexUsed, blockhash), connection, {
        skipPreflight: true,
      });
    }

    toast.info(`Confirming: ${signature.slice(0, 8)}…`, { id: 'donate', duration: Infinity });
    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) throw `Transaction failed or timed out. Check ${signature}`;

    setCreatedIndex(Number(indexUsed));
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    toast.success('Donation proposal created.', { id: 'donate' });
  };

  const executeNow = async () => {
    if (!wallet.publicKey || !multisigAddress || createdIndex === null) throw 'Not ready';
    const multisigPda = new PublicKey(multisigAddress);
    const indexBN = BigInt(createdIndex);

    toast.loading('Waiting for wallet approval...', { id: 'donate', duration: Infinity });
    const resp = await multisig.instructions.vaultTransactionExecute({
      multisigPda,
      connection,
      member: wallet.publicKey,
      transactionIndex: indexBN,
      programId,
    });
    const blockhash = (await connection.getLatestBlockhash()).blockhash;
    const tx = new VersionedTransaction(
      new TransactionMessage({
        instructions: [resp.instruction],
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
      }).compileToV0Message(resp.lookupTableAccounts)
    );
    const signature = await wallet.sendTransaction(tx, connection, { skipPreflight: true });
    toast.info(`Confirming: ${signature.slice(0, 8)}…`, { id: 'donate', duration: Infinity });
    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) throw `Execution failed or timed out. Check ${signature}`;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
      queryClient.invalidateQueries({ queryKey: ['treasury'] }),
    ]);
    setStep('executed');
    toast.success('Thank you — tip sent.', { id: 'donate' });
  };

  const run = async (fn: () => Promise<void>, next: Step) => {
    setBusy(true);
    try {
      await fn();
      setStep(next);
    } catch (e) {
      toast.error(`Failed: ${formatTransactionError(e)}`, { id: 'donate' });
    } finally {
      setBusy(false);
    }
  };

  const copy = () => {
    navigator.clipboard
      .writeText(DONATION_ADDRESS)
      .then(() => toast.success('Donation address copied'))
      .catch(() => toast.error('Copy failed'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight">Support this project</DialogTitle>
          <DialogDescription>
            {APP_NAME} is free and open source. If it saves your team money, tips keep it alive.
          </DialogDescription>
        </DialogHeader>

        {step === 'form' && (
          <div className="flex flex-col gap-4 py-1">
            <div className="flex flex-col items-center gap-3">
              {qrUrl ? (
                <img
                  src={qrUrl}
                  alt="QR code for the donation address"
                  className="rounded-lg border border-primary/20"
                />
              ) : (
                <div className="h-[220px] w-[220px] animate-pulse rounded-lg bg-primary/5" />
              )}
              <button
                type="button"
                onClick={copy}
                className="group flex w-full items-center justify-center gap-2 rounded-md border border-primary/20 bg-black/30 px-3 py-2 font-mono text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                title={DONATION_ADDRESS}
              >
                <span className="break-all text-center">{DONATION_ADDRESS}</span>
                <Copy className="h-3.5 w-3.5 shrink-0 opacity-50 transition-opacity group-hover:opacity-100" />
              </button>
            </div>

            <div className="space-y-2 border-t border-border/60 pt-3">
              <p className="text-xs text-muted-foreground">
                Or send from this squad — creates a normal vault proposal (SOL only):
              </p>
              <div className="flex gap-1.5">
                {DONATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className={`flex-1 rounded-md border px-2 py-1.5 text-xs transition-colors ${
                      amount === String(preset)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    }`}
                  >
                    {preset} SOL
                  </button>
                ))}
              </div>
              <Input
                placeholder="Custom amount (SOL)"
                value={PRESET_SET.has(amount) ? '' : amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              {(treasury?.vaults.length ?? 0) > 1 && (
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs"
                  value={vaultIndex}
                  onChange={(e) => setVaultIndex(parseInt(e.target.value, 10))}
                >
                  {(treasury?.vaults ?? []).map((v) => (
                    <option key={v.index} value={v.index}>
                      Vault #{v.index} — {(v.lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL
                    </option>
                  ))}
                </select>
              )}
              {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
              <Button
                disabled={disabledReason !== null || busy}
                onClick={() => run(createProposal, 'created')}
              >
                {busy ? 'Working…' : 'Create donation proposal'}
              </Button>
            </div>
          </div>
        )}

        {step === 'created' && (
          <div className="flex flex-col gap-3 py-1 text-sm">
            <p>
              Donation proposal #{createdIndex} created
              {threshold !== null && threshold > 1
                ? ' — it goes through your team’s normal approval flow.'
                : '.'}
            </p>
            <div className="flex gap-2">
              {threshold === 1 && (
                <Button disabled={busy} onClick={() => run(executeNow, 'executed')}>
                  {busy ? 'Working…' : 'Execute now'}
                </Button>
              )}
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {threshold === 1 ? 'Later' : 'Done'}
              </Button>
            </div>
          </div>
        )}

        {step === 'executed' && (
          <div className="flex flex-col gap-3 py-1 text-sm">
            <p>Thank you — the tip was sent from the vault.</p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

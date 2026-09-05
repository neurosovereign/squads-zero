import { useEffect, useRef, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { UserMinus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { truncateAddress } from '@/components/tokenMeta';
import { formatTransactionError } from '@/lib/utils';
import { useAccess } from '@/hooks/useAccess';
import { memberNameOf, useMemberNames } from '@/hooks/useMemberNames';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { buildProposalIx } from '@/lib/multisigUtils';
import { waitForConfirmation } from '@/lib/transactionConfirmation';
import { simulateTx } from '~/lib/spendingLimits';
import {
  MemberPermissionsEntry,
  PERMISSION_BITS,
  buildSetMemberPermissionsTx,
  describeSetMemberPermissions,
  findFinalMissingRoles,
  formatPermissionsMask,
  planSetMemberPermissions,
} from '~/lib/members';

type EditMemberDialogProps = {
  member: MemberPermissionsEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Per-member overlay opened from the roster pencil. Bundles everything that
 * used to be always-on cards: the local display name, permission editing
 * (signed directly by the config authority) and member removal (a squad
 * proposal, same flow as the old Remove button on the Configuration page).
 */
const EditMemberDialog = ({ member, open, onOpenChange }: EditMemberDialogProps) => {
  const { connection, multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const wallet = useWallet();
  const walletModal = useWalletModal();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isMember = useAccess();
  const { names, setMemberName } = useMemberNames();

  const key58 = member ? member.key.toBase58() : '';
  const existingName = key58 ? memberNameOf(names, key58) : null;

  const isConfigAuthority = !!(
    wallet.publicKey &&
    multisigConfig &&
    wallet.publicKey.equals(multisigConfig.configAuthority)
  );

  const [name, setName] = useState('');
  const [mask, setMask] = useState(0);
  const [isSavingPerms, setIsSavingPerms] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const signatureRef = useRef<string>('');

  // Throwaway key for the temporary-member sandwich (see planSetMemberPermissions).
  const [tempMemberKey] = useState(() => Keypair.generate().publicKey);

  // Reset the form every time the dialog opens for a (possibly different) member.
  useEffect(() => {
    if (open && member) {
      setName(memberNameOf(names, member.key.toBase58()) ?? '');
      setMask(member.permissions.mask);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, member]);

  if (!member) return null;

  const oldMask = member.permissions.mask;
  const { needsTempMember, tempMemberMask } = planSetMemberPermissions({
    memberKey: member.key,
    isExistingMember: true,
    currentMembers: multisigConfig?.members,
    tempMemberKey,
  });
  const finalMissingMask = multisigConfig
    ? findFinalMissingRoles(multisigConfig.members, member.key, mask)
    : 0;

  const maskDirty = mask !== oldMask;
  const permsValid = mask > 0 && finalMissingMask === 0 && maskDirty;
  const nameDirty = name.trim() !== (existingName ?? '');

  const saveName = () => {
    if (!key58 || !nameDirty) return;
    setMemberName.mutate(
      { memberKey: key58, name: name.trim().length > 0 ? name : null },
      { onSuccess: () => toast.success('Member name saved (this browser only)') }
    );
  };

  const savePermissions = async () => {
    if (!wallet.publicKey) {
      walletModal.setVisible(true);
      throw 'Wallet not connected';
    }
    if (!permsValid) throw 'Invalid permissions';

    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const transaction = buildSetMemberPermissionsTx({
      multisigPda: new PublicKey(multisigAddress!),
      configAuthority: wallet.publicKey,
      memberKey: member.key,
      permissionsMask: mask,
      isExistingMember: true,
      currentMembers: multisigConfig?.members,
      tempMemberKey,
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
    toast.success(`Member permissions updated (${signature})`, { id: 'transaction' });
    await queryClient.invalidateQueries({ queryKey: ['multisig'] });
  };

  const proposeRemoval = async () => {
    if (!wallet.publicKey) {
      walletModal.setVisible(true);
      throw 'Wallet not connected';
    }
    if (!multisigConfig) throw 'Multisig not loaded';

    const bigIntTransactionIndex = BigInt(Number(multisigConfig.transactionIndex) + 1);
    const removeMemberIx = multisig.instructions.configTransactionCreate({
      multisigPda: new PublicKey(multisigAddress!),
      actions: [{ __kind: 'RemoveMember', oldMember: member.key }],
      creator: wallet.publicKey,
      transactionIndex: bigIntTransactionIndex,
      rentPayer: wallet.publicKey,
      programId: programId ? new PublicKey(programId) : multisig.PROGRAM_ID,
    });
    const proposalIx = buildProposalIx(
      new PublicKey(multisigAddress!),
      wallet.publicKey,
      bigIntTransactionIndex,
      programId ? new PublicKey(programId) : multisig.PROGRAM_ID
    );

    const message = new TransactionMessage({
      instructions: [removeMemberIx, proposalIx],
      payerKey: wallet.publicKey,
      recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
    }).compileToV0Message();
    const transaction = new VersionedTransaction(message);

    toast.loading('Waiting for wallet approval...', { id: 'transaction', duration: Infinity });
    const signature = await wallet.sendTransaction(transaction, connection, {
      skipPreflight: true,
    });
    signatureRef.current = signature;

    const shortSig = `${signature.slice(0, 8)}...${signature.slice(-4)}`;
    toast.info(`Sent: ${signature}`, { duration: 6000 });
    toast.info(`Confirming: ${shortSig}`, { id: 'transaction', duration: Infinity });

    const [confirmed] = await waitForConfirmation(connection, [signature]);
    if (!confirmed) {
      throw `Transaction failed or timed out. Check ${signature}`;
    }
    toast.success(`Remove member action proposed. (${signature})`, { id: 'transaction' });
    onOpenChange(false);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['transactions'] }),
      queryClient.invalidateQueries({ queryKey: ['multisig'] }),
    ]);
    navigate('/transactions');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{key58}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Local display name */}
          <div className="space-y-2">
            <p className="holo-label">Name</p>
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    saveName();
                  }
                }}
                placeholder="e.g. Alice Ops"
                maxLength={32}
                className="text-sm"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={saveName}
                disabled={!nameDirty || setMemberName.isPending}
              >
                {setMemberName.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Stored only in this browser — on-chain the member stays a public key.
            </p>
          </div>

          {/* Permissions (config authority, immediate) */}
          <div className="space-y-3 border-t border-border/60 pt-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="holo-label">Permissions</p>
              <span className="font-mono text-xs text-muted-foreground">
                mask {oldMask} -&gt; {mask}
              </span>
            </div>
            <div className="flex gap-4">
              {PERMISSION_BITS.map((p) => (
                <label key={p.name} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={(mask & p.mask) === p.mask}
                    onChange={(e) =>
                      setMask((m) => (e.target.checked ? m | p.mask : m & ~p.mask))
                    }
                    disabled={!isConfigAuthority}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {p.name}
                </label>
              ))}
            </div>

            {!isConfigAuthority ? (
              <p className="text-xs text-muted-foreground">
                Permission changes are signed directly by the config authority (
                <span className="font-mono">
                  {multisigConfig ? truncateAddress(multisigConfig.configAuthority.toBase58()) : '…'}
                </span>
                ) and take effect immediately. Connect that wallet to edit.
              </p>
            ) : (
              <>
                {mask === 0 && (
                  <p className="text-xs text-red-500">Select at least one permission</p>
                )}
                {finalMissingMask !== 0 && (
                  <p className="text-xs text-red-500">
                    Resulting multisig would have no member holding{' '}
                    {formatPermissionsMask(finalMissingMask)} — the program requires at least one
                    holder of each role
                  </p>
                )}

                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <p className="mb-1 font-semibold">
                    You will sign (blind-signing — verify every line):
                  </p>
                  <p className="break-all">
                    {describeSetMemberPermissions({
                      memberKey: member.key,
                      oldMask,
                      newMask: mask,
                      isExistingMember: true,
                      needsTempMember,
                      tempMemberMask,
                    })}
                  </p>
                  <p>
                    Instructions:{' '}
                    {needsTempMember
                      ? 'multisigAddMember (temp member) + multisigRemoveMember + multisigAddMember + multisigRemoveMember (temp member) — atomic in one transaction'
                      : 'multisigRemoveMember + multisigAddMember (atomic in one transaction)'}
                  </p>
                  {needsTempMember && (
                    <>
                      <p className="text-yellow-300">
                        Removing this member would leave the multisig without a holder of{' '}
                        {formatPermissionsMask(tempMemberMask)} — a throwaway member covering the
                        missing permission(s) keeps the on-chain invariant satisfied inside the
                        atomic transaction.
                      </p>
                      <p className="break-all">
                        Temporary member (added &amp; removed within this same transaction):{' '}
                        {tempMemberKey.toBase58()} (permissions:{' '}
                        {formatPermissionsMask(tempMemberMask)})
                      </p>
                    </>
                  )}
                  <p className="break-all">Multisig: {multisigAddress}</p>
                  <p className="break-all">
                    Signed by config authority:{' '}
                    {wallet.publicKey ? wallet.publicKey.toBase58() : '(connect wallet)'} (also fee
                    payer / rent payer)
                  </p>
                  <p>Effect: immediate on confirmation — no proposal, no vote.</p>
                </div>

                <Button
                  onClick={async () => {
                    setIsSavingPerms(true);
                    try {
                      await savePermissions();
                    } catch (e) {
                      toast.error(`Failed to set permissions: ${formatTransactionError(e)}`, {
                        id: 'transaction',
                      });
                    } finally {
                      setIsSavingPerms(false);
                    }
                  }}
                  disabled={!permsValid || isSavingPerms || !wallet.publicKey}
                >
                  {isSavingPerms ? 'Signing...' : 'Simulate & sign'}
                </Button>
              </>
            )}
          </div>

          {/* Removal (squad proposal) */}
          <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="holo-label text-destructive">Remove from squad</p>
            <p className="text-xs text-muted-foreground">
              Creates a squad proposal to remove this member — it takes effect once the squad
              approves and executes it.
            </p>
            <Button
              variant="destructive"
              size="sm"
              disabled={!isMember || isRemoving || !wallet.publicKey}
              onClick={async () => {
                setIsRemoving(true);
                try {
                  await proposeRemoval();
                } catch (e) {
                  toast.error(
                    `Failed to propose: ${formatTransactionError(e)}${signatureRef.current ? ` (${signatureRef.current})` : ''}`,
                    { id: 'transaction' }
                  );
                } finally {
                  setIsRemoving(false);
                }
              }}
            >
              <UserMinus className="mr-2 h-4 w-4" />
              {isRemoving ? 'Proposing...' : 'Propose removal'}
            </Button>
            {!isMember && (
              <p className="text-xs text-muted-foreground">
                Connect a wallet with the Initiate permission to propose a removal.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditMemberDialog;

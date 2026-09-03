import { Suspense, useEffect, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { Keypair, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { isPublickey } from '~/lib/isPublickey';
import { formatTransactionError } from '@/lib/utils';
import { simulateTx } from '~/lib/spendingLimits';
import {
  buildSetMemberPermissionsTx,
  describeSetMemberPermissions,
  findFinalMissingRoles,
  formatPermissionsMask,
  PERMISSION_BITS,
  planSetMemberPermissions,
} from '~/lib/members';
import { waitForConfirmation } from '../lib/transactionConfirmation';
import { MemberLabel, MemberNameEditor } from '@/components/MemberName';

const OTHER = '__other__';

const PermBadge = ({ name, active }: { name: string; active: boolean }) => (
  <span
    className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
      active
        ? 'border-green-500/40 bg-green-500/10 text-green-400'
        : 'border-muted text-muted-foreground/40'
    }`}
  >
    {name}
  </span>
);

const MembersPage = () => {
  const { connection, multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig, isFetching, refetch } = useMultisig();
  const wallet = useWallet();
  const queryClient = useQueryClient();

  const isConfigAuthority = !!(
    wallet.publicKey &&
    multisigConfig &&
    wallet.publicKey.equals(multisigConfig.configAuthority)
  );

  const [selectedMember, setSelectedMember] = useState<string>('');
  const [otherAddress, setOtherAddress] = useState('');
  const [initiate, setInitiate] = useState(false);
  const [vote, setVote] = useState(false);
  const [execute, setExecute] = useState(false);

  // Prefill the checkboxes from the current mask when an existing member is picked.
  useEffect(() => {
    if (selectedMember && selectedMember !== OTHER) {
      const member = multisigConfig?.members.find((m) => m.key.toBase58() === selectedMember);
      if (member) {
        setInitiate((member.permissions.mask & multisig.types.Permission.Initiate) !== 0);
        setVote((member.permissions.mask & multisig.types.Permission.Vote) !== 0);
        setExecute((member.permissions.mask & multisig.types.Permission.Execute) !== 0);
      }
    }
  }, [selectedMember, multisigConfig]);

  const otherValid = isPublickey(otherAddress.trim());
  const memberKey: PublicKey | null =
    selectedMember === OTHER
      ? otherValid
        ? new PublicKey(otherAddress.trim())
        : null
      : selectedMember
        ? new PublicKey(selectedMember)
        : null;

  const existingMember =
    memberKey && multisigConfig
      ? multisigConfig.members.find((m) => m.key.equals(memberKey))
      : undefined;
  const isExistingMember = !!existingMember;
  const oldMask = existingMember?.permissions.mask;

  const mask =
    (initiate ? multisig.types.Permission.Initiate : 0) |
    (vote ? multisig.types.Permission.Vote : 0) |
    (execute ? multisig.types.Permission.Execute : 0);

  // Throwaway key for the temporary-member sandwich (only used when removing the
  // selected member would leave a role uncovered — see planSetMemberPermissions).
  // One per page load is fine: it never signs and is added+removed inside the same tx.
  const [tempMemberKey] = useState(() => Keypair.generate().publicKey);
  const { needsTempMember, tempMemberMask } = memberKey
    ? planSetMemberPermissions({
        memberKey,
        isExistingMember,
        currentMembers: multisigConfig?.members,
        tempMemberKey,
      })
    : { needsTempMember: false, tempMemberMask: 0 };

  // Roles the FINAL member set would lack — the change is impossible when non-zero.
  const finalMissingMask =
    memberKey && isExistingMember && multisigConfig
      ? findFinalMissingRoles(multisigConfig.members, memberKey, mask)
      : 0;

  const formValid = memberKey !== null && mask > 0 && finalMissingMask === 0;

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const setPermissions = async () => {
    if (!wallet.publicKey) throw 'Wallet not connected';
    if (!memberKey || mask === 0) throw 'Invalid member or permissions';

    const recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const transaction = buildSetMemberPermissionsTx({
      multisigPda: new PublicKey(multisigAddress!),
      configAuthority: wallet.publicKey,
      memberKey,
      permissionsMask: mask,
      isExistingMember,
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

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
              Members
              {isFetching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </h1>
          </div>

          {multisigConfig && !isConfigAuthority && (
            <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              Connect the config-authority wallet (
              <span className="font-mono">{multisigConfig.configAuthority.toBase58()}</span>) to
              change member permissions.
            </div>
          )}

          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Current members</CardTitle>
              <CardDescription>
                Members of this multisig and their permission masks. Names are stored locally in
                this browser — the protocol itself has no on-chain naming. Permissions are managed
                directly by the config authority.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!multisigConfig || multisigConfig.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No members found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Member</TableHead>
                      <TableHead>Permissions</TableHead>
                      <TableHead>Mask</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {multisigConfig.members.map((member) => {
                      const key58 = member.key.toBase58();
                      const isYou = !!wallet.publicKey && wallet.publicKey.equals(member.key);
                      const isConfigAuthRow =
                        !!multisigConfig && multisigConfig.configAuthority.equals(member.key);
                      return (
                        <TableRow key={key58}>
                          <TableCell className="font-mono text-xs">
                            <div className="flex items-center gap-2">
                              <MemberLabel memberKey={key58} className="text-xs" />
                              <MemberNameEditor memberKey={key58} />
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-white"
                                onClick={() => copyKey(key58)}
                                title={`Copy address: ${key58}`}
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {PERMISSION_BITS.map((p) => (
                                <PermBadge
                                  key={p.name}
                                  name={p.name}
                                  active={(member.permissions.mask & p.mask) === p.mask}
                                />
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-xs">{member.permissions.mask}</TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              {isYou && (
                                <span className="rounded-md border border-blue-500/40 bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">
                                  you
                                </span>
                              )}
                              {isConfigAuthRow && (
                                <span className="rounded-md border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[10px] text-purple-400">
                                  config authority
                                </span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Set permissions</CardTitle>
              <CardDescription>
                Changes take effect immediately and are signed directly by the config authority — no
                proposal, no vote. Squads v4 has no change-permissions instruction: changing an
                existing member is a remove + re-add, atomic in one transaction.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <label className="text-xs text-muted-foreground">Member</label>
              <Select value={selectedMember} onValueChange={setSelectedMember}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                  {(multisigConfig?.members ?? []).map((m) => (
                    <SelectItem key={m.key.toBase58()} value={m.key.toBase58()}>
                      <MemberLabel memberKey={m.key.toBase58()} className="text-xs" />
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER}>Other address…</SelectItem>
                </SelectContent>
              </Select>

              {selectedMember === OTHER && (
                <>
                  <label className="text-xs text-muted-foreground">Member address</label>
                  <Input
                    placeholder="Base58 public key"
                    value={otherAddress}
                    onChange={(e) => setOtherAddress(e.target.value)}
                  />
                  {!otherValid && otherAddress.trim().length > 0 && (
                    <p className="text-xs text-red-500">Invalid address</p>
                  )}
                  {otherValid && isExistingMember && (
                    <p className="text-xs text-yellow-400">
                      This address is already a member — submitting will remove + re-add it with the
                      new mask.
                    </p>
                  )}
                </>
              )}

              <label className="text-xs text-muted-foreground">Permissions</label>
              <div className="flex gap-4">
                {(
                  [
                    ['Initiate', initiate, setInitiate],
                    ['Vote', vote, setVote],
                    ['Execute', execute, setExecute],
                  ] as const
                ).map(([name, value, setter]) => (
                  <label key={name} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={value}
                      onChange={(e) => setter(e.target.checked)}
                    />
                    {name}
                  </label>
                ))}
              </div>
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
                <p className="mb-1 font-semibold">You will sign (blind-signing — verify every line):</p>
                {memberKey ? (
                  <>
                    <p className="break-all">
                      {describeSetMemberPermissions({
                        memberKey,
                        oldMask,
                        newMask: mask,
                        isExistingMember,
                        needsTempMember,
                        tempMemberMask,
                      })}
                    </p>
                    <p>
                      Instructions:{' '}
                      {isExistingMember
                        ? needsTempMember
                          ? 'multisigAddMember (temp member) + multisigRemoveMember + multisigAddMember + multisigRemoveMember (temp member) — atomic in one transaction'
                          : 'multisigRemoveMember + multisigAddMember (atomic in one transaction)'
                        : 'multisigAddMember (single instruction)'}
                    </p>
                    {needsTempMember && (
                      <>
                        <p className="text-yellow-300">
                          Removing this member would leave the multisig without a holder of{' '}
                          {formatPermissionsMask(tempMemberMask)} — the program enforces at least
                          one Initiate, one Vote and one Execute holder at all times. A throwaway
                          member covering the missing permission(s) keeps the invariant satisfied
                          inside the atomic transaction.
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
                      {wallet.publicKey ? wallet.publicKey.toBase58() : '(connect wallet)'} (also
                      fee payer / rent payer)
                    </p>
                    <p>Effect: immediate on confirmation — no proposal, no vote.</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Select a member or paste an address to preview the transaction.
                  </p>
                )}
              </div>

              <Button
                onClick={async () => {
                  try {
                    await setPermissions();
                  } catch (e) {
                    toast.error(`Failed to set permissions: ${formatTransactionError(e)}`, {
                      id: 'transaction',
                    });
                  }
                }}
                disabled={!isConfigAuthority || !formValid || !wallet.publicKey}
              >
                Simulate &amp; sign
              </Button>
            </CardContent>
          </Card>

          <div className="mt-4">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Refresh
            </Button>
          </div>
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default MembersPage;

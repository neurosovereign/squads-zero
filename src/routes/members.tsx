import { Suspense, useState } from 'react';
import * as multisig from '@sqds/multisig';
import { useWallet } from '@solana/wallet-adapter-react';
import { toast } from 'sonner';
import { Copy, Loader2, Pencil, UserPlus } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { PERMISSION_BITS, MemberPermissionsEntry } from '~/lib/members';
import { MemberLabel } from '@/components/MemberName';
import EditMemberDialog from '@/components/EditMemberDialog';
import AddMemberDialog from '@/components/AddMemberDialog';

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
  const { multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig, isFetching, refetch } = useMultisig();
  const wallet = useWallet();

  const [editingMember, setEditingMember] = useState<MemberPermissionsEntry | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const copyKey = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div>
          <div className="mb-4 flex items-center justify-between gap-2">
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
              Members
              {isFetching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </h1>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Refresh
              </Button>
              <Button size="sm" onClick={() => setAddOpen(true)}>
                <UserPlus className="mr-2 h-4 w-4" />
                Add member
              </Button>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Current members</CardTitle>
              <CardDescription>
                Members of this multisig and their permission masks. Names are stored locally in
                this browser — the protocol itself has no on-chain naming. Use the pencil to edit a
                member's name or permissions, or to propose their removal.
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
                              <button
                                type="button"
                                className="text-muted-foreground hover:text-white"
                                onClick={() => setEditingMember(member)}
                                title={`Edit member: ${key58}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
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
                                <span className="rounded-md border border-[hsl(261_100%_63%/0.4)] bg-[hsl(261_100%_63%/0.1)] px-1.5 py-0.5 text-[10px] text-[hsl(261_100%_72%)]">
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

          <EditMemberDialog
            member={editingMember}
            open={editingMember !== null}
            onOpenChange={(open) => {
              if (!open) setEditingMember(null);
            }}
          />
          <AddMemberDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            multisigPda={multisigAddress!}
            transactionIndex={Number(multisigConfig ? multisigConfig.transactionIndex : 0) + 1}
            programId={programId ? programId.toBase58() : multisig.PROGRAM_ID.toBase58()}
          />
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default MembersPage;

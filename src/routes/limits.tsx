import { Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as multisig from '@sqds/multisig';
import { PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import AddLimitButton from '@/components/AddLimitButton';
import RemoveLimitButton from '@/components/RemoveLimitButton';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import {
  fetchSpendingLimits,
  formatLastReset,
  formatLimitAmount,
  formatPeriod,
  isNativeMint,
} from '~/lib/spendingLimits';

const LimitsPage = () => {
  const { connection, multisigAddress, programId } = useMultisigData();
  const { data: multisigConfig } = useMultisig();
  const wallet = useWallet();
  const walletModal = useWalletModal();

  const isConfigAuthority = !!(
    wallet.publicKey &&
    multisigConfig &&
    wallet.publicKey.equals(multisigConfig.configAuthority)
  );

  const {
    data: limits,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['spendingLimits', multisigAddress, programId.toBase58()],
    queryFn: async () => {
      if (!multisigAddress) return [];
      return await fetchSpendingLimits(connection, new PublicKey(multisigAddress), programId);
    },
    enabled: !!multisigAddress,
  });

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div>
          <div className="mb-4 flex items-center justify-between">
            <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
              Spending Limits
              {isFetching && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
            </h1>
            <AddLimitButton
              multisigPda={multisigAddress!}
              disabled={!isConfigAuthority}
              onWalletRequired={() => walletModal.setVisible(true)}
            />
          </div>

          {multisigConfig && !isConfigAuthority && (
            <div className="mb-4 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-sm text-yellow-200">
              Connect the config-authority wallet (
              <span className="font-mono">{multisigConfig.configAuthority.toBase58()}</span>) to add
              or remove spending limits.
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Existing limits</CardTitle>
              <CardDescription>
                Spending limits let members move funds out of a vault without a proposal, up to the
                allowance per period. Managed directly by the config authority.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!limits || limits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No spending limits found.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Limit Address</TableHead>
                      <TableHead>Vault</TableHead>
                      <TableHead>Mint</TableHead>
                      <TableHead>Amount / Period</TableHead>
                      <TableHead>Remaining</TableHead>
                      <TableHead>Last Reset</TableHead>
                      <TableHead>Members</TableHead>
                      <TableHead>Destinations</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {limits.map(({ publicKey, account }) => {
                      const native = isNativeMint(account.mint);
                      const [vaultPda] = multisig.getVaultPda({
                        multisigPda: new PublicKey(multisigAddress!),
                        index: account.vaultIndex,
                        programId,
                      });
                      return (
                        <TableRow key={publicKey.toBase58()}>
                          <TableCell className="font-mono text-xs">
                            {publicKey.toBase58()}
                          </TableCell>
                          <TableCell>
                            <div>#{account.vaultIndex}</div>
                            <div className="font-mono text-xs text-muted-foreground">
                              {vaultPda.toBase58()}
                            </div>
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {native ? 'SOL' : account.mint.toBase58()}
                          </TableCell>
                          <TableCell>
                            {formatLimitAmount(BigInt(account.amount.toString()), native)}
                            <span className="text-muted-foreground">
                              {' '}
                              / {formatPeriod(Number(account.period))}
                            </span>
                          </TableCell>
                          <TableCell>
                            {formatLimitAmount(BigInt(account.remainingAmount.toString()), native)}
                          </TableCell>
                          <TableCell className="text-xs">
                            {formatLastReset(BigInt(account.lastReset.toString()))}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {account.members.map((m) => (
                              <div key={m.toBase58()}>{m.toBase58()}</div>
                            ))}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {account.destinations.length === 0 ? (
                              <span className="text-yellow-400">ANY address</span>
                            ) : (
                              account.destinations.map((d) => (
                                <div key={d.toBase58()}>{d.toBase58()}</div>
                              ))
                            )}
                          </TableCell>
                          <TableCell>
                            <RemoveLimitButton
                              multisigPda={multisigAddress!}
                              limit={publicKey}
                              account={account}
                              disabled={!isConfigAuthority}
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
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

export default LimitsPage;

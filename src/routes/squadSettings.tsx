import ChangeThresholdInput from '@/components/ChangeThresholdInput';
import ChangeTimelockInput from '@/components/ChangeTimelockInput';
import ChangeUpgradeAuthorityInput from '@/components/ChangeUpgradeAuthorityInput';
import CreateProgramUpgradeInput from '@/components/CreateProgramUpgradeInput';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PublicKey } from '@solana/web3.js';
import { useMultisigData } from '@/hooks/useMultisigData';
import { useMultisig } from '@/hooks/useServices';
import { useProgram } from '@/hooks/useProgram';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Suspense, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Squad settings — the rarely-changed on-chain knobs of the multisig, combined
 * from the old Configuration and Programs pages: threshold, timelock and
 * program authority/upgrades. Reached via the gear on the sidebar squad card.
 */
const SquadSettingsPage = () => {
  const { multisigAddress } = useMultisigData();
  const { data: multisigConfig } = useMultisig();

  // Program manager state (unchanged from the old Programs page).
  const [programIdInput, setProgramIdInput] = useState('');
  const [programIdError, setProgramIdError] = useState('');
  const [validatedProgramId, setValidatedProgramId] = useState<string | null>(null);
  const { data: programInfos } = useProgram(validatedProgramId);

  const validateProgramId = () => {
    setProgramIdError('');
    if (!programIdInput.trim()) {
      setProgramIdError('Program ID is required');
      return;
    }
    try {
      new PublicKey(programIdInput);
      setValidatedProgramId(programIdInput);
    } catch {
      setProgramIdError('Invalid Program ID format');
    }
  };

  const clearProgramId = () => {
    setProgramIdInput('');
    setValidatedProgramId(null);
    setProgramIdError('');
  };

  const nextTxIndex = Number(multisigConfig ? multisigConfig.transactionIndex : 0) + 1;

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div className="">
          <h1 className="mb-1 font-display text-2xl font-semibold tracking-tight">Squad Settings</h1>
          <p className="mb-4 text-sm text-muted-foreground">
            Rarely-changed on-chain configuration. Member management — names, permissions, adding
            and removing members — lives on the{' '}
            <Link to="/members" className="text-primary underline-offset-2 hover:underline">
              Members page
            </Link>
            .
          </p>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Change Threshold</CardTitle>
                <CardDescription>
                  Change the threshold required to execute a Multisig transaction.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {multisigConfig ? (
                  <span>Current Threshold: {multisigConfig.threshold} </span>
                ) : null}
                <ChangeThresholdInput
                  multisigPda={multisigAddress!}
                  transactionIndex={nextTxIndex}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Timelock</CardTitle>
                <CardDescription>
                  Seconds that must pass between transaction approval and execution.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {multisigConfig != null ? (
                  <span>Current Timelock: {multisigConfig.timeLock}s </span>
                ) : null}
                <ChangeTimelockInput
                  multisigPda={multisigAddress!}
                  transactionIndex={nextTxIndex}
                  currentTimeLock={multisigConfig?.timeLock ?? 0}
                />
              </CardContent>
            </Card>
          </div>

          <p className="holo-label mb-2 mt-8">Program Manager</p>
          <Card>
            <CardHeader>
              <CardTitle>Program</CardTitle>
              <CardDescription>
                Enter the Program ID for a program under Squad authority. Upon validation, you will
                have the ability to upgrade and modify its authority settings.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Input
                      placeholder="Enter Program ID"
                      value={programIdInput}
                      onChange={(e) => setProgramIdInput(e.target.value)}
                      className={programIdError ? 'border-red-500' : ''}
                    />
                    {programIdError && (
                      <p className="mt-1 text-sm text-red-500">{programIdError}</p>
                    )}
                  </div>
                  <Button onClick={validateProgramId}>Validate</Button>
                  {validatedProgramId && (
                    <Button variant="outline" onClick={clearProgramId}>
                      Clear
                    </Button>
                  )}
                </div>

                {validatedProgramId && programInfos && (
                  <div className="mt-4">
                    <h3 className="text-lg font-medium">Program Information</h3>
                    <pre className="mt-2 overflow-auto rounded-md border border-primary/10 bg-black/40 p-4 font-mono text-xs text-muted-foreground">
                      <div>Program Data Address: {programInfos.programDataAddress}</div>
                      <div>Program Authority: {programInfos.authority || 'Immutable'}</div>
                    </pre>
                  </div>
                )}

                {validatedProgramId && !programInfos && (
                  <div className="mt-4 rounded bg-yellow-50 p-4 text-yellow-800">
                    No program found with this ID or unable to fetch program data.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          {multisigConfig && programInfos && (
            <div className="mt-4 flex flex-col gap-4 pb-4 md:flex-row">
              <div className="flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Change Program Upgrade Authority</CardTitle>
                    <CardDescription>
                      Change the upgrade authority of one of your programs.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChangeUpgradeAuthorityInput
                      programInfos={programInfos}
                      transactionIndex={nextTxIndex}
                    />
                  </CardContent>
                </Card>
              </div>
              <div className="flex-1">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle>Upgrade program</CardTitle>
                    <CardDescription>Apply an upgrade to the program.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CreateProgramUpgradeInput
                      programInfos={programInfos}
                      transactionIndex={nextTxIndex}
                    />
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default SquadSettingsPage;

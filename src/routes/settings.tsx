import SetProgramIdInput from '@/components/SetProgramIdInput';
import SetRpcUrlInput from '@/components/SetRpcUrlnput';
import SetHeliumKeyInput from '@/components/SetHeliumKeyInput';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import SetExplorerInput from '../components/SetExplorerInput';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Suspense } from 'react';

const SettingsPage = () => {
  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div>
          <h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Settings</h1>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>RPC Url</CardTitle>
                <CardDescription>
                  Change the default RPC Url. Takes priority over the Helium key below.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SetRpcUrlInput />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Helium (Helius) API Key</CardTitle>
                <CardDescription>
                  Unlocks DAS: token metadata, USD prices and indexed queries.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <SetHeliumKeyInput />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Program ID</CardTitle>
                <CardDescription>Change the targeted program ID.</CardDescription>
              </CardHeader>
              <CardContent>
                <SetProgramIdInput />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Explorer</CardTitle>
                <CardDescription>Change the explorer.</CardDescription>
              </CardHeader>
              <CardContent>
                <SetExplorerInput />
              </CardContent>
            </Card>
          </div>
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default SettingsPage;

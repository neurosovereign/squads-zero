import React, { Suspense } from 'react';
import { Wallet } from './components/Wallet';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckSquare } from 'lucide-react';
import { Toaster } from './components/ui/sonner';
import TabNav from './components/TabNav';
import { Backdrop } from './components/Backdrop';

import HomePage from './routes/_index';
import CreatePage from './routes/create';
import SettingsPage from './routes/settings';
import TransactionsPage from './routes/transactions';
import LimitsPage from './routes/limits';
import StakePage from './routes/stake';
import MembersPage from './routes/members';
import SquadSettingsPage from './routes/squadSettings';
import { Routes, Route, HashRouter, Navigate } from 'react-router-dom';

import './styles/global.css'; // Load Tailwind styles
import { ErrorBoundary } from './components/ErrorBoundary';

const queryClient = new QueryClient();

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <Wallet>
        <HashRouter>
          <div className="flex h-screen min-w-full flex-col md:flex-row">
            <Backdrop />
            <Suspense>
              <TabNav />
            </Suspense>
            <div className="mt-1 flex-1 space-y-2 p-3 pb-24 pt-4 md:ml-56 md:space-y-4 md:p-8 md:pt-6 min-w-0">
              <ErrorBoundary>
                <Suspense fallback={<p>Loading...</p>}>
                  <Routes>
                    <Route index path="/" element={<HomePage />} />
                    <Route path="/config" element={<Navigate to="/squad-settings" replace />} />
                    <Route path="/create" element={<CreatePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/transactions" element={<TransactionsPage />} />
                    <Route path="/programs" element={<Navigate to="/squad-settings" replace />} />
                    <Route path="/squad-settings" element={<SquadSettingsPage />} />
                    <Route path="/limits" element={<LimitsPage />} />
                    <Route path="/stake" element={<StakePage />} />
                    <Route path="/members" element={<MembersPage />} />
                    <Route path="/jito" element={<Navigate to="/stake" replace />} />
                    <Route path="*" element={<p>404 - Not Found</p>} /> {/* Catch-all route */}
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>

          <Toaster
            theme="dark"
            expand
            closeButton
            visibleToasts={3}
            icons={{
              error: <AlertTriangle className="h-4 w-4 text-red-600" />,
              success: <CheckSquare className="h-4 w-4 text-green-600" />,
            }}
          />
        </HashRouter>
      </Wallet>
    </QueryClientProvider>
  );
};

export default App;

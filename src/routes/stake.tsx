import { Suspense, useState } from 'react';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import StakeSummary from '@/components/stake/StakeSummary';
import LiquidStakeForm from '@/components/stake/LiquidStakeForm';
import ValidatorStakeForm from '@/components/stake/ValidatorStakeForm';
import StakedAccountsList from '@/components/stake/StakedAccountsList';

type StakeTab = 'liquid' | 'validator';

/**
 * Unified staking page: liquid staking (JitoSOL) and classic validator
 * delegation behind tabs, mirroring the official Squads UI. Both flows still
 * create squad proposals — nothing is signed or executed directly here.
 */
const StakePage = () => {
  const [tab, setTab] = useState<StakeTab>('liquid');

  return (
    <ErrorBoundary>
      <Suspense fallback={<div>Loading...</div>}>
        <div>
          <h1 className="mb-4 font-display text-2xl font-semibold tracking-tight">Stake</h1>

          <StakeSummary />

          <div className="mb-4 inline-flex rounded-md border border-border/60 p-0.5">
            {(
              [
                ['liquid', 'Liquid'],
                ['validator', 'Validator'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded px-4 py-1.5 text-sm transition-colors ${
                  tab === key
                    ? 'solana-gradient font-medium text-[hsl(160_60%_6%)]'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'liquid' ? (
            <LiquidStakeForm />
          ) : (
            <div className="space-y-6">
              <ValidatorStakeForm />
              <StakedAccountsList />
            </div>
          )}
        </div>
      </Suspense>
    </ErrorBoundary>
  );
};

export default StakePage;

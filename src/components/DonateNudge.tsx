import { X } from 'lucide-react';
import { useState } from 'react';
import { dismissTipLine } from '~/lib/donation';

/**
 * The single quiet line shown after a successful vault-transaction execution
 * (frequency-capped in lib/donation.ts). Purely informational; the "x"
 * dismisses it permanently.
 */
export function DonateNudge({ onSupport }: { onSupport: () => void }) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
      <span>
        This client is free and open source — tips keep it alive.{' '}
        <button type="button" onClick={onSupport} className="text-primary/90 hover:text-primary hover:underline">
          Support this project
        </button>
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        title="Don't show this again"
        onClick={() => {
          dismissTipLine();
          setHidden(true);
        }}
        className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </p>
  );
}

'use client';

import { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { useHeliumKey } from '~/hooks/useSettings';

/** Helium (Helius) API key → DAS-capable RPC. Stored in localStorage, per device. */
const SetHeliumKeyInput = () => {
  const { heliumKey, setHeliumKey } = useHeliumKey();
  const [key, setKey] = useState('');

  const looksValid = (k: string) => /^[0-9a-f-]{20,}$/i.test(k.trim());

  const save = async () => {
    if (!looksValid(key)) throw 'That does not look like a Helium API key.';
    await setHeliumKey.mutateAsync(key);
    setKey('');
  };

  const clear = async () => {
    await setHeliumKey.mutateAsync(null);
  };

  return (
    <div>
      {heliumKey && (
        <p className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="status-dot bg-success" />
          Helium key active — DAS token metadata, prices & full indexing enabled.
        </p>
      )}
      <Input
        type="password"
        placeholder={heliumKey ? '•••••••••••••••• (key set)' : 'Helium API key'}
        value={key}
        onChange={(e) => setKey(e.target.value.trim())}
        autoComplete="off"
      />
      <div className="mt-2 flex gap-2">
        <Button
          onClick={() =>
            toast.promise(save(), {
              loading: 'Saving key…',
              success: 'Helium key saved. Reload to apply.',
              error: (e) => `${e}`,
            })
          }
          disabled={!key}
        >
          Save Key
        </Button>
        {heliumKey && (
          <Button variant="outline" onClick={() => toast.promise(clear(), { success: 'Key removed.', error: (e)=>`${e}` , loading:'Removing…'})}>
            Remove
          </Button>
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Stored only in this browser. Get a free key at helius.dev — it becomes the app's RPC and
        unlocks indexed queries (spending limits, stake accounts) plus token metadata & prices.
      </p>
    </div>
  );
};

export default SetHeliumKeyInput;

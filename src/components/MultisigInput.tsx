import { useState } from 'react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { useMultisigAddress } from '@/hooks/useMultisigAddress';

const MultisigInput = ({ onUpdate }: { onUpdate: () => void }) => {
  const { multisigAddress, setMultisigAddress } = useMultisigAddress();
  const [multisig, setMultisig] = useState(multisigAddress || '');

  const onSubmit = async () => {
    if (multisig.trim().length > 0) {
      await setMultisigAddress.mutateAsync(multisig); // Save using React Query
      onUpdate(); // Trigger any additional UI updates
    }
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 md:py-20 lg:px-8">
      <div className="holo-panel rounded-lg p-6 sm:p-8">
        <p className="holo-label">Get Started</p>
        <h1 className="font-display mt-2 text-2xl font-semibold tracking-tight">
          Enter Multisig Config Address
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          There is no multisig set in Local Storage. Set it by entering its Public Key below.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Input
            type="text"
            placeholder="Multisig Address"
            className="h-11 flex-1"
            value={multisig}
            onChange={(e) => setMultisig(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSubmit();
            }}
          />
          <Button onClick={onSubmit} className="h-11 px-6">
            Set Multisig
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MultisigInput;

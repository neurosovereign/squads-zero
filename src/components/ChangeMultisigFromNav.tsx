import { useMultisigAddress } from '@/hooks/useMultisigAddress';
import { useNavigate } from 'react-router-dom';

export const ChangeMultisigFromNav = () => {
  const { setMultisigAddress } = useMultisigAddress(); // Use React Query hook
  const navigate = useNavigate();
  const handleChangeMultisig = () => {
    setMultisigAddress.mutate(null); // Wipes out the stored multisig address
    // navigate to home
    navigate('/');
  };

  return (
    <button
      onClick={handleChangeMultisig}
      className="w-full rounded-md px-3 py-1.5 text-left text-xs text-muted-foreground/70 transition-colors hover:text-primary"
    >
      Switch squad…
    </button>
  );
};

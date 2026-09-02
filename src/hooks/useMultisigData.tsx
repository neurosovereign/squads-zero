import { useMemo } from 'react';
import { Connection, PublicKey } from '@solana/web3.js';
import { useRpcUrl, useProgramId, DEFAULT_RPC_URL } from './useSettings';
import { useVaultIndex } from './useVaultIndex';
import { useMultisigAddress } from './useMultisigAddress';
import * as multisig from '@sqds/multisig';

export const useMultisigData = () => {
  // Fetch settings from React Query hooks
  const { rpcUrl } = useRpcUrl();
  const { programId: storedProgramId } = useProgramId();
  const { multisigAddress } = useMultisigAddress();
  const { vaultIndex } = useVaultIndex();

  // Ensure we have a valid RPC URL (fallback to the same-origin proxy default)
  const effectiveRpcUrl = rpcUrl || DEFAULT_RPC_URL;
  const connection = useMemo(() => new Connection(effectiveRpcUrl, 'confirmed'), [effectiveRpcUrl]);

  // Compute programId safely
  const programId = useMemo(
    () => (storedProgramId ? new PublicKey(storedProgramId) : multisig.PROGRAM_ID),
    [storedProgramId]
  );

  // Compute the multisig vault PDA
  const multisigVault = useMemo(() => {
    if (multisigAddress) {
      return multisig.getVaultPda({
        multisigPda: new PublicKey(multisigAddress),
        index: vaultIndex,
        programId,
      })[0];
    }
    return null;
  }, [multisigAddress, vaultIndex, programId]);

  return {
    rpcUrl: effectiveRpcUrl,
    connection,
    multisigAddress,
    vaultIndex,
    programId,
    multisigVault,
  };
};

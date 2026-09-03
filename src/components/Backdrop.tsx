import { useMultisigAddress } from '@/hooks/useMultisigAddress';

/**
 * Fixed cinematic backdrop. Full-bleed vault render on the onboarding screens
 * (no squad loaded yet); heavily scrimmed to ambient texture inside the console.
 */
export function Backdrop() {
  const { multisigAddress } = useMultisigAddress();
  return (
    <div
      className={`app-backdrop ${multisigAddress ? '' : 'app-backdrop-hero'}`}
      aria-hidden="true"
    />
  );
}

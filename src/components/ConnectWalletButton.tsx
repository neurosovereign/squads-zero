import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Button } from './ui/button';
import { useWallet } from '@solana/wallet-adapter-react';
import '@solana/wallet-adapter-react-ui/styles.css';

const ConnectWallet = () => {
  const modal = useWalletModal();
  const { publicKey, disconnect } = useWallet();
  return (
    <div>
      {!publicKey ? (
        <Button
          variant="outline"
          onClick={() => {
            modal.setVisible(true);
          }}
          className="h-11 w-full border-primary/25 bg-primary/[0.05] font-normal tracking-wide text-primary/80 backdrop-blur-md hover:border-primary/40 hover:bg-primary/[0.1] hover:text-primary"
        >
          Connect Wallet
        </Button>
      ) : (
        <Button
          onClick={disconnect}
          variant="outline"
          className="h-11 w-full font-mono text-xs tracking-tight"
          title="Disconnect wallet"
        >
          <span className="mr-2 inline-block h-1.5 w-1.5 rounded-full bg-success shadow-[0_0_6px_hsl(160_70%_45%/0.9)]" />
          {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)}
        </Button>
      )}
    </div>
  );
};

export default ConnectWallet;

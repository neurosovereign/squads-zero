'use client';
import React, {FC, useCallback, useMemo} from 'react';
import {ConnectionProvider, WalletProvider} from '@solana/wallet-adapter-react';
import {WalletAdapterNetwork} from '@solana/wallet-adapter-base';
import type {WalletError} from '@solana/wallet-adapter-base';
import {WalletModalProvider} from '@solana/wallet-adapter-react-ui';
import {LedgerWalletAdapter} from '~/lib/ledgerSolanaAdapter';
import {clusterApiUrl} from '@solana/web3.js';
import {toast} from 'sonner';

import '@solana/wallet-adapter-react-ui/styles.css';

type Props = {
    children?: React.ReactNode;
};

export const Wallet: FC<Props> = ({children}) => {
    const network = WalletAdapterNetwork.Mainnet;

    const endpoint = useMemo(() => clusterApiUrl(network), [network]);

    // Ledger via WebHID, custom adapter on Ledger's official libs (the deprecated
    // @solana/wallet-adapter-ledger failed on this hardware). The adapter is
    // hardwired to derivation 44'/501'/0' — the operator's account.
    const wallets = useMemo(
        () => [new LedgerWalletAdapter()],
        []
    );

    // The stock modal surfaces NO error in the UI — failures only hit the console.
    // Toast them so device/transport rejections are visible without opening F12.
    const onError = useCallback((error: WalletError) => {
        console.error('[wallet]', error);
        toast.error(`Wallet: ${error.message || String(error)}`, {duration: 10000});
    }, []);

    return (
        <ConnectionProvider endpoint={endpoint}>
            <WalletProvider wallets={wallets} autoConnect onError={onError}>
                <WalletModalProvider>{children}</WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
};

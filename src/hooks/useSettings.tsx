import * as multisig from '@sqds/multisig';
// top level
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';

// Same-origin RPC proxy default: the public mainnet RPC rejects requests that
// carry a browser Origin header (403), so the client talks to /rpc on its own
// origin, which caddy proxies upstream with Origin stripped.
export const DEFAULT_RPC_URL =
  typeof window !== 'undefined' && window.location?.origin
    ? `${window.location.origin}/rpc`
    : 'https://api.mainnet-beta.solana.com';

/** Public CORS-friendly RPC used when the same-origin /rpc proxy isn't deployed. */
const PUBLIC_FALLBACK_RPC = 'https://solana-rpc.publicnode.com';

const HELIUM_KEY_STORAGE = 'x-helium-key';
const HELIUM_RPC_BASE = 'https://mainnet.helius-rpc.com';

export const getHeliumKey = (): string | null => {
  if (typeof window === 'undefined') return null;
  const k = localStorage.getItem(HELIUM_KEY_STORAGE);
  return k && k.trim().length > 0 ? k.trim() : null;
};

/** DAS-capable RPC URL for a stored Helium key, else null. */
export const heliumRpcUrl = (): string | null => {
  const key = getHeliumKey();
  return key ? `${HELIUM_RPC_BASE}/?api-key=${key}` : null;
};

/** True when the active RPC endpoint is the Helium DAS gateway. */
export const isDasRpc = (url: string): boolean => url.includes('helius-rpc.com');

const probeRpc = async (url: string, timeoutMs = 3500): Promise<boolean> => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
};

/**
 * Resolution order: explicit user RPC setting → Helium key (DAS-capable) →
 * same-origin /rpc proxy if it answers → public fallback. A stored Helium key
 * takes priority over the proxy/fallback because it unlocks indexed + DAS
 * queries (token metadata, prices, spending limits, stake accounts).
 */
const resolveRpcUrl = async (): Promise<string> => {
  if (typeof document !== 'undefined') {
    const stored = localStorage.getItem('x-rpc-url');
    if (stored) return stored;
    const helium = heliumRpcUrl();
    if (helium) return helium;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    const proxy = `${window.location.origin}/rpc`;
    if (await probeRpc(proxy)) return proxy;
  }
  return PUBLIC_FALLBACK_RPC;
};

export const useHeliumKey = () => {
  const queryClient = useQueryClient();
  const { data: heliumKey } = useSuspenseQuery({
    queryKey: ['heliumKey'],
    queryFn: async () => getHeliumKey(),
  });
  const setHeliumKey = useMutation({
    mutationFn: async (key: string | null) => {
      if (key && key.trim()) localStorage.setItem(HELIUM_KEY_STORAGE, key.trim());
      else localStorage.removeItem(HELIUM_KEY_STORAGE);
      return key;
    },
    onSuccess: () => {
      // RPC resolution depends on the key — invalidate so it re-resolves.
      queryClient.invalidateQueries({ queryKey: ['heliumKey'] });
      queryClient.invalidateQueries({ queryKey: ['rpcUrl'] });
    },
  });
  return { heliumKey, setHeliumKey };
};

export const useRpcUrl = () => {
  const queryClient = useQueryClient();

  const { data: rpcUrl } = useSuspenseQuery({
    queryKey: ['rpcUrl'],
    queryFn: resolveRpcUrl,
  });

  const setRpcUrl = useMutation({
    mutationFn: (newRpcUrl: string) => {
      localStorage.setItem(`x-rpc-url`, newRpcUrl);
      return Promise.resolve(newRpcUrl);
    },
    onSuccess: (newRpcUrl) => {
      queryClient.setQueryData(['rpcUrl'], newRpcUrl);
    },
  });

  return { rpcUrl, setRpcUrl };
};

const DEFAULT_PROGRAM_ID = multisig.PROGRAM_ID.toBase58();

const getProgramId = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('x-program-id-v4') || DEFAULT_PROGRAM_ID;
  }
  return DEFAULT_PROGRAM_ID;
};

export const useProgramId = () => {
  const queryClient = useQueryClient();

  const { data: programId } = useSuspenseQuery({
    queryKey: ['programId'],
    queryFn: () => Promise.resolve(getProgramId()),
  });

  const setProgramId = useMutation({
    mutationFn: (newProgramId: string) => {
      localStorage.setItem('x-program-id-v4', newProgramId);
      return Promise.resolve(newProgramId);
    },
    onSuccess: (newProgramId) => {
      queryClient.setQueryData(['programId'], newProgramId);
    },
  });
  return { programId, setProgramId };
};

// explorer url
const DEFAULT_EXPLORER_URL = 'https://explorer.solana.com';
const getExplorerUrl = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('x-explorer-url') || DEFAULT_EXPLORER_URL;
  }
  return DEFAULT_EXPLORER_URL;
};

export const useExplorerUrl = () => {
  const queryClient = useQueryClient();

  const { data: explorerUrl } = useSuspenseQuery({
    queryKey: ['explorerUrl'],
    queryFn: () => Promise.resolve(getExplorerUrl()),
  });

  const setExplorerUrl = useMutation({
    mutationFn: (newExplorerUrl: string) => {
      localStorage.setItem('x-explorer-url', newExplorerUrl);
      return Promise.resolve(newExplorerUrl);
    },
    onSuccess: (newExplorerUrl) => {
      queryClient.setQueryData(['explorerUrl'], newExplorerUrl);
    },
  });
  return { explorerUrl, setExplorerUrl };
};

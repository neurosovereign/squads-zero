import { useInfiniteQuery } from '@tanstack/react-query';
import { getHeliumKey } from './useSettings';

/**
 * Parsed wallet history via the Helius Enhanced Transactions API.
 * This is an off-RPC REST endpoint — it only works with a Helius key.
 *
 * Rate-limit hygiene (free tier):
 * - 10 transactions per call, one call per vault per page
 * - Fetched once when the feed mounts, then served from cache (staleTime 5 min)
 * - No polling, no refetch on window focus; older pages only via "Load more"
 */

const API_BASE = 'https://api-mainnet.helius-rpc.com/v0/addresses';
const PAGE_SIZE = 10;

export type EnhancedTransfer = {
  from: string;
  to: string;
  /** SOL for native transfers, UI token amount for token transfers. */
  amount: number;
  mint?: string;
};

export type ActivityEvent = {
  signature: string;
  timestamp: number; // seconds
  type: string;
  source: string;
  description: string;
  feePayer: string;
  error: boolean;
  vault: string; // the squad vault this row was observed through
  nativeTransfers: EnhancedTransfer[];
  tokenTransfers: EnhancedTransfer[];
};

type RawEnhancedTx = {
  signature: string;
  timestamp: number;
  type?: string;
  source?: string;
  description?: string;
  feePayer?: string;
  transactionError?: unknown;
  nativeTransfers?: { fromUserAccount?: string; toUserAccount?: string; amount?: number }[];
  tokenTransfers?: {
    fromUserAccount?: string;
    toUserAccount?: string;
    tokenAmount?: number;
    mint?: string;
  }[];
};

const toEvent = (raw: RawEnhancedTx, vault: string): ActivityEvent => ({
  signature: raw.signature,
  timestamp: raw.timestamp ?? 0,
  type: raw.type ?? 'UNKNOWN',
  source: raw.source ?? '',
  description: raw.description ?? '',
  feePayer: raw.feePayer ?? '',
  error: raw.transactionError != null,
  vault,
  nativeTransfers: (raw.nativeTransfers ?? [])
    .filter((t) => t.fromUserAccount || t.toUserAccount)
    .map((t) => ({
      from: t.fromUserAccount ?? '',
      to: t.toUserAccount ?? '',
      amount: (t.amount ?? 0) / 1e9,
    })),
  tokenTransfers: (raw.tokenTransfers ?? [])
    .filter((t) => t.fromUserAccount || t.toUserAccount)
    .map((t) => ({
      from: t.fromUserAccount ?? '',
      to: t.toUserAccount ?? '',
      amount: t.tokenAmount ?? 0,
      mint: t.mint,
    })),
});

const fetchPage = async (
  address: string,
  apiKey: string,
  before?: string
): Promise<ActivityEvent[]> => {
  const params = new URLSearchParams({ 'api-key': apiKey, limit: String(PAGE_SIZE) });
  if (before) params.set('before', before);
  const res = await fetch(`${API_BASE}/${address}/transactions?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Helius activity fetch failed (${res.status})`);
  }
  const json = (await res.json()) as RawEnhancedTx[];
  return (json ?? []).map((raw) => toEvent(raw, address));
};

type CursorMap = Record<string, string | null>; // address -> before-signature (null = exhausted)

type SquadActivityPage = {
  events: ActivityEvent[];
  nextCursors: CursorMap | null;
};

/**
 * One paginated feed for the whole squad: each page fans out one request per
 * vault (10 txs each), then merges. Per-vault cursors keep "Load more" cheap —
 * a vault whose history is exhausted stops being queried.
 */
export const useSquadActivity = (addresses: string[]) => {
  const apiKey = getHeliumKey();
  const key = [...addresses].sort().join(',');

  return useInfiniteQuery({
    queryKey: ['squadActivity', key, apiKey ?? ''],
    queryFn: async ({ pageParam }): Promise<SquadActivityPage> => {
      const cursors = (pageParam ?? {}) as CursorMap;
      const nextCursors: CursorMap = {};
      const batches = await Promise.all(
        addresses.map(async (addr) => {
          const cursor = cursors[addr];
          if (cursor === null) {
            nextCursors[addr] = null; // already exhausted
            return [] as ActivityEvent[];
          }
          const events = await fetchPage(addr, apiKey!, cursor);
          nextCursors[addr] =
            events.length === PAGE_SIZE ? events[events.length - 1].signature : null;
          return events;
        })
      );
      const all = batches.flat();
      const hasMore = Object.values(nextCursors).some((c) => c !== null);
      return { events: all, nextCursors: hasMore ? nextCursors : null };
    },
    initialPageParam: undefined as CursorMap | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursors ?? undefined,
    enabled: !!apiKey && addresses.length > 0,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
};

export const hasHeliumKey = (): boolean => !!getHeliumKey();

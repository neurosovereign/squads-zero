import * as multisig from '@sqds/multisig';
import { useQuery } from '@tanstack/react-query';
import { Connection, PublicKey, StakeProgram } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { useMultisigData } from './useMultisigData';
import { isDasRpc } from './useSettings';

/** Vault indices probed on the treasury board (plus the currently selected one). */
const PROBED_VAULT_INDICES = Array.from({ length: 16 }, (_, i) => i);

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const EPOCH_MAX = BigInt('18446744073709551615'); // u64::MAX sentinel for "not (de)activating"

export type TokenHolding = {
  mint: string;
  uiAmount: number;
  decimals: number;
  tokenAccount: string;
  /** Enriched by DAS when available. */
  symbol?: string;
  name?: string;
  logoUri?: string | null;
  priceUsd?: number | null;
  valueUsd?: number | null;
};

export type StakeHolding = {
  address: string;
  lamports: number;
  /** activating | active | deactivating | inactive */
  state: string;
  voter: string | null;
  deactivating: boolean;
};

export type VaultSnapshot = {
  index: number;
  address: string;
  lamports: number;
  /** null = RPC could not serve the query (unsupported/blocked), [] = none held. */
  tokens: TokenHolding[] | null;
  stakes: StakeHolding[] | null;
};

export type TreasurySnapshot = {
  vaults: VaultSnapshot[];
  /** SOL price in USD when the active RPC can supply it (DAS), else null. */
  solPriceUsd: number | null;
};

// ── Standard RPC: parsed token accounts ──────────────────────────────────────

async function fetchTokens(connection: Connection, owner: PublicKey): Promise<TokenHolding[] | null> {
  try {
    const [classic, t22] = await Promise.all([
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
    ]);
    return classic.value
      .concat(t22.value)
      .map((entry) => {
        const info = entry.account.data.parsed.info;
        return {
          mint: info.mint as string,
          uiAmount: (info.tokenAmount.uiAmount ?? 0) as number,
          decimals: info.tokenAmount.decimals as number,
          tokenAccount: entry.pubkey.toBase58(),
        };
      })
      .filter((t) => t.uiAmount > 0);
  } catch {
    return null;
  }
}

// ── Native stake accounts (manual decode; works on DAS + standard RPC) ───────

function decodeStakeAccount(data: Buffer, address: string, lamports: number): StakeHolding {
  const readU64 = (off: number) => data.readBigUInt64LE(off);
  // Authorized.withdrawer @44 (index 12..43 staker, 44..75 withdrawer).
  const hasStake = Number(readU64(120)) !== 0;
  if (!hasStake) {
    return { address, lamports, state: 'inactive', voter: null, deactivating: false };
  }
  // voter pubkey @128..159; activationEpoch @200; deactivationEpoch @208.
  const voter = new PublicKey(data.subarray(128, 160)).toBase58();
  const activation = readU64(200);
  const deactivation = readU64(208);
  void activation; // not needed for state beyond (de)activation sentinel checks
  const state = deactivation !== EPOCH_MAX ? 'deactivating' : 'active';
  return { address, lamports, state, voter, deactivating: state === 'deactivating' };
}

async function fetchStakes(
  connection: Connection,
  vault: PublicKey,
  endpoint: string
): Promise<StakeHolding[] | null> {
  const filters = [
    [{ dataSize: 200 }, { memcmp: { offset: 12, bytes: vault.toBase58() } }],
    [{ dataSize: 200 }, { memcmp: { offset: 44, bytes: vault.toBase58() } }],
  ];
  try {
    if (isDasRpc(endpoint)) {
      // DAS gateways don't serve getParsedProgramAccounts; use raw + manual decode.
      const seen = new Map<string, StakeHolding>();
      for (const flt of filters) {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'stakes',
            method: 'getProgramAccounts',
            params: [
              StakeProgram.programId.toBase58(),
              { encoding: 'base64', filters: flt },
            ],
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        for (const { pubkey, account } of json.result ?? []) {
          const buf = Buffer.from(account.data[0], 'base64');
          seen.set(pubkey, decodeStakeAccount(buf, pubkey, account.lamports));
        }
      }
      return [...seen.values()];
    }
    // Standard RPC: parsed layout.
    const [byStaker, byWithdrawer] = await Promise.all(
      filters.map((flt) =>
        connection.getParsedProgramAccounts(StakeProgram.programId, { filters: flt })
      )
    );
    const seen = new Map<string, StakeHolding>();
    for (const entry of byStaker.concat(byWithdrawer)) {
      const data = entry.account.data;
      if (Buffer.isBuffer(data)) continue;
      const delegation = data.parsed?.info?.stake?.delegation;
      const deact = delegation?.deactivationEpoch;
      const deactivating = deact != null && String(deact) !== String(EPOCH_MAX);
      seen.set(entry.pubkey.toBase58(), {
        address: entry.pubkey.toBase58(),
        lamports: entry.account.lamports,
        state: deactivating ? 'deactivating' : delegation ? 'active' : 'inactive',
        voter: (delegation?.voter as string) ?? null,
        deactivating,
      });
    }
    return [...seen.values()];
  } catch {
    return null;
  }
}

// ── DAS: fungible assets + SOL price ─────────────────────────────────────────

async function dasRpc(endpoint: string, method: string, params: unknown): Promise<any> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

async function fetchDasTokens(endpoint: string, owner: string): Promise<TokenHolding[] | null> {
  try {
    const result = await dasRpc(endpoint, 'getAssetsByOwner', {
      ownerAddress: owner,
      page: 1,
      limit: 1000,
      displayOptions: { showFungible: true, showNativeBalance: false },
    });
    const out: TokenHolding[] = [];
    for (const item of result?.items ?? []) {
      if (item.interface !== 'FungibleToken' && item.interface !== 'FungibleAsset') continue;
      const info = item.token_info;
      if (!info || typeof info.balance !== 'number' || typeof info.decimals !== 'number') continue;
      const uiAmount = info.balance / Math.pow(10, info.decimals);
      if (!(uiAmount > 0)) continue;
      const ppt = info.price_info?.price_per_token;
      const tot = info.price_info?.total_price;
      out.push({
        mint: item.id,
        uiAmount,
        decimals: info.decimals,
        tokenAccount: info.associated_token_address ?? '',
        symbol: info.symbol || item.content?.metadata?.symbol || undefined,
        name: item.content?.metadata?.name || undefined,
        logoUri:
          item.content?.links?.image ??
          item.content?.files?.find((f: any) => f.cdn_uri)?.cdn_uri ??
          null,
        priceUsd: typeof ppt === 'number' && isFinite(ppt) ? ppt : null,
        valueUsd: typeof tot === 'number' && isFinite(tot) ? tot : null,
      });
    }
    return out;
  } catch {
    return null;
  }
}

async function fetchSolPrice(endpoint: string): Promise<number | null> {
  try {
    const result = await dasRpc(endpoint, 'getAsset', { id: SOL_MINT });
    const p = result?.token_info?.price_info?.price_per_token;
    return typeof p === 'number' && isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * Enumerates the squad's vault accounts (indices 0–15 + the currently selected
 * index), then loads liquid balances, token holdings and native stake accounts
 * (vault PDA as staker/withdrawer) for each active vault. On a Helium DAS RPC
 * the token data carries real metadata + USD prices and the SOL price is read
 * from the wrapped-SOL asset.
 *
 * Purely read-only presentation data — no builders, no transactions.
 */
export const useTreasury = () => {
  const { connection, multisigAddress, programId, vaultIndex } = useMultisigData();
  const endpoint = connection.rpcEndpoint;
  const das = isDasRpc(endpoint);

  return useQuery({
    queryKey: ['treasury', multisigAddress, programId.toBase58(), endpoint, vaultIndex, das],
    queryFn: async (): Promise<TreasurySnapshot | null> => {
      if (!multisigAddress) return null;
      const multisigPda = new PublicKey(multisigAddress);

      const indices = [...new Set([...PROBED_VAULT_INDICES, vaultIndex])].sort((a, b) => a - b);
      const vaultPdas = indices.map(
        (index) => multisig.getVaultPda({ multisigPda, index, programId })[0]
      );

      let rpcFailures = 0;
      const balances = await Promise.all(
        vaultPdas.map((pda) =>
          connection.getBalance(pda).catch(() => {
            rpcFailures += 1;
            return 0;
          })
        )
      );
      if (rpcFailures === vaultPdas.length) throw new Error('RPC unreachable');

      const activeVaults = indices
        .map((index, i) => ({ index, pda: vaultPdas[i], lamports: balances[i] }))
        .filter((v) => v.lamports > 0);

      const solPriceUsd = das ? await fetchSolPrice(endpoint) : null;

      const vaults: VaultSnapshot[] = await Promise.all(
        activeVaults.map(async ({ index, pda, lamports }) => {
          const [tokens, stakes] = await Promise.all([
            das ? fetchDasTokens(endpoint, pda.toBase58()) : fetchTokens(connection, pda),
            fetchStakes(connection, pda, endpoint),
          ]);
          return { index, address: pda.toBase58(), lamports, tokens, stakes };
        })
      );

      return { vaults, solPriceUsd };
    },
    enabled: !!multisigAddress,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
};

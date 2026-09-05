import { Connection, PublicKey } from '@solana/web3.js';
import {
  decodeStakePool,
  STAKE_POOL_PROGRAM_ID,
  StakePoolState,
} from './jitoPool';

/**
 * Liquid staking providers supported for direct SOL deposits.
 *
 * Every entry was verified on-chain (2026-09-05):
 * - the pool account is a borsh StakePool (account type 1) whose layout our
 *   decoder reads, with the expected mint at the expected offset;
 * - a simulated DepositSol of 0.01 SOL from the squad vault succeeds.
 *
 * dSOL and bonkSOL live on Sanctum's deployment of the SPL stake pool program
 * (SP12tWFx…) — same account/instruction layout, different program id, which
 * is why the program is part of the config instead of a global constant.
 *
 * Pools on incompatible programs (Marinade mSOL, Sanctum-multi jupSOL, INF)
 * are deliberately absent: a deposit builder that cannot be simulation-proven
 * does not ship.
 */

export type LiquidPoolProvider = {
  /** Token symbol, e.g. "JitoSOL". */
  symbol: string;
  /** Display name, e.g. "Jito". */
  name: string;
  /** Pool token mint. */
  mint: string;
  /** Stake pool account address. */
  pool: string;
  /** Program that owns the pool account. */
  programId: string;
  /** Logo URL (from the Sanctum LST list). */
  logoUri: string;
};

const SPL = STAKE_POOL_PROGRAM_ID.toBase58();
const SANCTUM_SPL = 'SP12tWFxD9oJsVWNavTTBZvMbA6gkAmxtVgxdqvyvhY';

export const LIQUID_POOLS: LiquidPoolProvider[] = [
  {
    symbol: 'JitoSOL',
    name: 'Jito',
    mint: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
    pool: 'Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb',
    programId: SPL,
    logoUri: 'https://storage.googleapis.com/token-metadata/JitoSOL-256.png',
  },
  {
    symbol: 'bSOL',
    name: 'BlazeStake',
    mint: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
    pool: 'stk9ApL5HeVAwPLr3TLhDXdZS8ptVu7zp6ov8HFDuMi',
    programId: SPL,
    logoUri:
      'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1/logo.png',
  },
  {
    symbol: 'laineSOL',
    name: 'Laine',
    mint: 'LAinEtNLgpmCP9Rvsf5Hn8W6EhNiKLZQti1xfWMLy6X',
    pool: '2qyEeSAWKfU18AFthrF7JA8z8ZCi1yt76Tqs917vwQTV',
    programId: SPL,
    logoUri:
      'https://vvmbtadq63n53sdsqhlzbnzhvj5tdfp7moqixyv7rgkk6frqhqqq.arweave.net/rVgZgHD2293IcoHXkLcnqnsxlf9joIviv4mUrxYwPCE',
  },
  {
    symbol: 'dSOL',
    name: 'Drift',
    mint: 'Dso1bDeDjCQxTrWHqUUi63oBvV7Mdm6WaobLbQ7gnPQ',
    pool: '9mhGNSPArRMHpLDMSmxAvuoizBqtBGqYdT8WGuqgxNdn',
    programId: SANCTUM_SPL,
    logoUri: 'https://drift-public.s3.eu-central-1.amazonaws.com/dSOL.svg',
  },
  {
    symbol: 'bonkSOL',
    name: 'BONK',
    mint: 'BonK1YhkXEGLZzwtcvRTip3gAL9nCeQD7ppZBLXhtTs',
    pool: 'ArAQfbzsdotoKB5jJcZa3ajQrrPcWr2YQoDAEAiFxJAC',
    programId: SANCTUM_SPL,
    logoUri: 'https://arweave.net/ms-FdIyJ8TxEJOb2SAYhfyrLop7TDrCEjD-I-oIl5u4',
  },
];

/** Pool state per provider symbol; a provider is absent when its fetch failed. */
export type PoolStates = Map<string, StakePoolState>;

/**
 * Fetches and decodes all provider pool accounts in ONE RPC round-trip
 * (getMultipleAccountsInfo). Each account is owner-checked against its own
 * program id — a provider whose account is missing, has the wrong owner, or
 * fails to decode is simply omitted from the map.
 */
export async function fetchAllPoolStates(connection: Connection): Promise<PoolStates> {
  const accounts = await connection.getMultipleAccountsInfo(
    LIQUID_POOLS.map((p) => new PublicKey(p.pool))
  );
  const states: PoolStates = new Map();
  accounts.forEach((info, i) => {
    const provider = LIQUID_POOLS[i];
    try {
      if (!info || !info.owner.equals(new PublicKey(provider.programId))) return;
      const state = decodeStakePool(info.data);
      if (state.accountType !== 1) return;
      states.set(provider.symbol, state);
    } catch {
      // malformed account → provider treated as unavailable
    }
  });
  return states;
}

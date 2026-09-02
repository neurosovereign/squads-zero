import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

/**
 * Direct SOL deposit into an SPL stake pool (the Jito pool), minting pool
 * tokens (JitoSOL) at the pool's execution-time on-chain NAV. NOT a DEX swap:
 * proposals execute on stale quotes, a pool deposit needs no quote and has no
 * slippage.
 *
 * On-chain references (solana-program/stake-pool, verified 2026-09-03):
 * - `DepositSol` is variant index 14 of `StakePoolInstruction`
 *   (program/src/instruction.rs); data = [14] + lamports u64 LE (borsh).
 * - Account order (deposit_sol_internal in instruction.rs):
 *     0 [w]   stake pool
 *     1 []    stake pool withdraw authority (PDA, seeds [stake_pool, "withdraw"]
 *             — find_withdraw_authority_program_address in program/src/lib.rs)
 *     2 [w]   reserve stake account
 *     3 [s,w] funding account (the vault PDA; signs via the Squads CPI)
 *     4 [w]   destination pool-token account (the vault's JitoSOL ATA)
 *     5 [w]   manager fee account
 *     6 [w]   referral fee account (same as manager fee account when none)
 *     7 [w]   pool mint
 *     8 []    system program
 *     9 []    token program (from pool state — do NOT assume the classic one)
 *     10 [s]  (optional) sol deposit authority — only when set in pool state;
 *             deposits are then impossible for a vault, so we refuse to build.
 * - Mint math (process_deposit_sol in program/src/processor.rs):
 *     gross = total_lamports == 0 || pool_token_supply == 0
 *       ? lamports
 *       : floor(lamports * pool_token_supply / total_lamports)
 *     fee   = ceil(gross * sol_deposit_fee.numerator / sol_deposit_fee.denominator)
 *             (0 when denominator == 0)
 *     user receives gross - fee.
 *   The processor also rejects the deposit when last_update_epoch < current
 *   epoch (StakeListAndPoolOutOfDate) — the UI warns on that.
 */

/** SPL stake pool program (the only two hardcoded addresses). */
export const STAKE_POOL_PROGRAM_ID = new PublicKey('SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy');
export const JITO_STAKE_POOL_ADDRESS = new PublicKey('Jito4APyf642JPZPx3hGc6WWJ8zPKtRbRs4P815Awbb');

/** DepositSol variant index in StakePoolInstruction (borsh u8 discriminant). */
export const DEPOSIT_SOL_IX_TAG = 14;

export type Fee = { numerator: bigint; denominator: bigint };

/** Decoded SPL StakePool account (borsh layout, program/src/state.rs). */
export type StakePoolState = {
  accountType: number;
  manager: PublicKey;
  staker: PublicKey;
  stakeDepositAuthority: PublicKey;
  stakeWithdrawBumpSeed: number;
  validatorList: PublicKey;
  reserveStake: PublicKey;
  poolMint: PublicKey;
  managerFeeAccount: PublicKey;
  tokenProgramId: PublicKey;
  totalLamports: bigint;
  poolTokenSupply: bigint;
  lastUpdateEpoch: bigint;
  epochFee: Fee;
  stakeDepositFee: Fee;
  stakeWithdrawalFee: Fee;
  stakeReferralFee: number;
  solDepositAuthority: PublicKey | null;
  solDepositFee: Fee;
  solReferralFee: number;
  solWithdrawalFee: Fee;
  /** Bytes consumed by the decoder (the account may be padded beyond this). */
  decodedLength: number;
};

/** Minimal cursor over the account data — sequential borsh decode. */
class Reader {
  private offset = 0;
  constructor(private readonly data: Uint8Array) {}

  private take(n: number): Uint8Array {
    if (this.offset + n > this.data.length) {
      throw new Error(`Truncated stake pool account (need ${n} bytes at offset ${this.offset})`);
    }
    const slice = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  u8(): number {
    return this.take(1)[0];
  }

  u64(): bigint {
    const b = this.take(8);
    let v = BigInt(0);
    for (let i = 7; i >= 0; i--) v = (v << BigInt(8)) | BigInt(b[i]);
    return v;
  }

  i64(): bigint {
    const u = this.u64();
    return u >= BigInt(1) << BigInt(63) ? u - (BigInt(1) << BigInt(64)) : u;
  }

  pubkey(): PublicKey {
    return new PublicKey(this.take(32));
  }

  /** borsh Option<Pubkey>: u8 tag + optional 32-byte payload. */
  optionPubkey(): PublicKey | null {
    const tag = this.u8();
    if (tag === 0) return null;
    if (tag !== 1) throw new Error(`Invalid Option tag ${tag} in stake pool account`);
    return this.pubkey();
  }

  /** Fee { denominator: u64, numerator: u64 } — denominator FIRST in the layout. */
  fee(): Fee {
    const denominator = this.u64();
    const numerator = this.u64();
    return { numerator, denominator };
  }

  /** FutureEpoch<Fee>: u8 variant (0 None / 1 One / 2 Two) + optional Fee payload. */
  futureEpochFee(): void {
    const tag = this.u8();
    if (tag === 0) return;
    if (tag === 1 || tag === 2) {
      this.fee();
      return;
    }
    throw new Error(`Invalid FutureEpoch tag ${tag} in stake pool account`);
  }

  get length(): number {
    return this.offset;
  }
}

/**
 * Decodes a StakePool account. Throws on truncated/malformed data. Field order
 * and widths follow `pub struct StakePool` in program/src/state.rs:
 * account_type u8 | manager | staker | stake_deposit_authority |
 * stake_withdraw_bump_seed u8 | validator_list | reserve_stake | pool_mint |
 * manager_fee_account | token_program_id | total_lamports u64 |
 * pool_token_supply u64 | last_update_epoch u64 | lockup (i64, u64, pubkey) |
 * epoch_fee | next_epoch_fee FutureEpoch | preferred_deposit Option<Pubkey> |
 * preferred_withdraw Option<Pubkey> | stake_deposit_fee | stake_withdrawal_fee |
 * next_stake_withdrawal_fee FutureEpoch | stake_referral_fee u8 |
 * sol_deposit_authority Option<Pubkey> | sol_deposit_fee | sol_referral_fee u8 |
 * sol_withdraw_authority Option<Pubkey> | sol_withdrawal_fee |
 * next_sol_withdrawal_fee FutureEpoch | last_epoch_pool_token_supply u64 |
 * last_epoch_total_lamports u64.
 */
export function decodeStakePool(data: Uint8Array): StakePoolState {
  const r = new Reader(data);
  const accountType = r.u8();
  const manager = r.pubkey();
  const staker = r.pubkey();
  const stakeDepositAuthority = r.pubkey();
  const stakeWithdrawBumpSeed = r.u8();
  const validatorList = r.pubkey();
  const reserveStake = r.pubkey();
  const poolMint = r.pubkey();
  const managerFeeAccount = r.pubkey();
  const tokenProgramId = r.pubkey();
  const totalLamports = r.u64();
  const poolTokenSupply = r.u64();
  const lastUpdateEpoch = r.u64();
  r.i64(); // lockup.unix_timestamp
  r.u64(); // lockup.epoch
  r.pubkey(); // lockup.custodian
  const epochFee = r.fee();
  r.futureEpochFee(); // next_epoch_fee
  r.optionPubkey(); // preferred_deposit_validator_vote_address
  r.optionPubkey(); // preferred_withdraw_validator_vote_address
  const stakeDepositFee = r.fee();
  const stakeWithdrawalFee = r.fee();
  r.futureEpochFee(); // next_stake_withdrawal_fee
  const stakeReferralFee = r.u8();
  const solDepositAuthority = r.optionPubkey();
  const solDepositFee = r.fee();
  const solReferralFee = r.u8();
  r.optionPubkey(); // sol_withdraw_authority
  const solWithdrawalFee = r.fee();
  r.futureEpochFee(); // next_sol_withdrawal_fee
  r.u64(); // last_epoch_pool_token_supply
  r.u64(); // last_epoch_total_lamports
  return {
    accountType,
    manager,
    staker,
    stakeDepositAuthority,
    stakeWithdrawBumpSeed,
    validatorList,
    reserveStake,
    poolMint,
    managerFeeAccount,
    tokenProgramId,
    totalLamports,
    poolTokenSupply,
    lastUpdateEpoch,
    epochFee,
    stakeDepositFee,
    stakeWithdrawalFee,
    stakeReferralFee,
    solDepositAuthority,
    solDepositFee,
    solReferralFee,
    solWithdrawalFee,
    decodedLength: r.length,
  };
}

/**
 * Fetches and decodes a stake pool account, verifying the owner is the stake
 * pool program and the account type is StakePool (1).
 */
export async function fetchStakePool(
  connection: Connection,
  stakePoolAddress: PublicKey = JITO_STAKE_POOL_ADDRESS,
  programId: PublicKey = STAKE_POOL_PROGRAM_ID
): Promise<StakePoolState> {
  const info = await connection.getAccountInfo(stakePoolAddress);
  if (!info) throw new Error(`Stake pool account ${stakePoolAddress.toBase58()} not found`);
  if (!info.owner.equals(programId)) {
    throw new Error(
      `Stake pool account is owned by ${info.owner.toBase58()}, expected ${programId.toBase58()}`
    );
  }
  const state = decodeStakePool(info.data);
  if (state.accountType !== 1) {
    throw new Error(`Stake pool account type ${state.accountType}, expected 1 (StakePool)`);
  }
  return state;
}

/**
 * The pool's withdraw-authority PDA: seeds [stake_pool_address, "withdraw"]
 * (find_withdraw_authority_program_address in program/src/lib.rs).
 */
export function getStakePoolWithdrawAuthority(
  stakePoolAddress: PublicKey,
  programId: PublicKey = STAKE_POOL_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [stakePoolAddress.toBuffer(), Buffer.from('withdraw')],
    programId
  )[0];
}

/**
 * The exact on-chain mint math of process_deposit_sol (see header comment).
 * Returns gross pool tokens for `lamports`, the deposit fee taken in pool
 * tokens, and the net amount the depositor receives.
 */
export function estimateDeposit(
  state: StakePoolState,
  lamports: bigint
): { gross: bigint; fee: bigint; net: bigint } {
  const gross =
    state.totalLamports === BigInt(0) || state.poolTokenSupply === BigInt(0)
      ? lamports
      : (lamports * state.poolTokenSupply) / state.totalLamports;
  let fee = BigInt(0);
  const { numerator, denominator } = state.solDepositFee;
  if (denominator !== BigInt(0) && gross !== BigInt(0)) {
    // ceiling division, mirroring Fee::apply in state.rs
    fee = (gross * numerator + denominator - BigInt(1)) / denominator;
  }
  return { gross, fee, net: gross - fee };
}

/** SOL per pool token (the pool NAV), e.g. ~1.30 for JitoSOL. */
export function solPerPoolToken(state: StakePoolState): number {
  if (state.poolTokenSupply === BigInt(0)) return 1;
  return Number(state.totalLamports) / Number(state.poolTokenSupply);
}

/** Fee as a human percentage string; 0 denominator renders as "0%". */
export function formatFeePercent(fee: Fee): string {
  if (fee.denominator === BigInt(0) || fee.numerator === BigInt(0)) return '0%';
  const pct = (Number(fee.numerator) / Number(fee.denominator)) * 100;
  return `${pct.toLocaleString(undefined, { maximumFractionDigits: 4 })}%`;
}

export type BuildJitoDepositParams = {
  /** The vault PDA that funds the deposit and receives the pool tokens. */
  vaultPubkey: PublicKey;
  /** Lamports of SOL to deposit. */
  lamports: bigint;
  /** Decoded on-chain pool state (all pool accounts are taken from here). */
  poolState: StakePoolState;
  stakePoolAddress?: PublicKey;
  stakePoolProgramId?: PublicKey;
};

/**
 * Builds the 2 instructions for converting vault SOL into pool tokens:
 *   1. createAssociatedTokenAccountIdempotent — the vault's pool-token ATA
 *      (payer = vault PDA; ATAs for off-curve owners are fine; idempotent so a
 *      repeat proposal after an earlier deposit does not fail).
 *   2. DepositSol — funding account = vault PDA (signs via the Squads CPI),
 *      destination = the vault's ATA, mints at execution-time on-chain NAV.
 * Throws when the pool has a sol_deposit_authority set (deposits would need
 * that signature, which a vault cannot produce).
 */
export function buildJitoDepositInstructions(params: BuildJitoDepositParams): {
  instructions: TransactionInstruction[];
  poolTokenAta: PublicKey;
} {
  const {
    vaultPubkey,
    lamports,
    poolState,
    stakePoolAddress = JITO_STAKE_POOL_ADDRESS,
    stakePoolProgramId = STAKE_POOL_PROGRAM_ID,
  } = params;

  if (lamports <= BigInt(0)) throw new Error('Deposit amount must be > 0');
  if (poolState.solDepositAuthority) {
    throw new Error(
      `This pool requires the sol deposit authority ${poolState.solDepositAuthority.toBase58()} to sign — a vault cannot deposit`
    );
  }

  const poolTokenAta = getAssociatedTokenAddressSync(
    poolState.poolMint,
    vaultPubkey,
    true, // allowOwnerOffCurve — the vault is a PDA
    poolState.tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    vaultPubkey,
    poolTokenAta,
    vaultPubkey,
    poolState.poolMint,
    poolState.tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID
  );

  const data = Buffer.alloc(9);
  data.writeUInt8(DEPOSIT_SOL_IX_TAG, 0);
  data.writeBigUInt64LE(lamports, 1);

  const depositIx = new TransactionInstruction({
    programId: stakePoolProgramId,
    keys: [
      { pubkey: stakePoolAddress, isSigner: false, isWritable: true },
      {
        pubkey: getStakePoolWithdrawAuthority(stakePoolAddress, stakePoolProgramId),
        isSigner: false,
        isWritable: false,
      },
      { pubkey: poolState.reserveStake, isSigner: false, isWritable: true },
      { pubkey: vaultPubkey, isSigner: true, isWritable: true },
      { pubkey: poolTokenAta, isSigner: false, isWritable: true },
      { pubkey: poolState.managerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.managerFeeAccount, isSigner: false, isWritable: true },
      { pubkey: poolState.poolMint, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: poolState.tokenProgramId, isSigner: false, isWritable: false },
    ],
    data,
  });

  return { instructions: [createAtaIx, depositIx], poolTokenAta };
}

/**
 * Simulates the INNER vault-transaction instructions (payer = the vault PDA,
 * signatures not verified — the vault only ever signs via the Squads CPI) and
 * throws with the program logs on error. This is the pre-proposal check shown
 * before the wallet prompt: if the pool state changed in a way that breaks the
 * deposit (fee account rotated, stale epoch, insufficient vault balance), the
 * operator sees it here instead of in a failed on-chain execution.
 * NOTE: like simulateTx in spendingLimits.ts, the check is `value.err`.
 */
export async function simulateVaultInstructions(
  connection: Connection,
  instructions: TransactionInstruction[],
  vaultPubkey: PublicKey
): Promise<void> {
  const blockhash = (await connection.getLatestBlockhash()).blockhash;
  const message = new TransactionMessage({
    instructions,
    payerKey: vaultPubkey,
    recentBlockhash: blockhash,
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  const simulation = await connection.simulateTransaction(transaction, {
    sigVerify: false,
    replaceRecentBlockhash: true,
  });
  if (simulation.value.err) {
    const logs = (simulation.value.logs ?? []).join('\n');
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}${logs ? `\n${logs}` : ''}`
    );
  }
}

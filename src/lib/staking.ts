import {
  PublicKey,
  StakeProgram,
  SystemProgram,
  TransactionInstruction,
} from '@solana/web3.js';

/** Size of a stake account in bytes (StakeStateV2). */
export const STAKE_ACCOUNT_SPACE = 200;

export type BuildStakeParams = {
  /** The vault PDA that funds, owns and authorizes the stake account. */
  vaultPubkey: PublicKey;
  /** Seed for the stake account address, max 32 chars (e.g. `stake-20260901`). */
  seed: string;
  /** Total lamports for the new account: stake amount + rent-exempt minimum for 200 bytes. */
  lamports: number;
  /** Validator vote account to delegate to. */
  votePubkey: PublicKey;
};

/**
 * Builds the 3 instructions for staking from a vault:
 *   1. SystemProgram.createAccountWithSeed — inside a vault transaction only the
 *      vault PDA can sign, so the stake account must be derived with-seed from the
 *      vault (base = vault), not from a fresh keypair.
 *   2. StakeProgram.initialize — staker = withdrawer = vault PDA.
 *   3. StakeProgram.delegate — to the validator's vote account, authorized by the vault.
 */
export async function buildStakeInstructions(params: BuildStakeParams): Promise<{
  instructions: TransactionInstruction[];
  stakeAddress: PublicKey;
}> {
  const { vaultPubkey, seed, lamports, votePubkey } = params;

  if (seed.length === 0 || seed.length > 32) {
    throw new Error('Seed must be between 1 and 32 characters');
  }

  const stakeAddress = await PublicKey.createWithSeed(vaultPubkey, seed, StakeProgram.programId);

  const createIx = SystemProgram.createAccountWithSeed({
    fromPubkey: vaultPubkey,
    newAccountPubkey: stakeAddress,
    basePubkey: vaultPubkey,
    seed,
    lamports,
    space: STAKE_ACCOUNT_SPACE,
    programId: StakeProgram.programId,
  });

  const initializeIx = StakeProgram.initialize({
    stakePubkey: stakeAddress,
    authorized: { staker: vaultPubkey, withdrawer: vaultPubkey },
  });

  const delegateIx = StakeProgram.delegate({
    stakePubkey: stakeAddress,
    authorizedPubkey: vaultPubkey,
    votePubkey,
  }).instructions[0];

  return { instructions: [createIx, initializeIx, delegateIx], stakeAddress };
}

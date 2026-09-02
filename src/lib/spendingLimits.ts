import * as multisig from '@sqds/multisig';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import bs58 from 'bs58';

export type SpendingLimitEntry = {
  publicKey: PublicKey;
  account: multisig.accounts.SpendingLimit;
};

/**
 * Lists all SpendingLimit accounts of a multisig.
 * The SDK has no list helper, so we scan program accounts with two memcmp
 * filters: the 8-byte SpendingLimit discriminator at offset 0 and the multisig
 * pubkey at offset 8 (the first field after the discriminator). The
 * discriminator filter matters because Proposal/VaultTransaction/etc. also
 * carry the multisig pubkey at offset 8 and the solita deserializer does NOT
 * validate it — without the filter those would decode into garbage limits.
 * No dataSize filter: the account size varies with members/destinations vecs.
 */
export async function fetchSpendingLimits(
  connection: Connection,
  multisigPda: PublicKey,
  programId: PublicKey = multisig.PROGRAM_ID
): Promise<SpendingLimitEntry[]> {
  const accounts = await connection.getProgramAccounts(programId, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(Buffer.from(multisig.accounts.spendingLimitDiscriminator)),
        },
      },
      {
        memcmp: {
          offset: 8,
          bytes: multisigPda.toBase58(),
        },
      },
    ],
  });

  const limits: SpendingLimitEntry[] = [];
  for (const { pubkey, account } of accounts) {
    try {
      limits.push({ publicKey: pubkey, account: multisig.accounts.SpendingLimit.fromAccountInfo(account)[0] });
    } catch {
      // skip undecodable entries
    }
  }
  return limits;
}

export type BuildAddLimitParams = {
  multisigPda: PublicKey;
  configAuthority: PublicKey;
  vaultIndex: number;
  mint: PublicKey;
  amountLamports: bigint;
  period: (typeof multisig.types.Period)[keyof typeof multisig.types.Period];
  members: PublicKey[];
  destinations: PublicKey[];
  memo?: string;
  recentBlockhash: string;
  programId?: PublicKey;
};

/**
 * Builds a legacy Transaction adding a spending limit, signed directly by the
 * config authority (no proposal). The createKey is a random pubkey — it only
 * seeds the limit PDA and never signs.
 */
export function buildAddLimitTx(params: BuildAddLimitParams): {
  transaction: Transaction;
  spendingLimitPda: PublicKey;
} {
  const {
    multisigPda,
    configAuthority,
    vaultIndex,
    mint,
    amountLamports,
    period,
    members,
    destinations,
    memo,
    recentBlockhash,
    programId,
  } = params;

  const createKey = Keypair.generate().publicKey;
  const [spendingLimitPda] = multisig.getSpendingLimitPda({ multisigPda, createKey, programId });

  const ix = multisig.instructions.multisigAddSpendingLimit({
    multisigPda,
    configAuthority,
    spendingLimit: spendingLimitPda,
    rentPayer: configAuthority,
    createKey,
    vaultIndex,
    mint,
    amount: amountLamports,
    period,
    members,
    destinations,
    memo,
    programId,
  });

  const transaction = new Transaction().add(ix);
  transaction.feePayer = configAuthority;
  transaction.recentBlockhash = recentBlockhash;
  return { transaction, spendingLimitPda };
}

export type BuildRemoveLimitParams = {
  multisigPda: PublicKey;
  configAuthority: PublicKey;
  spendingLimit: PublicKey;
  rentCollector: PublicKey;
  recentBlockhash: string;
  programId?: PublicKey;
};

/**
 * Builds a legacy Transaction removing a spending limit, signed directly by
 * the config authority. The account's rent lamports go to `rentCollector`
 * (the multisig's rent collector, vault 0 in production).
 */
export function buildRemoveLimitTx(params: BuildRemoveLimitParams): Transaction {
  const { multisigPda, configAuthority, spendingLimit, rentCollector, recentBlockhash, programId } =
    params;

  const ix = multisig.instructions.multisigRemoveSpendingLimit({
    multisigPda,
    configAuthority,
    spendingLimit,
    rentCollector,
    programId,
  });

  const transaction = new Transaction().add(ix);
  transaction.feePayer = configAuthority;
  transaction.recentBlockhash = recentBlockhash;
  return transaction;
}

/**
 * Simulates a legacy transaction and throws with the program logs on error.
 * NOTE: the RPC result shape is { context, value: { err, logs } } — check
 * `simulation.value.err`, NOT `simulation.err` (always undefined).
 */
export async function simulateTx(connection: Connection, tx: Transaction): Promise<void> {
  const simulation = await connection.simulateTransaction(tx);
  if (simulation.value.err) {
    const logs = (simulation.value.logs ?? []).join('\n');
    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(simulation.value.err)}${logs ? `\n${logs}` : ''}`
    );
  }
}

/** The native mint is represented by the default (all-ones) pubkey. */
export function isNativeMint(mint: PublicKey): boolean {
  return mint.equals(PublicKey.default);
}

export function formatPeriod(period: number): string {
  return multisig.types.Period[period as (typeof multisig.types.Period)[keyof typeof multisig.types.Period]] ?? `Unknown(${period})`;
}

/** Formats a base-unit amount; native mint is rendered as SOL. */
export function formatLimitAmount(amount: bigint, native: boolean): string {
  if (!native) return amount.toString();
  const sol = Number(amount) / 1e9;
  return `${sol.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

export function formatLastReset(lastReset: bigint): string {
  if (lastReset === BigInt(0)) return 'never';
  return new Date(Number(lastReset) * 1000).toLocaleString();
}

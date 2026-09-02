import * as multisig from '@sqds/multisig';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

/** Permission bits, tied to the SDK constants: Initiate=1, Vote=2, Execute=4. */
export const PERMISSION_BITS = [
  { name: 'Initiate', mask: multisig.types.Permission.Initiate },
  { name: 'Vote', mask: multisig.types.Permission.Vote },
  { name: 'Execute', mask: multisig.types.Permission.Execute },
] as const;

/** Names of the permission bits set in `mask`, in Initiate/Vote/Execute order. */
export function maskToPermissionNames(mask: number): string[] {
  return PERMISSION_BITS.filter((p) => (mask & p.mask) === p.mask).map((p) => p.name);
}

/** Renders a mask as "Initiate+Vote+Execute" (or "None" for 0). */
export function formatPermissionsMask(mask: number): string {
  return maskToPermissionNames(mask).join('+') || 'None';
}

/** SDK Multisig['members'] entry shape. */
export type MemberPermissionsEntry = {
  key: PublicKey;
  permissions: { mask: number };
};

export type PlanSetMemberPermissionsParams = {
  memberKey: PublicKey;
  isExistingMember: boolean;
  currentMembers?: MemberPermissionsEntry[];
  /** Key used for the temporary member when the sandwich is needed; random when omitted. */
  tempMemberKey?: PublicKey;
};

export type SetMemberPermissionsPlan = {
  /** True when the tx must be the 4-instruction temporary-member sandwich. */
  needsTempMember: boolean;
  /** The temporary member key (set iff needsTempMember). */
  tempMemberKey: PublicKey | null;
  /** Permission bits the temporary member must hold (set iff needsTempMember). */
  tempMemberMask: number;
};

/**
 * Plans the instruction sequence for a permissions change.
 *
 * Squads v4 has NO change-permissions instruction: changing an existing
 * member's permissions is a multisigRemoveMember + multisigAddMember pair,
 * atomic in ONE transaction. For a brand-new member it's the add alone.
 *
 * Wrinkle enforced ON-CHAIN: the multisig must always include at least one
 * member holding Initiate, one holding Vote and one holding Execute
 * (MultisigError::NoProposers 6017 / NoVoters 6016 / NoExecutors 6018, thrown
 * by the invariant multisig.remove_member runs). The invariant is checked PER
 * INSTRUCTION, so when removing memberKey would leave one of those roles
 * uncovered, the plain remove fails even though the re-add follows in the same
 * tx. The canonical fix is a temporary member holding exactly the bits that
 * would be lost, keeping the invariant satisfied inside the atomic tx:
 *
 *   [addMember(temp, missingBits), removeMember(member), addMember(member, newMask), removeMember(temp)]
 *
 * The temp key never signs anything and is gone within the same transaction.
 * When the removal leaves all three roles covered, the plain [remove, add]
 * pair is used.
 */
export function planSetMemberPermissions(
  params: PlanSetMemberPermissionsParams
): SetMemberPermissionsPlan {
  const { memberKey, isExistingMember, currentMembers, tempMemberKey } = params;
  const noTemp = { needsTempMember: false, tempMemberKey: null, tempMemberMask: 0 };
  if (isExistingMember && currentMembers) {
    const remaining = currentMembers.filter((m) => !m.key.equals(memberKey));
    const remainingMask = remaining.reduce((acc, m) => acc | m.permissions.mask, 0);
    const missingBits = ~remainingMask & 0b111;
    if (missingBits !== 0) {
      return {
        needsTempMember: true,
        tempMemberKey: tempMemberKey ?? Keypair.generate().publicKey,
        tempMemberMask: missingBits,
      };
    }
  }
  return noTemp;
}

export type BuildSetMemberPermissionsParams = PlanSetMemberPermissionsParams & {
  multisigPda: PublicKey;
  configAuthority: PublicKey;
  permissionsMask: number;
  recentBlockhash: string;
  programId?: PublicKey;
};

/**
 * Roles the FINAL member set would lack after the change: bits of
 * Initiate|Vote|Execute not covered by (remaining members | newMask). 0 = valid.
 * The on-chain invariant (checked per instruction) requires all three roles to
 * stay covered, so a non-zero result means the change is impossible as asked.
 */
export function findFinalMissingRoles(
  currentMembers: MemberPermissionsEntry[],
  memberKey: PublicKey,
  newMask: number
): number {
  const remaining = currentMembers.filter((m) => !m.key.equals(memberKey));
  const remainingMask = remaining.reduce((acc, m) => acc | m.permissions.mask, 0);
  return ~(remainingMask | newMask) & 0b111;
}

/**
 * Builds a legacy Transaction setting a member's permissions, signed directly
 * by the config authority (no proposal — takes effect immediately). See
 * planSetMemberPermissions for the instruction sequence.
 *
 * The remove uses the low-level generated instruction because the high-level
 * SDK wrapper doesn't pass the optional `rentPayer` account — we set it to the
 * config authority so the lamports freed by the multisig-account shrink are
 * credited back to the operator (the IDL names this account `rentPayer`:
 * "charged or credited in case the multisig account needs to reallocate
 * space"). The add's `rentPayer` is the config authority for the same reason
 * (it pays for the grow).
 */
export function buildSetMemberPermissionsTx(params: BuildSetMemberPermissionsParams): Transaction {
  const {
    multisigPda,
    configAuthority,
    memberKey,
    permissionsMask,
    isExistingMember,
    recentBlockhash,
    programId,
  } = params;

  if (permissionsMask < 1 || permissionsMask > 7) {
    throw new Error(`Invalid permissions mask ${permissionsMask} (must be 1-7)`);
  }

  const { needsTempMember, tempMemberKey, tempMemberMask } = planSetMemberPermissions(params);

  // The FINAL member set must keep all three roles covered too — fail fast at
  // build time instead of dying in simulation (only checkable with the roster).
  if (isExistingMember && params.currentMembers) {
    const finalMissing = findFinalMissingRoles(params.currentMembers, memberKey, permissionsMask);
    if (finalMissing !== 0) {
      throw new Error(
        `Resulting multisig would have no member holding ${formatPermissionsMask(finalMissing)} ` +
          `(the program requires at least one Initiate, one Vote and one Execute holder)`
      );
    }
  }

  const addMemberIx = (key: PublicKey, mask: number) =>
    multisig.instructions.multisigAddMember({
      multisigPda,
      configAuthority,
      rentPayer: configAuthority,
      newMember: { key, permissions: { mask } },
      programId,
    });

  const removeMemberIx = (key: PublicKey) =>
    multisig.generated.createMultisigRemoveMemberInstruction(
      {
        multisig: multisigPda,
        configAuthority,
        rentPayer: configAuthority,
        systemProgram: SystemProgram.programId,
      },
      { args: { oldMember: key, memo: null } },
      programId
    );

  const instructions = [];
  if (needsTempMember && tempMemberKey) {
    instructions.push(addMemberIx(tempMemberKey, tempMemberMask));
  }
  if (isExistingMember) {
    instructions.push(removeMemberIx(memberKey));
  }
  instructions.push(addMemberIx(memberKey, permissionsMask));
  if (needsTempMember && tempMemberKey) {
    instructions.push(removeMemberIx(tempMemberKey));
  }

  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = configAuthority;
  transaction.recentBlockhash = recentBlockhash;
  return transaction;
}

export type DescribeSetMemberPermissionsParams = {
  memberKey: PublicKey;
  /** Current mask of the member; required when isExistingMember is true. */
  oldMask?: number;
  newMask: number;
  isExistingMember: boolean;
  needsTempMember?: boolean;
  tempMemberMask?: number;
};

/**
 * Plain-English one-liner of exactly what the transaction does — shown to the
 * operator before the (blind-signing Ledger) wallet prompt.
 */
export function describeSetMemberPermissions(
  params: DescribeSetMemberPermissionsParams
): string {
  const { memberKey, oldMask, newMask, isExistingMember, needsTempMember, tempMemberMask } = params;
  if (isExistingMember) {
    const from = oldMask !== undefined ? `${formatPermissionsMask(oldMask)} (mask ${oldMask})` : '?';
    const mechanism = needsTempMember
      ? `remove+re-add via a temporary member holding ${formatPermissionsMask(tempMemberMask ?? 0)} (added and removed in the same transaction)`
      : 'remove+re-add';
    return (
      `Member ${memberKey.toBase58()}: permissions ${from} → ` +
      `${formatPermissionsMask(newMask)} (mask ${newMask}) — ${mechanism}, atomic in one transaction`
    );
  }
  return `Add new member ${memberKey.toBase58()} with ${formatPermissionsMask(newMask)} (mask ${newMask})`;
}

import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useMultisigAddress } from './useMultisigAddress';

/**
 * Local, per-browser member labels. The Squads v4 protocol has no on-chain
 * naming, so names live in localStorage keyed by multisig -> member pubkey.
 * They never leave the device and are cosmetic only.
 */

const STORAGE_KEY = 'x-member-names';

type MemberNameMap = Record<string, Record<string, string>>;

const readAll = (): MemberNameMap => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (map: MemberNameMap) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
};

/** Names for one multisig, or {} when unset / bad storage. */
export const getMemberNames = (multisigAddress: string | null): Record<string, string> => {
  if (!multisigAddress) return {};
  return readAll()[multisigAddress] ?? {};
};

/** Display label for a member key: stored name, else null. */
export const memberNameOf = (
  names: Record<string, string>,
  memberKey: string
): string | null => {
  const n = names[memberKey];
  return n && n.trim().length > 0 ? n.trim() : null;
};

export const useMemberNames = () => {
  const { multisigAddress } = useMultisigAddress();
  const queryClient = useQueryClient();

  const { data: names } = useSuspenseQuery({
    queryKey: ['memberNames', multisigAddress ?? ''],
    queryFn: async () => getMemberNames(multisigAddress),
  });

  const setMemberName = useMutation({
    mutationFn: async ({ memberKey, name }: { memberKey: string; name: string | null }) => {
      if (!multisigAddress) return;
      const all = readAll();
      const scoped = { ...(all[multisigAddress] ?? {}) };
      const trimmed = name?.trim() ?? '';
      if (trimmed.length > 0) scoped[memberKey] = trimmed.slice(0, 32);
      else delete scoped[memberKey];
      if (Object.keys(scoped).length > 0) all[multisigAddress] = scoped;
      else delete all[multisigAddress];
      writeAll(all);
      return scoped;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memberNames', multisigAddress ?? ''] });
    },
  });

  return { names: names ?? {}, setMemberName };
};

import { useQuery } from '@tanstack/react-query';

/**
 * Validator registry data from StakeWiz — a free, public API providing the
 * off-chain bits the chain itself doesn't carry: names, icons and APY
 * estimates. Keyed by vote-account (vote_identity), which matches the vote
 * account in the on-chain getVoteAccounts data.
 *
 * Purely presentational enrichment: the staking transactions never depend on
 * this. When unreachable, callers fall back to address-only cards.
 */

const STAKEWIZ_URL = 'https://api.stakewiz.com/validators';

export type ValidatorInfo = {
  /** On-chain vote account — the join key. */
  voteIdentity: string;
  name: string;
  /** Icon URL on StakeWiz's CDN, null when none. */
  image: string | null;
  /** Commission in percent (raw basis points / 100). */
  commission: number;
  /** Activated stake in SOL. */
  activatedStakeSol: number;
  /**
   * Realized total APY in percent: native staking_apy + jito_apy (MEV).
   * This is what the official Squads UI shows — per-validator and typically
   * ~5-6%. We deliberately do NOT use StakeWiz's apy_estimate, which is a
   * score-based projection that is nearly identical across top validators.
   */
  apy: number | null;
  delinquent: boolean;
  website: string | null;
};

type StakewizRaw = {
  vote_identity?: string;
  name?: string;
  image?: string | null;
  commission?: number;
  activated_stake?: number;
  staking_apy?: number;
  jito_apy?: number;
  total_apy?: number;
  delinquent?: boolean;
  website?: string | null;
};

const fetchValidators = async (): Promise<Map<string, ValidatorInfo>> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(STAKEWIZ_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`StakeWiz ${res.status}`);
    const json = (await res.json()) as StakewizRaw[];
    const map = new Map<string, ValidatorInfo>();
    for (const v of json ?? []) {
      if (!v.vote_identity) continue;
      const staking = typeof v.staking_apy === 'number' ? v.staking_apy : null;
      const jito = typeof v.jito_apy === 'number' ? v.jito_apy : null;
      const apy =
        staking !== null
          ? staking + (jito ?? 0)
          : typeof v.total_apy === 'number'
            ? v.total_apy
            : null;
      map.set(v.vote_identity, {
        voteIdentity: v.vote_identity,
        name: v.name || '',
        image: v.image ?? null,
        commission: typeof v.commission === 'number' ? v.commission / 100 : 0,
        activatedStakeSol: typeof v.activated_stake === 'number' ? v.activated_stake : 0,
        apy,
        delinquent: !!v.delinquent,
        website: v.website ?? null,
      });
    }
    return map;
  } finally {
    clearTimeout(timer);
  }
};

export const useValidators = () =>
  useQuery({
    queryKey: ['stakewiz-validators'],
    queryFn: fetchValidators,
    staleTime: 30 * 60_000,
    refetchInterval: 60 * 60_000,
    retry: 1,
  });

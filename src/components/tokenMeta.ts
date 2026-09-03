/** Display metadata for common mainnet mints. Unknown mints fall back to a truncated address. */
export const KNOWN_TOKENS: Record<string, { symbol: string; name: string }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Wrapped SOL' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether USD' },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'JitoSOL', name: 'Jito Staked SOL' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KAKFRvVN8WzP8T: { symbol: 'mSOL', name: 'Marinade Staked SOL' },
  jupSoLaHXQiZZTSfEWMTRwgpnyFm8f6sZGsWBbgCfkKU: { symbol: 'jupSOL', name: 'Jupiter Staked SOL' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter' },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', name: 'Bonk' },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3qRK6R': { symbol: 'RAY', name: 'Raydium' },
  bSo13r4TkiE4KumLidLsHNFZCLsxa1oLaTZkjCkrwzT: { symbol: 'bSOL', name: 'BlazeStake Staked SOL' },
};

export const tokenSymbol = (mint: string): string =>
  KNOWN_TOKENS[mint]?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`;

export const truncateAddress = (address: string, chars = 4): string =>
  `${address.slice(0, chars)}…${address.slice(-chars)}`;

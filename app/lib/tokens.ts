/**
 * Known Stellar tokens with their SAC contract IDs and metadata.
 *
 * The curated default list is keyed by network — each token stores its issuer
 * (G-address) and the SAC contract ID is *derived at runtime* for the active
 * network, so the same list works on testnet and mainnet automatically.
 *
 * Icons auto-loaded from Stellar Expert — covers all indexed Stellar tokens.
 * Falls back to a first-letter avatar for any token not indexed.
 */

import { Asset, Networks } from '@stellar/stellar-sdk';

export interface StellarToken {
  code: string;
  name: string;
  issuer: string;
  sacId: string;
  decimals: number;
}

const NETWORK: 'mainnet' | 'testnet' =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
const PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

// XLM is native (no issuer) — use CoinMarketCap which has the proper Stellar logo
export const XLM_ICON = 'https://s2.coinmarketcap.com/static/img/coins/64x64/512.png';

// Stellar Expert pattern — works for any token they've indexed
export const stellarExpertIcon = (code: string, issuer: string) =>
  `https://stellar.expert/img/assets/${code}-${issuer}.png`;

interface TokenDef { code: string; name: string; issuer: string; decimals: number; }

// Curated defaults per network. Issuer is the classic asset issuer; the SAC
// contract ID is derived below for whichever network is active.
const DEFAULTS: Record<'mainnet' | 'testnet', TokenDef[]> = {
  mainnet: [
    { code: 'USDC', name: 'USD Coin', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN', decimals: 7 },
    { code: 'EURC', name: 'Euro Coin', issuer: 'GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2', decimals: 7 },
    { code: 'AQUA', name: 'Aquarius', issuer: 'GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA', decimals: 7 },
    { code: 'yXLM', name: 'Yield XLM', issuer: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55', decimals: 7 },
  ],
  testnet: [
    // Circle's testnet USDC issuer
    { code: 'USDC', name: 'USD Coin', issuer: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5', decimals: 7 },
  ],
};

// CoinGecko price IDs for tokens we can value. yXLM tracks XLM; USDC is a
// USD stablecoin. Tokens not listed here have no price and show "—".
export const TOKEN_PRICE_IDS: Record<string, string> = {
  XLM: 'stellar',
  USDC: 'usd-coin',
  EURC: 'euro-coin',
  AQUA: 'aquarius',
  yXLM: 'stellar',
};

function deriveSac(code: string, issuer: string): string {
  return new Asset(code, issuer).contractId(PASSPHRASE);
}

export const STELLAR_TOKENS: StellarToken[] = DEFAULTS[NETWORK].map(t => ({
  code: t.code,
  name: t.name,
  issuer: t.issuer,
  decimals: t.decimals,
  sacId: deriveSac(t.code, t.issuer),
}));

/** Generate a colored first-letter SVG avatar for tokens not indexed by Stellar Expert. */
export function tokenLetterAvatar(code: string): string {
  const colors = [
    '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
    '#ef4444', '#06b6d4', '#84cc16', '#f97316',
  ];
  const color = colors[code.charCodeAt(0) % colors.length];
  const letter = code.charAt(0).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><circle cx="18" cy="18" r="18" fill="${color}"/><text x="18" y="23" text-anchor="middle" font-family="system-ui,sans-serif" font-size="16" font-weight="700" fill="white">${letter}</text></svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

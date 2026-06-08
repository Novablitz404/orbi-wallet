// ── network preference (testnet ↔ mainnet toggle) ──
//
// Persisted client-side so the user can switch networks without an env
// rebuild. Falls back to the build-time env var (and 'testnet') when nothing
// is stored yet, or when read during SSR (no localStorage).

const NETWORK_KEY = 'orbi_network';

export type StellarNetwork = 'testnet' | 'mainnet';

function defaultNetwork(): StellarNetwork {
  return process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet';
}

export function getNetworkPreference(): StellarNetwork {
  if (typeof window === 'undefined') return defaultNetwork();
  const stored = localStorage.getItem(NETWORK_KEY);
  return stored === 'mainnet' || stored === 'testnet' ? stored : defaultNetwork();
}

export function setNetworkPreference(network: StellarNetwork): void {
  localStorage.setItem(NETWORK_KEY, network);
}

const WALLET_KEY = 'orbi_wallet';

export interface StoredWallet {
  walletAddress: string;
  credentialId: string;
  passkeyId: string;
  walletType?: 'smart' | 'prf-g';
}

const SESSION_COOKIE = 'orbi_session';

export function saveWallet(wallet: StoredWallet): void {
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
}

export function loadWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(WALLET_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearWallet(): void {
  localStorage.removeItem(WALLET_KEY);
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

// ── dApp connections (local — not synced across devices) ──

const CONNECTIONS_KEY = 'orbi_connections';

export interface StoredConnection {
  origin: string;
  appName: string;
  connectedAt: string;
}

function loadAllConnections(): Record<string, StoredConnection[]> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(CONNECTIONS_KEY);
  return raw ? JSON.parse(raw) : {};
}

export function getConnections(walletAddress: string): StoredConnection[] {
  return loadAllConnections()[walletAddress] ?? [];
}

export function addConnection(walletAddress: string, origin: string, appName: string): void {
  const all = loadAllConnections();
  const existing = all[walletAddress] ?? [];
  if (existing.some(c => c.origin === origin)) return;
  all[walletAddress] = [...existing, { origin, appName, connectedAt: new Date().toISOString() }];
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(all));
}

export function removeConnection(walletAddress: string, origin: string): void {
  const all = loadAllConnections();
  all[walletAddress] = (all[walletAddress] ?? []).filter(c => c.origin !== origin);
  localStorage.setItem(CONNECTIONS_KEY, JSON.stringify(all));
}

// ── cached balances (stale-while-revalidate) ──
//
// Last-known balances per wallet, so the dashboard can paint instantly on
// load instead of the token list flickering empty until Horizon responds.
// Always treated as provisional: the live fetch overwrites both this cache
// and on-screen state the moment it lands, so a stale or wrong cached figure
// never outlives the next successful refresh.

const BALANCES_KEY = 'orbi_balances';

export interface CachedAsset {
  code: string;
  issuer: string;
  sacId: string;
}

export interface CachedBalances {
  xlm: string;
  tokens: Record<string, string>;
  // Trustlines outside Orbi's curated token list — cached too, so a custom
  // token the user added shows up instantly on return visits instead of
  // popping in once the live read identifies it (same fix as `tokens`).
  customAssets?: CachedAsset[];
}

function loadAllCachedBalances(): Record<string, CachedBalances> {
  if (typeof window === 'undefined') return {};
  const raw = localStorage.getItem(BALANCES_KEY);
  return raw ? JSON.parse(raw) : {};
}

// A G-address is identical on testnet and mainnet but holds completely
// different balances/trustlines on each — the cache key must include the
// network or switching networks would paint one network's figures over
// the other's on first load.
function balancesCacheKey(walletAddress: string, network: StellarNetwork): string {
  return `${walletAddress}:${network}`;
}

export function loadCachedBalances(walletAddress: string, network: StellarNetwork): CachedBalances | null {
  return loadAllCachedBalances()[balancesCacheKey(walletAddress, network)] ?? null;
}

export function saveCachedBalances(
  walletAddress: string,
  network: StellarNetwork,
  xlm: string,
  tokens: Record<string, string>,
  customAssets?: CachedAsset[],
): void {
  const all = loadAllCachedBalances();
  all[balancesCacheKey(walletAddress, network)] = { xlm, tokens, customAssets };
  localStorage.setItem(BALANCES_KEY, JSON.stringify(all));
}

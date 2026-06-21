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

export type Chain = 'stellar';

const WALLET_KEY = 'orbi_wallet';

export interface StoredWallet {
  // The Stellar wallet address.
  walletAddress: string;
  credentialId: string;
  passkeyId: string;
  walletType?: 'smart' | 'prf-g';
  // Which chain `walletAddress` belongs to. Orbi is Stellar-only for now.
  chain?: Chain;
  // Kept for tolerant reads of older sessions; new wallets only store Stellar.
  addresses?: Partial<Record<Chain, string>>;
  // COSE public key (base64url) captured at registration — the recovery server
  // needs it to verify assertions. Absent ⇒ legacy wallet (re-create to enable).
  publicKey?: string;
  // A+B recovery state. Set once the user enables recovery (links Google +
  // backs up share B to Drive). `userId` is the recovery server's id for this wallet.
  recovery?: { userId: string; googleLinked: boolean };
  // Set on a device that ADOPTED this wallet via Google recovery (no original
  // passkey here). `credentialId` is a NEW local passkey whose PRF wraps the
  // original seed; `wrappedSeed` is that ciphertext. Signing unwraps it to the
  // original seed, so the address is unchanged. Absent ⇒ original device (PRF = seed).
  adopted?: { wrappedSeed: string };
}

const SESSION_COOKIE = 'orbi_session';
// The SDK (OrbiClient) keeps its own session under this localStorage key and the
// dashboard/home read from it. The first-party pages normally write `orbi_wallet`
// and rely on the SDK popup handshake to populate this — so direct (non-popup)
// create / sign-in / recovery flows must mirror the session here themselves.
const SDK_SESSION_KEY = 'orbi_session';

export function saveWallet(wallet: StoredWallet): void {
  localStorage.setItem(WALLET_KEY, JSON.stringify(wallet));
  document.cookie = `${SESSION_COOKIE}=1; path=/; max-age=31536000; SameSite=Lax`;
}

// Mirror the wallet into the SDK session so the dashboard/home (which read via
// the SDK) recognise the connection on the current chain.
export function setSdkSession(wallet: StoredWallet): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SDK_SESSION_KEY, JSON.stringify({
    walletAddress: wallet.walletAddress,
    credentialId: wallet.credentialId,
    passkeyId: wallet.passkeyId,
    chain: 'stellar',
    addresses: { stellar: wallet.walletAddress },
  }));
}

export function loadWallet(): StoredWallet | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(WALLET_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearWallet(): void {
  localStorage.removeItem(WALLET_KEY);
  localStorage.removeItem(SDK_SESSION_KEY);
  document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0`;
}

// Record that A+B recovery has been enabled for the current wallet.
export function setWalletRecovery(recovery: { userId: string; googleLinked: boolean }): void {
  const w = loadWallet();
  if (!w) return;
  saveWallet({ ...w, recovery });
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

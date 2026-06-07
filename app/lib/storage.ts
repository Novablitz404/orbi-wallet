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

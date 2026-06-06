const WALLET_KEY = 'orbi_wallet';

export interface StoredWallet {
  walletAddress: string;
  credentialId: string;
  passkeyId: string;
  email: string;
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

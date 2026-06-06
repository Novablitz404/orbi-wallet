const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3001';
const DEPLOYER_PUBLIC_KEY = process.env.NEXT_PUBLIC_DEPLOYER_PUBLIC_KEY ?? '';

export { RELAY_URL, DEPLOYER_PUBLIC_KEY };

export async function createWallet(params: {
  passkeyId: string;
  publicKey: string;
  email: string;
}): Promise<{ walletAddress: string }> {
  const res = await fetch(`${RELAY_URL}/v1/wallet/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Wallet creation failed');
  }
  return res.json();
}

export async function getWalletAddress(passkeyId: string): Promise<string> {
  const res = await fetch(`${RELAY_URL}/v1/wallet/address`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passkeyId }),
  });
  if (!res.ok) throw new Error('Failed to derive wallet address');
  const data = await res.json() as { walletAddress: string };
  return data.walletAddress;
}

export async function initiateRecovery(params: {
  email: string;
  newPasskeyId: string;
  newPublicKey: string;
}): Promise<void> {
  const res = await fetch(`${RELAY_URL}/v1/recovery/initiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error('Recovery initiation failed');
}

export async function confirmRecovery(params: {
  email: string;
  otp: string;
}): Promise<{ txHash: string }> {
  const res = await fetch(`${RELAY_URL}/v1/recovery/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(err.error ?? 'Recovery failed');
  }
  return res.json();
}

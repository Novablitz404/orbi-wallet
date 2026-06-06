'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { authenticatePasskey, derivePasskeyId } from '../../lib/passkey';
import BackButton from '../../components/BackButton';
import { saveWallet, loadWallet } from '../../lib/storage';
import { signInWithPRF } from '../../lib/prf-wallet';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;
const HORIZON_URL = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export default function SignInPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSignIn() {
    setStatus('loading');
    setError('');
    try {
      const stored = loadWallet();

      // G wallet sign-in: PRF derives the G address directly — no relay lookup needed.
      if (stored?.walletType === 'prf-g') {
        const { gAddress, credentialId } = await signInWithPRF(stored.credentialId);
        if (gAddress !== stored.walletAddress) {
          throw new Error('Passkey does not match your wallet address');
        }
        saveWallet({ ...stored, credentialId });
        router.replace('/dashboard');
        return;
      }

      // New device: no stored wallet — try PRF first, fall through to smart wallet lookup.
      if (!stored) {
        try {
          const { gAddress, credentialId } = await signInWithPRF();
          // Check if this G address exists on Stellar
          const res = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
          if (res.ok) {
            saveWallet({ walletAddress: gAddress, credentialId, passkeyId: '', email: '', walletType: 'prf-g' });
            router.replace('/dashboard');
            return;
          }
        } catch {
          // PRF not available or account not found — fall through to smart wallet lookup
        }
      }

      // Smart wallet sign-in: passkey → passkeyId → relay lookup.
      const credentialId = await authenticatePasskey(stored?.credentialId);
      const passkeyId = await derivePasskeyId(credentialId);

      const res = await fetch(`${RELAY_URL}/v1/wallet/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passkeyId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Wallet not found');
      }

      const { walletAddress, email } = await res.json() as { walletAddress: string; email: string };
      saveWallet({ walletAddress, credentialId, passkeyId, email, walletType: 'smart' });
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setStatus('error');
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="w-full max-w-sm">
        <div className="mb-8"><BackButton href="/" /></div>
      </div>

      <div className="flex flex-col items-center gap-3 mb-10">
        <img src="/Orbi%20Icon.png" alt="Orbi" className="w-16 h-16 rounded-2xl" />
        <h1 className="text-2xl font-bold text-white">Welcome back</h1>
        <p className="text-slate-400 text-center text-sm max-w-xs">
          Use your passkey to sign in to your Orbi wallet.
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        <button
          onClick={handleSignIn}
          disabled={status === 'loading'}
          className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {status === 'loading' ? (
            <>
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Signing in…
            </>
          ) : (
            'Sign in with passkey'
          )}
        </button>

        {status === 'error' && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}

        <p className="text-slate-600 text-xs text-center">
          Lost access?{' '}
          <a href="/recover" className="bg-gradient-to-r from-blue-400 to-violet-500 bg-clip-text text-transparent hover:opacity-80 transition-opacity">
            Recover with email
          </a>
        </p>
      </div>
    </main>
  );
}

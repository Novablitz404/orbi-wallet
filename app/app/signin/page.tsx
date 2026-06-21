'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import BackButton from '../../components/BackButton';
import { saveWallet, loadWallet, getNetworkPreference, setSdkSession, type StoredWallet } from '../../lib/storage';
import { signInWithPRF } from '../../lib/prf-wallet';
import { recoverAndAdoptViaGoogle } from '../../lib/recovery';

const HORIZON_URL = getNetworkPreference() === 'mainnet'
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export default function SignInPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'loading'>('idle');
  const [error, setError] = useState('');

  async function handleSignIn() {
    setStatus('loading');
    setError('');
    try {
      const stored = loadWallet();
      const { gAddress, credentialId } = await signInWithPRF(stored?.credentialId);

      if (!stored) {
        const res = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
        if (!res.ok) throw new Error('No wallet found for this passkey — create one first');
      }

      const wallet: StoredWallet = {
        // Preserve recovery state captured at registration — a passkey
        // assertion can't re-derive the COSE public key, so dropping these
        // would silently disable recovery on every sign-in.
        ...stored,
        walletAddress: gAddress,
        credentialId,
        passkeyId: '',
        walletType: 'prf-g',
        chain: 'stellar',
        addresses: { stellar: gAddress },
      };
      saveWallet(wallet);
      setSdkSession(wallet);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
      setStatus('error');
    }
  }

  async function handleGoogleSignIn() {
    setGoogleStatus('loading');
    setError('');
    try {
      // No passkey on this device → recover via Google and adopt the device
      // (registers a local passkey that wraps the recovered seed).
      const { credentialId, publicKey, gAddress, wrappedSeed } = await recoverAndAdoptViaGoogle();
      const wallet: StoredWallet = {
        walletAddress: gAddress,
        credentialId,
        passkeyId: '',
        walletType: 'prf-g',
        chain: 'stellar',
        addresses: { stellar: gAddress },
        publicKey,
        adopted: { wrappedSeed },
        recovery: { userId: '', googleLinked: true },
      };
      saveWallet(wallet);
      setSdkSession(wallet);
      router.replace('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign in failed');
      setStatus('error');
      setGoogleStatus('idle');
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="w-full max-w-sm">
        <div className="mb-8"><BackButton href="/" /></div>
      </div>

      <div className="flex flex-col items-center gap-3 mb-10">
        <Image src="/Orbi Icon.png" alt="Orbi" width={64} height={64} className="w-16 h-16 rounded-2xl" priority />
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

        <div className="flex items-center gap-3 py-1">
          <div className="h-px flex-1 bg-slate-700" />
          <span className="text-slate-500 text-xs">or</span>
          <div className="h-px flex-1 bg-slate-700" />
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={googleStatus === 'loading' || status === 'loading'}
          className="w-full py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {googleStatus === 'loading' ? (
            'Recovering… check the prompts'
          ) : (
            <>
              <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#fff" d="M12 11v2h5.5c-.2 1.2-1.5 3.5-5.5 3.5A5.5 5.5 0 1112 6.5c1.6 0 2.6.7 3.2 1.2l1.6-1.6C15.6 4.9 14 4 12 4a8 8 0 100 16c4.6 0 7.7-3.2 7.7-7.8 0-.5 0-.9-.1-1.2H12z"/></svg>
              Sign in with Google
            </>
          )}
        </button>
        <p className="text-slate-600 text-xs text-center -mt-1">
          No passkey on this device? Recover with the Google account you linked.
        </p>

        {status === 'error' && (
          <p className="text-red-400 text-sm text-center">{error}</p>
        )}
      </div>
    </main>
  );
}

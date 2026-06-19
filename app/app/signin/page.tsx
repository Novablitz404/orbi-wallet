'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import BackButton from '../../components/BackButton';
import ChainSelector from '../../components/ChainSelector';
import { saveWallet, loadWallet, getNetworkPreference, setChainPreference, getChainPreference, type Chain, type StoredWallet } from '../../lib/storage';
import { signInWithPRF } from '../../lib/prf-wallet';

const HORIZON_URL = getNetworkPreference() === 'mainnet'
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export default function SignInPage() {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState('');
  const [chain, setChain] = useState<Chain>('stellar');

  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get('chain');
    setChain(c === 'botchain' || c === 'stellar' ? c : getChainPreference());
  }, []);

  async function handleSignIn() {
    setStatus('loading');
    setError('');
    try {
      const stored = loadWallet();
      const { gAddress, evmAddress, credentialId } = await signInWithPRF(stored?.credentialId);
      const address = chain === 'stellar' ? gAddress : evmAddress;

      // On Stellar a new device must verify the account is actually activated
      // on-chain before adopting it. On BotChain the 0x address always exists
      // (no activation), so it's adopted directly — the passkey deterministically
      // re-derives the same address.
      if (!stored && chain === 'stellar') {
        const res = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
        if (!res.ok) throw new Error('No wallet found for this passkey — create one first');
      }

      const wallet: StoredWallet = {
        walletAddress: address,
        credentialId,
        passkeyId: '',
        walletType: 'prf-g',
        chain,
        addresses: { stellar: gAddress, botchain: evmAddress },
      };
      saveWallet(wallet);
      setChainPreference(chain);
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
        <Image src="/Orbi Icon.png" alt="Orbi" width={64} height={64} className="w-16 h-16 rounded-2xl" priority />
        <h1 className="text-2xl font-bold text-white">Welcome back</h1>
        <p className="text-slate-400 text-center text-sm max-w-xs">
          Use your passkey to sign in to your Orbi wallet.
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        <ChainSelector value={chain} onChange={setChain} disabled={status === 'loading'} />

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
      </div>
    </main>
  );
}

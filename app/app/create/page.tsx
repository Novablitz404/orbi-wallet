'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BackButton from '../../components/BackButton';
import { saveWallet } from '../../lib/storage';
import { registerPRFWallet } from '../../lib/prf-wallet';

type Step = 'email' | 'passkey' | 'done';

export default function CreateWalletPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [popupMode, setPopupMode] = useState(false);
  const [channelId, setChannelId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popup') === '1') {
      setPopupMode(true);
      setChannelId(params.get('channelId') ?? '');
    }
  }, []);

  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');

  async function handleCreate() {
    if (!email.trim()) return;
    setError('');
    setLoading(true);
    try {
      const { credentialId, gAddress } = await registerPRFWallet(email);
      const walletData = {
        walletAddress: gAddress,
        credentialId,
        passkeyId: '',
        email,
        walletType: 'prf-g' as const,
      };
      saveWallet(walletData);
      setWalletAddress(gAddress);

      const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
      if (redirectUrl) {
        const url = new URL(redirectUrl);
        url.searchParams.set('walletAddress', gAddress);
        url.searchParams.set('walletType', 'prf-g');
        window.location.href = url.toString();
        return;
      }

      // Came from the connect popup with no redirect configured (e.g. via the
      // SDK) — loop back so connect's own "already signed in" branch records
      // the permission, sends `orbi_connected`, and closes the popup.
      const origin = new URLSearchParams(window.location.search).get('origin');
      if (origin && !popupMode) {
        const back = new URL(window.location.href);
        back.pathname = '/connect';
        window.location.href = back.toString();
        return;
      }

      if (popupMode) {
        const msg = { type: 'orbi_wallet_created', ...walletData };
        if (channelId) { const bc = new BroadcastChannel(channelId); bc.postMessage(msg); bc.close(); }
        try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
        setTimeout(() => window.close(), 800);
      }
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="w-full max-w-sm">
        <div className="mb-8"><BackButton href="/" /></div>

        {/* ── Step: email ── */}
        {step === 'email' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Create your wallet</h2>
              <p className="text-slate-400 text-sm mt-1">Enter your email. Used as your passkey label.</p>
            </div>

            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && email.trim() && setStep('passkey')}
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />

            <button
              onClick={() => email.trim() && setStep('passkey')}
              disabled={!email.trim()}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step: passkey ── */}
        {step === 'passkey' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Secure with passkey</h2>
              <p className="text-slate-400 text-sm mt-1">
                Your device will generate a passkey. No seed phrase — your wallet address is derived from it.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-6 flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11c0-2.76 2.24-5 5-5s5 2.24 5 5v2M5 11v2a7 7 0 0014 0v-2M12 18v2m-3-2h6" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm text-center">
                Creating wallet for<br />
                <span className="text-white font-medium">{email}</span>
              </p>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => { setStep('email'); setError(''); }}
                className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
              >
                {loading ? 'Preparing…' : 'Create with passkey'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: done ── */}
        {step === 'done' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white">Wallet created!</h2>
              <p className="text-slate-400 text-sm text-center">
                Your G wallet is ready. Deposit at least 1 XLM to activate it on Stellar.
              </p>
            </div>

            <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4">
              <p className="text-slate-500 text-xs mb-1">Your wallet address</p>
              <p className="text-slate-200 text-xs font-mono break-all">{walletAddress}</p>
            </div>

            <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
              <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-yellow-400 text-xs">Deposit at least 1 XLM to this address to activate your account on the Stellar network.</p>
            </div>

            <button
              onClick={() => router.push('/dashboard')}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

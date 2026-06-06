'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { createPasskey } from '../../lib/passkey';
import BackButton from '../../components/BackButton';
import { createWallet } from '../../lib/relay';
import { saveWallet } from '../../lib/storage';
import { registerPRFWallet } from '../../lib/prf-wallet';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;

type WalletType = 'prf-g' | 'smart';
type Step = 'type' | 'email' | 'passkey' | 'deploying' | 'done';
type EmailStatus = 'idle' | 'checking' | 'available' | 'taken';

export default function CreateWalletPage() {
  const router = useRouter();
  const [walletType, setWalletType] = useState<WalletType>('prf-g');
  const [step, setStep] = useState<Step>('type');
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
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Email availability check — only needed for smart wallet
  useEffect(() => {
    if (walletType !== 'smart') return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!email.trim() || !email.includes('@')) { setEmailStatus('idle'); return; }
    setEmailStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${RELAY_URL}/v1/wallet/check-email?email=${encodeURIComponent(email)}`);
        const { available } = await res.json() as { available: boolean };
        setEmailStatus(available ? 'available' : 'taken');
      } catch { setEmailStatus('idle'); }
    }, 500);
  }, [email, walletType]);

  async function handleCreateG() {
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

  async function handleCreateSmart() {
    if (!email.trim() || emailStatus === 'taken') return;
    setError('');
    setLoading(true);
    try {
      const credential = await createPasskey(email, email);
      setStep('deploying');
      const { walletAddress: addr } = await createWallet({
        passkeyId: credential.passkeyId,
        publicKey: credential.publicKey,
        email,
      });
      const walletData = {
        walletAddress: addr,
        credentialId: credential.credentialId,
        passkeyId: credential.passkeyId,
        email,
        walletType: 'smart' as const,
      };
      saveWallet(walletData);
      setWalletAddress(addr);

      const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
      if (redirectUrl) {
        const res = await fetch(`${process.env.NEXT_PUBLIC_RELAY_URL}/v1/auth/tokens`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(walletData),
        });
        const { token } = await res.json() as { token: string };
        const url = new URL(redirectUrl);
        url.searchParams.set('token', token);
        window.location.href = url.toString();
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
      setStep('passkey');
    } finally {
      setLoading(false);
    }
  }

  const canContinueEmail =
    walletType === 'prf-g'
      ? email.trim().length > 0
      : email.trim() && emailStatus !== 'taken' && emailStatus !== 'checking';

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="w-full max-w-sm">
        <div className="mb-8"><BackButton href="/" /></div>

        {/* ── Step: choose wallet type ── */}
        {step === 'type' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Create your wallet</h2>
              <p className="text-slate-400 text-sm mt-1">Choose your wallet type.</p>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setWalletType('prf-g')}
                className={`w-full p-4 rounded-2xl border text-left transition-colors ${walletType === 'prf-g' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white font-semibold text-sm">G Wallet</p>
                    <p className="text-slate-400 text-xs mt-0.5">Classic Stellar address (G…) secured by passkey. Works everywhere — exchanges, DEXes, Horizon.</p>
                  </div>
                  <span className="ml-3 shrink-0 text-xs bg-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full font-medium">New</span>
                </div>
              </button>

              <button
                onClick={() => setWalletType('smart')}
                className={`w-full p-4 rounded-2xl border text-left transition-colors ${walletType === 'smart' ? 'border-blue-500 bg-blue-500/10' : 'border-slate-700 bg-slate-800/50 hover:border-slate-600'}`}
              >
                <div>
                  <p className="text-white font-semibold text-sm">Smart Wallet</p>
                  <p className="text-slate-400 text-xs mt-0.5">Soroban contract wallet (C…). Supports gasless transactions via Orbi relay.</p>
                </div>
              </button>
            </div>

            <button
              onClick={() => setStep('email')}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {/* ── Step: email ── */}
        {step === 'email' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Create your wallet</h2>
              <p className="text-slate-400 text-sm mt-1">
                {walletType === 'prf-g'
                  ? 'Enter your email. Used as your passkey label.'
                  : 'Enter your email. Your passkey will secure your wallet.'}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && canContinueEmail && setStep('passkey')}
                autoFocus
                className={`w-full px-4 py-3 rounded-xl bg-slate-800 border text-white placeholder-slate-500 focus:outline-none transition-colors ${
                  emailStatus === 'taken'
                    ? 'border-red-500 focus:border-red-400'
                    : emailStatus === 'available'
                    ? 'border-green-500 focus:border-green-400'
                    : 'border-slate-700 focus:border-blue-500'
                }`}
              />
              {emailStatus === 'checking' && (
                <p className="text-slate-500 text-xs flex items-center gap-1.5">
                  <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Checking availability…
                </p>
              )}
              {emailStatus === 'taken' && (
                <p className="text-red-400 text-xs">
                  This email already has a wallet.{' '}
                  <a href="/signin" className="underline hover:text-red-300">Sign in instead</a>
                </p>
              )}
              {emailStatus === 'available' && (
                <p className="text-green-400 text-xs">Email available</p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('type')}
                className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
              >
                Back
              </button>
              <button
                onClick={() => canContinueEmail && setStep('passkey')}
                disabled={!canContinueEmail}
                className="flex-1 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {/* ── Step: passkey ── */}
        {step === 'passkey' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Secure with passkey</h2>
              <p className="text-slate-400 text-sm mt-1">
                {walletType === 'prf-g'
                  ? 'Your device will generate a passkey. No seed phrase — your wallet address is derived from it.'
                  : 'Your device will ask you to authenticate. This creates your wallet key — no seed phrase needed.'}
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
                onClick={walletType === 'prf-g' ? handleCreateG : handleCreateSmart}
                disabled={loading}
                className="flex-1 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
              >
                {loading ? 'Preparing…' : 'Create with passkey'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step: deploying (smart wallet only) ── */}
        {step === 'deploying' && (
          <div className="flex flex-col items-center gap-6 py-8">
            <div className="w-16 h-16 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
              <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">Deploying your wallet</h2>
              <p className="text-slate-400 text-sm mt-2">
                Publishing your smart contract to Stellar.<br />This takes about 10 seconds.
              </p>
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
                {walletType === 'prf-g'
                  ? 'Your G wallet is ready. Deposit at least 1 XLM to activate it on Stellar.'
                  : 'Your smart wallet is ready on Stellar.'}
              </p>
            </div>

            <div className="rounded-xl bg-slate-800/50 border border-slate-700 p-4">
              <p className="text-slate-500 text-xs mb-1">Your wallet address</p>
              <p className="text-slate-200 text-xs font-mono break-all">{walletAddress}</p>
            </div>

            {walletType === 'prf-g' && (
              <div className="flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-yellow-400 text-xs">Deposit at least 1 XLM to this address to activate your account on the Stellar network.</p>
              </div>
            )}

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

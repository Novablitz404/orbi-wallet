'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BackButton from '../../components/BackButton';
import { saveWallet, loadWallet, setWalletRecovery, setSdkSession, type StoredWallet } from '../../lib/storage';
import { registerPRFWallet, signInWithPRF } from '../../lib/prf-wallet';
import { setupRecoveryWithGoogle } from '../../lib/recovery';
import { prewarmGoogleAuth } from '../../lib/google-oauth';

type Step = 'passkey' | 'protect' | 'done';

interface SetupData { credentialId: string; publicKey: string; gAddress: string }

export default function CreateWalletPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('passkey');
  const [popupMode, setPopupMode] = useState(false);
  const [channelId, setChannelId] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('popup') === '1') {
      setPopupMode(true);
      setChannelId(params.get('channelId') ?? '');
    }
    prewarmGoogleAuth();
  }, []);

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [setupData, setSetupData] = useState<SetupData | null>(null);
  const [recoveryDone, setRecoveryDone] = useState(false);

  async function handleCreate() {
    setError('');
    setLoading(true);
    try {
      const existing = loadWallet();
      let credentialId: string, gAddress: string;
      let publicKey: string | undefined;
      if (existing) {
        ({ credentialId, gAddress } = await signInWithPRF(existing.credentialId));
      } else {
        ({ credentialId, gAddress, publicKey } = await registerPRFWallet());
      }

      const walletData: StoredWallet = {
        walletAddress: gAddress,
        credentialId,
        passkeyId: '',
        walletType: 'prf-g',
        chain: 'stellar',
        addresses: { stellar: gAddress },
        publicKey: publicKey ?? existing?.publicKey,
        recovery: existing?.recovery,
      };
      saveWallet(walletData);
      setWalletAddress(gAddress);

      const origin = new URLSearchParams(window.location.search).get('origin');
      // Fresh passkey with a captured public key and no recovery yet → worth
      // offering the protect (recovery) step before finishing.
      const protectable = !!publicKey && !walletData.recovery;

      // Connect (SDK) flow: offer recovery FIRST, then loop back to /connect so
      // the handshake completes (records the permission, sends `orbi_connected`,
      // closes the popup). Non-protectable wallets loop back immediately.
      if (origin && !popupMode) {
        if (protectable) {
          setSetupData({ credentialId, publicKey: publicKey!, gAddress });
          setStep('protect');
        } else {
          redirectToConnect();
        }
        return;
      }

      if (popupMode) {
        const msg = { type: 'orbi_wallet_created', ...walletData };
        if (channelId) { const bc = new BroadcastChannel(channelId); bc.postMessage(msg); bc.close(); }
        try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
        setTimeout(() => window.close(), 800);
        setStep('done');
        return;
      }

      // Direct (non-popup) flow → mirror into the SDK session so the dashboard
      // recognises the connection on this chain.
      setSdkSession(walletData);

      // New wallet (fresh passkey, has a public key, not already protected) →
      // offer to set up recovery before sending them to the dashboard.
      if (protectable) {
        setSetupData({ credentialId, publicKey: publicKey!, gAddress });
        setStep('protect');
      } else {
        setStep('done');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  // Loop back to /connect to finish the dApp handshake (same window/popup).
  function redirectToConnect() {
    const back = new URL(window.location.href);
    back.pathname = '/connect';
    window.location.href = back.toString();
  }

  // Where to go after the protect step: a connect (SDK) flow loops back to
  // finish the handshake; a direct flow lands on the success screen.
  function leaveProtect() {
    const origin = new URLSearchParams(window.location.search).get('origin');
    if (origin && !popupMode) { redirectToConnect(); return; }
    setStep('done');
  }

  async function handleSetupRecovery() {
    if (!setupData) return;
    setError('');
    setLoading(true);
    try {
      const { userId } = await setupRecoveryWithGoogle({
        credentialId: setupData.credentialId,
        publicKey: setupData.publicKey,
        stellarAddress: setupData.gAddress,
      });
      setWalletRecovery({ userId, googleLinked: true });
      setRecoveryDone(true);
      leaveProtect();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not set up recovery');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="w-full max-w-sm">
        <div className="mb-8"><BackButton href="/" /></div>

        {/* ── Step: passkey ── */}
        {step === 'passkey' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Create your wallet</h2>
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
                Face ID, Touch ID, or your device&apos;s screen lock secures your wallet.
              </p>
              <div className="flex items-start gap-2 w-full rounded-xl bg-slate-700/40 border border-slate-600/50 px-3 py-2">
                <svg className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <p className="text-slate-400 text-xs">
                  On a desktop without a fingerprint reader? Your browser will show a QR code — scan it with your phone to create the passkey there instead.
                </p>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <button
              onClick={handleCreate}
              disabled={loading}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? 'Preparing…' : 'Create with passkey'}
            </button>
          </div>
        )}

        {/* ── Step: protect (set up recovery) ── */}
        {step === 'protect' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col items-center gap-3 py-2">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
                <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white text-center">Wallet created — protect it</h2>
              <p className="text-slate-400 text-sm text-center">
                Set up recovery so you can get back in if you lose this device. We link your Google
                account and store an encrypted backup in your own Google Drive. Your passkey stays
                your everyday sign-in.
              </p>
            </div>

            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-sm">✓</span>
                <p className="text-slate-300 text-xs">Recover on a new phone or computer with no passkey.</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-green-400 text-sm">✓</span>
                <p className="text-slate-300 text-xs">Non-custodial — Orbi can never access your wallet alone.</p>
              </div>
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}

            <div className="flex flex-col gap-3">
              <button
                onClick={handleSetupRecovery}
                disabled={loading}
                className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? 'Setting up… check the prompts' : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24"><path fill="#fff" d="M12 11v2h5.5c-.2 1.2-1.5 3.5-5.5 3.5A5.5 5.5 0 1112 6.5c1.6 0 2.6.7 3.2 1.2l1.6-1.6C15.6 4.9 14 4 12 4a8 8 0 100 16c4.6 0 7.7-3.2 7.7-7.8 0-.5 0-.9-.1-1.2H12z"/></svg>
                    Set up recovery with Google
                  </>
                )}
              </button>
              <button
                onClick={leaveProtect}
                disabled={loading}
                className="w-full py-3 rounded-2xl text-slate-400 hover:text-slate-200 text-sm font-medium transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
              <p className="text-slate-600 text-xs text-center">You can set this up later in Settings.</p>
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

            {recoveryDone && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-green-500/10 border border-green-500/20">
                <span className="text-green-400 text-sm">✓</span>
                <p className="text-green-400 text-xs">Recovery is on — backed up to your Google Drive.</p>
              </div>
            )}

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

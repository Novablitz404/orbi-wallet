'use client';

import { useEffect, useState } from 'react';
import { loadWallet, setWalletRecovery, type StoredWallet } from '../lib/storage';
import { setupRecoveryWithGoogle } from '../lib/recovery';

// Dashboard banner that nudges the user to enable A+B recovery. Shown until
// recovery is set up. Reads the wallet itself so it works regardless of how the
// wallet was created (popup connect flow, direct, etc.). Dismissible per session.
const DISMISS_KEY = 'orbi_recovery_nudge_dismissed';

export default function RecoveryNudge() {
  const [wallet, setWallet] = useState<StoredWallet | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setWallet(loadWallet());
    setDismissed(sessionStorage.getItem(DISMISS_KEY) === '1');
  }, []);

  // Only nudge when recovery is possible (public key captured) and not yet on.
  const needsRecovery = !!wallet?.publicKey && !wallet.recovery?.googleLinked;
  if (done) {
    return (
      <div className="mb-5 flex items-center gap-2 rounded-2xl bg-green-500/10 border border-green-500/20 px-4 py-3">
        <span className="text-green-400 text-sm">✓</span>
        <p className="text-green-400 text-sm">Recovery is on — backed up to your Google Drive.</p>
      </div>
    );
  }
  if (!needsRecovery || dismissed) return null;

  async function setup() {
    if (!wallet?.publicKey || !wallet.addresses?.stellar || !wallet.addresses?.botchain) return;
    setError('');
    setBusy(true);
    try {
      const { userId } = await setupRecoveryWithGoogle({
        credentialId: wallet.credentialId,
        publicKey: wallet.publicKey,
        stellarAddress: wallet.addresses.stellar,
        evmAddress: wallet.addresses.botchain,
        userId: wallet.recovery?.userId,
      });
      setWalletRecovery({ userId, googleLinked: true });
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set up recovery');
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  }

  return (
    <div className="mb-5 rounded-2xl bg-blue-500/10 border border-blue-500/20 px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="text-blue-300 text-lg leading-none mt-0.5">🛡️</span>
        <div className="flex-1">
          <p className="text-white text-sm font-medium">Protect your wallet</p>
          <p className="text-slate-400 text-xs mt-0.5">
            Set up recovery so you can get back in if you lose this device. We link your Google
            account and store an encrypted backup in your own Drive — non-custodial.
          </p>
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={setup}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors disabled:opacity-50"
            >
              {busy ? 'Setting up… check the prompts' : 'Set up with Google'}
            </button>
            <button
              onClick={dismiss}
              disabled={busy}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs transition-colors disabled:opacity-50"
            >
              Not now
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

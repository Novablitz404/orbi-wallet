'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { signInWithPRF } from '../../lib/prf-wallet';
import { loadWallet, saveWallet, addConnection, getNetworkPreference, type StoredWallet } from '../../lib/storage';

const HORIZON_URL = getNetworkPreference() === 'mainnet'
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

type Step = 'loading' | 'connect' | 'connecting' | 'done' | 'error';

export default function ConnectPage() {
  const [step, setStep] = useState<Step>('loading');
  const [origin, setOrigin] = useState('');
  const [appName, setAppName] = useState('');
  const [channelId, setChannelId] = useState('');
  const [walletAddress, setWalletAddress] = useState('');
  const [error, setError] = useState('');

  function handleCreateWallet() {
    const url = new URL(window.location.href);
    url.pathname = '/create';
    // Keep origin + channelId — create loops back here once the wallet is
    // ready so the connect handshake can complete.
    window.location.href = url.toString();
  }

  function handleCancel() {
    window.close();
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const o = params.get('origin') ?? '';
    const c = params.get('channelId') ?? '';
    setOrigin(o);
    setChannelId(c);

    let name = o;
    try { name = new URL(o).hostname; } catch { /* keep raw origin */ }
    setAppName(name);

    // Already signed in on this device — auto-connect
    const existing = loadWallet();
    if (existing) {
      grantAndSend(existing, o, c, name);
      return;
    }

    setStep('connect');
  }, []);

  function grantAndSend(w: StoredWallet, o: string, c: string, name: string) {
    setWalletAddress(w.walletAddress);

    if (o) addConnection(w.walletAddress, o, name);

    // BroadcastChannel + postMessage handshake — see OrbiClient.connect()
    const msg = { type: 'orbi_connected', address: w.walletAddress, credentialId: w.credentialId, passkeyId: w.passkeyId };
    if (c) {
      const bc = new BroadcastChannel(c);
      bc.postMessage(msg);
      bc.close();
    }
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }

    setStep('done');
    setTimeout(() => window.close(), 1000);
  }

  async function handleConnect() {
    setStep('connecting');
    setError('');
    try {
      const stored = loadWallet();
      const { gAddress, credentialId } = await signInWithPRF(stored?.credentialId);

      let w: StoredWallet;
      if (stored) {
        if (gAddress !== stored.walletAddress) throw new Error('Passkey does not match your wallet address');
        w = { ...stored, credentialId };
      } else {
        const res = await fetch(`${HORIZON_URL}/accounts/${gAddress}`);
        if (!res.ok) throw new Error('No wallet found for this passkey — create one first');
        w = { walletAddress: gAddress, credentialId, passkeyId: '', walletType: 'prf-g' };
      }
      saveWallet(w);

      grantAndSend(w, origin, channelId, appName);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setStep('error');
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 bg-[#020817]">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">

        <Image src="/Orbi Icon.png" alt="Orbi" width={56} height={56} className="w-14 h-14 rounded-2xl" priority />

        {step === 'loading' && (
          <div className="animate-pulse text-slate-500 text-sm">Loading…</div>
        )}

        {step === 'connect' && (
          <>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">Sign into {appName}</h1>
              <p className="text-slate-400 text-sm mt-1">By continuing, you allow {appName} to:</p>
            </div>

            <div className="w-full rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-3">
              {[
                { icon: '👤', label: 'See your wallet address' },
                { icon: '📊', label: 'Access your balances and activity' },
                { icon: '🔄', label: 'Send you transaction requests' },
              ].map(({ icon, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <span className="text-lg">{icon}</span>
                  <span className="text-slate-300 text-sm">{label}</span>
                </div>
              ))}
            </div>

            <div className="w-full flex flex-col gap-3">
              <button
                onClick={handleConnect}
                className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-semibold transition-colors"
              >
                Sign in with passkey
              </button>
              <button
                onClick={handleCreateWallet}
                className="w-full py-4 rounded-2xl bg-transparent border border-slate-700 hover:border-slate-500 text-white font-semibold text-sm transition-colors"
              >
                New to Orbi? Create wallet
              </button>
              <button onClick={handleCancel} className="w-full py-3 text-slate-500 hover:text-slate-300 text-sm transition-colors">
                Cancel
              </button>
            </div>
          </>
        )}

        {step === 'connecting' && (
          <>
            <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-white text-sm">Connecting…</p>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white font-semibold">Connected to {appName}!</p>
            <p className="text-slate-500 text-xs font-mono">{walletAddress.slice(0, 8)}…{walletAddress.slice(-6)}</p>
            <p className="text-slate-600 text-xs">Closing…</p>
          </>
        )}

        {step === 'error' && (
          <>
            <p className="text-red-400 text-sm text-center">{error}</p>
            <button onClick={() => setStep('connect')} className="text-blue-400 text-sm hover:underline">Try again</button>
            <button onClick={handleCancel} className="text-slate-500 text-sm">Cancel</button>
          </>
        )}
      </div>
    </main>
  );
}

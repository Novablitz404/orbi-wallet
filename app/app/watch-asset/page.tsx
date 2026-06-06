'use client';

import { useEffect, useState } from 'react';
import { loadWallet } from '../../lib/storage';
import { isValidContractId, tokenLetterAvatar } from '../../lib/tokens';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;

type Step = 'loading' | 'review' | 'signin' | 'adding' | 'done' | 'error';

interface TokenMeta { code: string; name: string; decimals: number; }

/**
 * keys.orbiwallet.xyz/watch-asset
 *
 * Opened via redirect by a dApp (e.g. after a swap) to ask the user to add a
 * token to their Orbi wallet — the dApp-prompted equivalent of MetaMask's
 * wallet_watchAsset. URL params:
 *   contractId — the token contract to add
 *   redirect   — where to send the user back
 *   origin     — dApp origin (for display)
 *
 * On confirm/cancel we redirect back to `redirect` with:
 *   ?watched=true|false&watchedContractId=<id>
 */
export default function WatchAssetPage() {
  const [step, setStep] = useState<Step>('loading');
  const [contractId, setContractId] = useState('');
  const [redirect, setRedirect] = useState('');
  const [origin, setOrigin] = useState('');
  const [meta, setMeta] = useState<TokenMeta | null>(null);
  const [walletAddress, setWalletAddress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = (params.get('contractId') ?? '').trim();
    const red = params.get('redirect') ?? '';
    setContractId(cid);
    setRedirect(red);
    setOrigin(params.get('origin') ?? '');

    if (!isValidContractId(cid)) {
      setError('Invalid token contract address');
      setStep('error');
      return;
    }

    const w = loadWallet();
    if (!w) { setStep('signin'); return; }
    setWalletAddress(w.walletAddress);

    fetch(`${RELAY_URL}/v1/wallet/token-metadata/${cid}`)
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? 'Not a token contract');
        return r.json() as Promise<TokenMeta>;
      })
      .then(m => { setMeta(m); setStep('review'); })
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : 'Could not read token'); setStep('error'); });
  }, []);

  function returnToDapp(added: boolean) {
    if (!redirect) return;
    const url = new URL(redirect);
    url.searchParams.set('watched', String(added));
    url.searchParams.set('watchedContractId', contractId);
    window.location.href = url.toString();
  }

  async function handleAdd() {
    setStep('adding'); setError('');
    try {
      const res = await fetch(`${RELAY_URL}/v1/wallet/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, contractId, addedVia: 'dapp' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})) as { error?: string }).error ?? 'Failed to add token');
      setStep('done');
      setTimeout(() => returnToDapp(true), 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add token');
      setStep('error');
    }
  }

  return (
    <main className="min-h-[100dvh] bg-[#020817] flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-slate-900 border border-slate-700/50 rounded-3xl shadow-2xl shadow-black/50 p-6">
        <div className="flex justify-center mb-5">
          <img src="/Orbi%20logo%20-%20Landscape%20white.png" alt="Orbi" className="h-7 w-auto" />
        </div>

        {step === 'loading' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
            <p className="text-slate-400 text-sm">Reading token…</p>
          </div>
        )}

        {step === 'signin' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-white font-semibold">Sign in required</p>
            <p className="text-slate-500 text-sm">Sign in to your Orbi wallet to add this token.</p>
            <a href="https://account.orbiwallet.xyz" className="mt-2 px-6 py-3 rounded-2xl bg-white text-slate-900 font-semibold text-sm">Open Orbi</a>
          </div>
        )}

        {step === 'review' && meta && (
          <>
            <p className="text-center text-slate-400 text-sm mb-1">
              {origin ? new URL(origin).host : 'A dApp'} wants to add a token to your wallet
            </p>
            <div className="flex items-center gap-3 my-5 p-4 rounded-2xl bg-slate-800/50 border border-slate-700/50">
              <div className="w-11 h-11 rounded-full overflow-hidden flex-shrink-0">
                <img src={tokenLetterAvatar(meta.code)} alt={meta.code} className="w-full h-full object-cover" />
              </div>
              <div className="min-w-0">
                <p className="text-white font-medium truncate">{meta.name}</p>
                <p className="text-slate-500 text-xs">{meta.code} · {meta.decimals} decimals</p>
              </div>
            </div>
            <p className="text-slate-600 text-xs font-mono break-all mb-5">{contractId}</p>
            <div className="flex gap-3">
              <button onClick={() => returnToDapp(false)} className="flex-1 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-sm transition-colors">Cancel</button>
              <button onClick={handleAdd} className="flex-1 py-3.5 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-sm transition-colors">Add token</button>
            </div>
          </>
        )}

        {step === 'adding' && (
          <div className="flex flex-col items-center gap-3 py-10">
            <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" /></svg>
            <p className="text-slate-400 text-sm">Adding token…</p>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </div>
            <p className="text-white font-semibold">Token added</p>
            <p className="text-slate-500 text-sm">Returning you back…</p>
          </div>
        )}

        {step === 'error' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <button onClick={() => returnToDapp(false)} className="mt-2 text-blue-400 text-sm hover:underline">Go back</button>
          </div>
        )}
      </div>
    </main>
  );
}

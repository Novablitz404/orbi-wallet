'use client';

import { useEffect, useState } from 'react';
import { TransactionBuilder, Networks, Operation } from '@stellar/stellar-sdk';
import { loadWallet } from '../../lib/storage';
import { signTransactionWithPRF } from '../../lib/prf-wallet';

type Step = 'loading' | 'review' | 'signing' | 'done' | 'error';

interface SignRequest {
  channelId: string;
  walletAddress: string;
  xdr: string;            // base64 TransactionEnvelope XDR
  network: 'testnet' | 'mainnet';
  origin: string;
}

// Summarise what a G wallet transaction is doing (for the review UI).
function summariseGTx(txXdr: string, network: 'testnet' | 'mainnet'): { lines: string[] } {
  try {
    const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    const tx = TransactionBuilder.fromXDR(txXdr, passphrase);
    if (!('operations' in tx)) return { lines: ['Sign transaction'] };

    const ops: string[] = (tx as { operations: Operation[] }).operations.map(op => {
      if (op.type === 'payment') {
        const p = op as Operation.Payment;
        const asset = p.asset.isNative() ? 'XLM' : p.asset.code;
        return `Send ${p.amount} ${asset} to ${p.destination.slice(0, 6)}…${p.destination.slice(-4)}`;
      }
      if (op.type === 'pathPaymentStrictSend' || op.type === 'pathPaymentStrictReceive') {
        return 'Swap';
      }
      if (op.type === 'changeTrust') {
        const c = op as Operation.ChangeTrust;
        const asset = 'assetCode' in c.line ? (c.line as { assetCode: string }).assetCode : 'unknown';
        return `Add trustline: ${asset}`;
      }
      return op.type;
    });

    return { lines: ops };
  } catch {
    return { lines: ['Sign transaction'] };
  }
}

/**
 * keys.orbiwallet.xyz/sign
 *
 * URL params: xdr (raw transaction envelope, base64), network, walletAddress, origin.
 */
export default function SignPage() {
  const [step, setStep] = useState<Step>('loading');
  const [req, setReq] = useState<SignRequest | null>(null);
  const [error, setError] = useState('');
  const [gSummary, setGSummary] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txXdr = params.get('xdr');

    if (!txXdr) { setError('Missing transaction XDR'); setStep('error'); return; }

    const network = (params.get('network') ?? 'testnet') as 'testnet' | 'mainnet';
    const r: SignRequest = {
      channelId: params.get('channelId') ?? '',
      walletAddress: params.get('walletAddress') ?? '',
      xdr: txXdr,
      network,
      origin: params.get('origin') ?? '',
    };

    // If walletAddress wasn't provided in URL, get it from storage
    if (!r.walletAddress) {
      const stored = loadWallet();
      if (stored) r.walletAddress = stored.walletAddress;
    }

    setReq(r);
    setGSummary(summariseGTx(r.xdr, r.network).lines);
    setStep('review');
  }, []);

  function sendResult(signedXdr: string) {
    const msg = { type: 'orbi_g_signed', signedXdr, walletAddress: req?.walletAddress };
    if (req?.channelId) {
      const bc = new BroadcastChannel(req.channelId);
      bc.postMessage(msg);
      bc.close();
    }
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
    setTimeout(() => window.close(), 500);
  }

  function sendCancel() {
    const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
    if (redirectUrl) {
      try {
        const url = new URL(redirectUrl);
        url.searchParams.set('cancelled', '1');
        window.location.href = url.toString();
        return;
      } catch { /* fall through */ }
    }
    const msg = { type: 'orbi_cancelled' };
    if (req?.channelId) {
      const bc = new BroadcastChannel(req.channelId);
      bc.postMessage(msg);
      bc.close();
    }
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
    window.close();
  }

  async function handleSign() {
    if (!req) return;
    setStep('signing');
    setError('');
    try {
      const wallet = loadWallet();
      if (!wallet) throw new Error('Not signed in');

      const signedXdr = await signTransactionWithPRF(
        wallet.credentialId,
        req.xdr,
        req.network,
        req.walletAddress || wallet.walletAddress,
      );

      const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
      if (redirectUrl) {
        const url = new URL(redirectUrl);
        url.searchParams.set('gSignedXdr', signedXdr);
        url.searchParams.set('walletAddress', req.walletAddress || wallet.walletAddress);
        window.location.href = url.toString();
        return;
      }

      sendResult(signedXdr);
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signing failed');
      setStep('error');
    }
  }

  const appName = req?.origin
    ? (() => { try { return new URL(req.origin).hostname; } catch { return req.origin; } })()
    : 'this app';

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-6 bg-[#020817]">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">

        <img src="/Orbi%20Icon.png" alt="Orbi" className="w-14 h-14 rounded-2xl" />

        {step === 'loading' && (
          <div className="animate-pulse text-slate-500 text-sm">Loading…</div>
        )}

        {step === 'review' && req && (
          <>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">Approve Transaction</h1>
              <p className="text-slate-400 text-sm mt-1">{appName} is requesting your signature</p>
            </div>

            <div className="w-full rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-3 text-sm">
              {gSummary.map((line, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-slate-400">{i === 0 ? 'Action' : ''}</span>
                  <span className="text-white font-medium">{line}</span>
                </div>
              ))}
              <div className="flex justify-between">
                <span className="text-slate-400">Network</span>
                <span className="text-white capitalize">{req.network}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fee</span>
                <span className="text-white">0.00001 XLM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Requested by</span>
                <span className="text-white">{appName}</span>
              </div>
            </div>

            <button
              onClick={handleSign}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Approve with passkey
            </button>

            <button onClick={sendCancel} className="text-slate-500 text-sm hover:text-slate-300">
              Reject
            </button>
          </>
        )}

        {step === 'signing' && (
          <>
            <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <p className="text-white text-sm">Waiting for passkey…</p>
          </>
        )}

        {step === 'done' && (
          <>
            <div className="w-12 h-12 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-white font-semibold">Signed!</p>
            <p className="text-slate-500 text-xs">Returning to {appName}…</p>
          </>
        )}

        {step === 'error' && (
          <>
            <p className="text-red-400 text-sm text-center">{error}</p>
            <button onClick={() => setStep('review')} className="text-blue-400 text-sm hover:underline">
              Try again
            </button>
            <button onClick={sendCancel} className="text-slate-500 text-sm hover:text-slate-300">
              Cancel
            </button>
          </>
        )}
      </div>
    </main>
  );
}

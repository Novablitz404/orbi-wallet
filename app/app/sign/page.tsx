'use client';

import { useEffect, useState } from 'react';
import { xdr, TransactionBuilder, Networks, Operation } from '@stellar/stellar-sdk';
import { loadWallet } from '../../lib/storage';
import { signAuthEntryWithPasskey } from '../../lib/authEntry';
import { signTransactionWithPRF } from '../../lib/prf-wallet';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;
const STROOPS_PER_XLM = 10_000_000;

type Step = 'loading' | 'review' | 'signing' | 'done' | 'error';

// ── Smart wallet (existing) types ─────────────────────────────────────────────
interface SmartSignRequest {
  mode: 'smart';
  channelId: string;
  walletAddress: string;
  contractId: string;
  functionName: string;
  argsXdr: string[];
  origin: string;
  apiKey?: string;
}

interface QuoteResult {
  quoteId: string;
  authEntryXdr: string;
  currentLedger: number;
  nativeSacId: string;
  feeXlm: string;
  sponsored: boolean;
  sponsorName: string | null;
}

// ── G wallet (new) types ──────────────────────────────────────────────────────
interface GSignRequest {
  mode: 'g';
  channelId: string;
  walletAddress: string;
  xdr: string;            // base64 TransactionEnvelope XDR
  network: 'testnet' | 'mainnet';
  origin: string;
}

type SignRequest = SmartSignRequest | GSignRequest;

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
 * Supports two modes:
 *  - Smart wallet (existing): URL params include contractId/functionName/argsXdr
 *  - G wallet (new): URL params include xdr (raw transaction envelope base64)
 */
export default function SignPage() {
  const [step, setStep] = useState<Step>('loading');
  const [req, setReq] = useState<SignRequest | null>(null);
  const [trusted, setTrusted] = useState(false);
  const [error, setError] = useState('');
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [gSummary, setGSummary] = useState<string[]>([]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txXdr = params.get('xdr');

    if (txXdr) {
      // G wallet mode
      const network = (params.get('network') ?? 'testnet') as 'testnet' | 'mainnet';
      const r: GSignRequest = {
        mode: 'g',
        channelId: params.get('channelId') ?? '',
        walletAddress: params.get('walletAddress') ?? '',
        xdr: txXdr,
        network,
        origin: params.get('origin') ?? '',
      };

      if (!r.xdr) { setError('Missing transaction XDR'); setStep('error'); return; }

      // If walletAddress wasn't provided in URL, get it from storage
      if (!r.walletAddress) {
        const stored = loadWallet();
        if (stored) r.walletAddress = stored.walletAddress;
      }

      setReq(r);
      setGSummary(summariseGTx(r.xdr, r.network).lines);

      if (r.walletAddress && r.origin) {
        fetch(`${RELAY_URL}/v1/connections/check?walletAddress=${r.walletAddress}&origin=${encodeURIComponent(r.origin)}`)
          .then(res => res.json())
          .then((d: { connected?: boolean }) => setTrusted(d.connected ?? false))
          .catch(() => setTrusted(false));
      }

      setStep('review');
      return;
    }

    // Smart wallet mode (existing flow)
    const r: SmartSignRequest = {
      mode: 'smart',
      channelId: params.get('channelId') ?? '',
      walletAddress: params.get('walletAddress') ?? '',
      contractId: params.get('contractId') ?? '',
      functionName: params.get('functionName') ?? '',
      argsXdr: JSON.parse(params.get('argsXdr') ?? '[]') as string[],
      origin: params.get('origin') ?? '',
      apiKey: params.get('apiKey') ?? undefined,
    };

    if (!r.walletAddress || !r.contractId || !r.functionName) {
      setError('Invalid sign request — missing parameters');
      setStep('error');
      return;
    }

    setReq(r);

    if (r.walletAddress && r.origin) {
      fetch(`${RELAY_URL}/v1/connections/check?walletAddress=${r.walletAddress}&origin=${encodeURIComponent(r.origin)}`)
        .then(res => res.json())
        .then((d: { connected?: boolean }) => setTrusted(d.connected ?? false))
        .catch(() => setTrusted(false));
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (r.apiKey) headers['Authorization'] = `Bearer ${r.apiKey}`;
    fetch(`${RELAY_URL}/v1/quote`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        walletAddress: r.walletAddress,
        contractId: r.contractId,
        functionName: r.functionName,
        argsXdr: r.argsXdr,
      }),
    })
      .then(res => { if (!res.ok) throw new Error('quote failed'); return res.json(); })
      .then((q: QuoteResult) => setQuote(q))
      .catch(() => { /* fee row stays as Calculating… */ });

    setStep('review');
  }, []);

  function sendGResult(signedXdr: string) {
    const msg = { type: 'orbi_g_signed', signedXdr, walletAddress: req?.walletAddress };
    if (req?.channelId) {
      const bc = new BroadcastChannel(req.channelId);
      bc.postMessage(msg);
      bc.close();
    }
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
    setTimeout(() => window.close(), 500);
  }

  function sendSmartResult(signedAuthEntryXdr: string, quoteId: string, argsXdr: string[], nativeSacId: string) {
    const msg = { type: 'orbi_signed', signedAuthEntryXdr, quoteId, argsXdr, nativeSacId };
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

  async function handleGSign() {
    if (!req || req.mode !== 'g') return;
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

      sendGResult(signedXdr);
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signing failed');
      setStep('error');
    }
  }

  async function handleSmartSign() {
    if (!req || req.mode !== 'smart') return;
    setStep('signing');
    setError('');
    try {
      const wallet = loadWallet();
      if (!wallet) throw new Error('Not signed in');

      const args = req.argsXdr.map(a => xdr.ScVal.fromXDR(Buffer.from(a, 'base64')));

      let resolvedQuote = quote;
      if (!resolvedQuote) {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (req.apiKey) headers['Authorization'] = `Bearer ${req.apiKey}`;
        const quoteRes = await fetch(`${RELAY_URL}/v1/quote`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            walletAddress: req.walletAddress,
            contractId: req.contractId,
            functionName: req.functionName,
            argsXdr: req.argsXdr,
          }),
        });
        if (!quoteRes.ok) throw new Error('Failed to get fee quote');
        resolvedQuote = await quoteRes.json() as QuoteResult;
        setQuote(resolvedQuote);
      }
      if (!resolvedQuote) throw new Error('Failed to get fee quote');

      const entry = xdr.SorobanAuthorizationEntry.fromXDR(Buffer.from(resolvedQuote.authEntryXdr, 'base64'));
      const { authEntryXdr: signedXdr, argsXdr: signedArgsXdr } = await signAuthEntryWithPasskey({
        entry,
        args,
        credentialId: wallet.credentialId,
        passkeyId: wallet.passkeyId,
        currentLedger: resolvedQuote.currentLedger,
      });

      const redirectUrl = new URLSearchParams(window.location.search).get('redirect');
      if (redirectUrl) {
        const url = new URL(redirectUrl);
        url.searchParams.set('signedXdr', signedXdr);
        url.searchParams.set('quoteId', resolvedQuote.quoteId);
        url.searchParams.set('argsXdr', JSON.stringify(signedArgsXdr));
        url.searchParams.set('nativeSacId', resolvedQuote.nativeSacId);
        url.searchParams.set('walletAddress', req.walletAddress);
        window.location.href = url.toString();
        return;
      }

      sendSmartResult(signedXdr, resolvedQuote.quoteId, signedArgsXdr, resolvedQuote.nativeSacId);
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Signing failed');
      setStep('error');
    }
  }

  function handleSign() {
    if (req?.mode === 'g') return handleGSign();
    return handleSmartSign();
  }

  const appName = req?.origin
    ? (() => { try { return new URL(req.origin).hostname; } catch { return req.origin; } })()
    : 'this app';

  // Smart wallet transfer display
  const isTransfer = req?.mode === 'smart' && req.functionName === 'transfer' && req.argsXdr.length >= 3;
  let transferAmount = '';
  if (isTransfer && req?.mode === 'smart') {
    try {
      const amountScVal = xdr.ScVal.fromXDR(Buffer.from(req.argsXdr[2], 'base64'));
      const i128 = amountScVal.i128();
      const stroops = BigInt(i128.lo().toString());
      transferAmount = (Number(stroops) / STROOPS_PER_XLM).toFixed(2);
    } catch { /* ignore */ }
  }

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
              {!trusted && (
                <p className="mt-2 text-xs text-yellow-500/80 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-1.5">
                  New connection — {appName} hasn&apos;t connected before
                </p>
              )}
              {trusted && (
                <p className="mt-2 text-xs text-green-500/80 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-1.5">
                  Trusted — you&apos;ve connected to {appName} before
                </p>
              )}
            </div>

            <div className="w-full rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-3 text-sm">
              {/* G wallet — show decoded ops */}
              {req.mode === 'g' && (
                <>
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
                </>
              )}

              {/* Smart wallet — existing display */}
              {req.mode === 'smart' && (
                <>
                  {isTransfer ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Action</span>
                        <span className="text-white font-medium">Send XLM</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Amount</span>
                        <span className="text-white font-medium">{transferAmount} XLM</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Function</span>
                        <span className="text-white font-mono text-xs">{req.functionName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Contract</span>
                        <span className="text-white font-mono text-xs">{req.contractId.slice(0, 8)}…</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between items-start">
                    <span className="text-slate-400">Network fee</span>
                    {quote ? (
                      quote.sponsored ? (
                        <div className="text-right">
                          <span className="text-slate-500 line-through text-xs">{quote.feeXlm} XLM</span>
                          <p className="text-green-400 text-xs mt-0.5">Sponsored by {quote.sponsorName}</p>
                        </div>
                      ) : (
                        <span className="text-white">{quote.feeXlm} XLM</span>
                      )
                    ) : (
                      <span className="text-slate-600 animate-pulse text-xs">Calculating…</span>
                    )}
                  </div>
                </>
              )}

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

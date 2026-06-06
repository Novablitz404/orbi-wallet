'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Address, Networks, Asset, nativeToScVal } from '@stellar/stellar-sdk';
import { xdr } from '@stellar/stellar-sdk';
import { loadWallet } from '../../lib/storage';
import { STELLAR_TOKENS, tokenLetterAvatar, XLM_ICON, stellarExpertIcon } from '../../lib/tokens';
import BackButton from '../../components/BackButton';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;
const KEYS_URL = 'https://keys.orbiwallet.xyz';
const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

type Step = 'form' | 'quoting' | 'confirm' | 'signing' | 'error';

interface Quote {
  quoteId: string;
  feeStroops: number;
  feeXlm: string;
  authEntryXdr: string;
  currentLedger: number;
  nativeSacId: string;
}

interface SendToken {
  code: string;
  name: string;
  sacId: string;
  decimals: number;
  iconSrc: string;
}

const XLM_TOKEN: SendToken = { code: 'XLM', name: 'Stellar', sacId: NATIVE_SAC_ID, decimals: 7, iconSrc: XLM_ICON };

export default function SendPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('form');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [wallet, setWallet] = useState<ReturnType<typeof loadWallet>>(null);
  const [selectedToken, setSelectedToken] = useState<SendToken>(XLM_TOKEN);
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);

  useEffect(() => {
    const w = loadWallet();
    if (!w) { router.replace('/'); return; }
    setWallet(w);

    fetch(`${RELAY_URL}/v1/wallet/balance/${w.walletAddress}`)
      .then(r => r.json()).then((d: { xlm?: string }) => setXlmBalance(d.xlm ?? '0'))
      .catch(() => {});

    Promise.all(
      STELLAR_TOKENS.map(token =>
        fetch(`${RELAY_URL}/v1/wallet/token-balance/${w.walletAddress}/${token.sacId}`)
          .then(r => r.json())
          .then((d: { balance?: string }) => ({ sacId: token.sacId, balance: d.balance ?? '0' }))
          .catch(() => ({ sacId: token.sacId, balance: '0' }))
      )
    ).then(results => {
      const map: Record<string, string> = {};
      results.forEach(({ sacId, balance }) => { map[sacId] = balance; });
      setTokenBalances(map);
    });
  }, [router]);

  function getAvailableTokens(): SendToken[] {
    const tokens: SendToken[] = [XLM_TOKEN];
    for (const t of STELLAR_TOKENS) {
      const raw = tokenBalances[t.sacId] ?? '0';
      if (BigInt(raw) > 0n) {
        tokens.push({ code: t.code, name: t.name, sacId: t.sacId, decimals: t.decimals, iconSrc: stellarExpertIcon(t.code, t.issuer) });
      }
    }
    return tokens;
  }

  function buildTransferArgs(from: string, recipient: string, units: number): xdr.ScVal[] {
    return [
      new Address(from).toScVal(),
      new Address(recipient).toScVal(),
      nativeToScVal(BigInt(units), { type: 'i128' }),
    ];
  }

  async function handlePreview() {
    if (!wallet || !to.trim() || !amount) return;
    setStep('quoting');
    setError('');

    try {
      const amountUnits = Math.round(parseFloat(amount) * 10 ** selectedToken.decimals);
      const args = buildTransferArgs(wallet.walletAddress, to, amountUnits);
      const argsXdr = args.map(a => Buffer.from(a.toXDR()).toString('base64'));

      const res = await fetch(`${RELAY_URL}/v1/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          walletAddress: wallet.walletAddress,
          contractId: selectedToken.sacId,
          functionName: 'transfer',
          argsXdr,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? 'Quote failed');
      }

      setQuote(await res.json() as Quote);
      setStep('confirm');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Quote failed');
      setStep('error');
    }
  }

  function handleSend() {
    if (!wallet || !quote) return;
    setStep('signing');

    const amountUnits = Math.round(parseFloat(amount) * 10 ** selectedToken.decimals);
    const argsXdrRaw = buildTransferArgs(wallet.walletAddress, to, amountUnits)
      .map(a => Buffer.from(a.toXDR()).toString('base64'));

    const params = new URLSearchParams({
      redirect: 'https://account.orbiwallet.xyz/sign-callback',
      origin: window.location.origin,
      walletAddress: wallet.walletAddress,
      contractId: selectedToken.sacId,
      functionName: 'transfer',
      argsXdr: JSON.stringify(argsXdrRaw),
    });
    window.location.href = `${KEYS_URL}/sign?${params}`;
  }

  if (!wallet) return null;

  const availableTokens = getAvailableTokens();

  return (
    <main className="flex flex-col min-h-screen bg-[#020817] px-4">
      <div className="flex items-center gap-3 pt-6 pb-6">
        <BackButton onClick={() => router.back()} />
        <h1 className="text-white font-semibold">Send</h1>
      </div>

      {(step === 'form' || step === 'quoting' || step === 'confirm') && (
        <div className="flex flex-col gap-4">

          {/* Token selector */}
          <div className="relative">
            <button
              onClick={() => step === 'form' && setTokenSelectorOpen(o => !o)}
              disabled={step !== 'form'}
              className="flex items-center justify-between w-full p-3 rounded-xl bg-slate-800 border border-slate-700 hover:border-slate-600 transition-colors disabled:opacity-60"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden">
                  <img src={selectedToken.iconSrc} alt={selectedToken.code} className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(selectedToken.code); }} />
                </div>
                <div className="text-left">
                  <p className="text-white text-sm font-medium">{selectedToken.name}</p>
                  <p className="text-slate-500 text-xs">{selectedToken.code}</p>
                </div>
              </div>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${tokenSelectorOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
            </button>

            {tokenSelectorOpen && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl z-10">
                {availableTokens.map(token => (
                  <button
                    key={token.sacId}
                    onClick={() => { setSelectedToken(token); setAmount(''); setTokenSelectorOpen(false); }}
                    className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-slate-800 transition-colors text-left ${selectedToken.sacId === token.sacId ? 'bg-slate-800/60' : ''}`}
                  >
                    <div className="w-7 h-7 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                      <img src={token.iconSrc} alt={token.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(token.code); }} />
                    </div>
                    <div className="flex-1">
                      <p className="text-white text-sm font-medium">{token.name}</p>
                      <p className="text-slate-500 text-xs">{token.code}</p>
                    </div>
                    {selectedToken.sacId === token.sacId && (
                      <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-400 text-sm">To</label>
            <input
              type="text"
              placeholder="G... or C..."
              value={to}
              onChange={e => setTo(e.target.value)}
              disabled={step !== 'form'}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono text-sm disabled:opacity-60"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-slate-400 text-sm">Amount ({selectedToken.code})</label>
            <input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              disabled={step !== 'form'}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors text-xl font-semibold disabled:opacity-60"
            />
          </div>

          <div className="rounded-xl bg-slate-800/30 border border-slate-700/50 p-4 flex justify-between text-sm">
            <span className="text-slate-500">Network fee</span>
            <span className="text-slate-300">
              {step === 'quoting' ? (
                <span className="animate-pulse">Calculating…</span>
              ) : quote ? (
                `${quote.feeXlm} XLM`
              ) : '—'}
            </span>
          </div>

          {step === 'form' && (
            <button
              onClick={handlePreview}
              disabled={!to.trim() || !amount}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-40 mt-2"
            >
              Preview
            </button>
          )}

          {step === 'confirm' && quote && (
            <button
              onClick={handleSend}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors mt-2"
            >
              Send with passkey
            </button>
          )}
        </div>
      )}

      {step === 'signing' && (
        <div className="flex flex-col items-center gap-4 py-16">
          <svg className="animate-spin w-10 h-10 text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-white font-semibold">Redirecting to sign…</p>
        </div>
      )}

      {step === 'error' && (
        <div className="flex flex-col items-center gap-4 py-16">
          <p className="text-red-400 text-sm text-center">{error}</p>
          <button
            onClick={() => { setStep('form'); setQuote(null); setError(''); }}
            className="text-blue-400 text-sm hover:underline"
          >
            Try again
          </button>
        </div>
      )}
    </main>
  );
}

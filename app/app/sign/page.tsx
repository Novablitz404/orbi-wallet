'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { TransactionBuilder, Networks, Operation, Asset } from '@stellar/stellar-base';
import { formatEther, type TypedDataDefinition } from 'viem';
import { loadWallet, type Chain } from '../../lib/storage';
import { signTransactionWithPRF } from '../../lib/prf-wallet';
import { sendEvmTransaction, signEvmMessage, signEvmTypedData } from '../../lib/evm-wallet';
import { getEvmChain } from '../../lib/chains';
import { TREASURY_ADDRESS } from '../../lib/tokens';

type Step = 'loading' | 'review' | 'signing' | 'done' | 'error';

type EvmAction = 'tx' | 'message' | 'typedData';

interface SignRequest {
  channelId: string;
  walletAddress: string;
  chain: Chain;
  // Stellar
  xdr: string;            // base64 TransactionEnvelope XDR
  network: 'testnet' | 'mainnet';
  // EVM
  evmAction: EvmAction;
  chainId: number;
  to: string;
  value: string;          // wei (decimal string)
  data: string;           // 0x calldata
  message: string;        // personal_sign payload
  typedData: string;      // JSON for eth_signTypedData_v4
  origin: string;
}

// Whole numbers show with no decimals, fractional amounts with exactly 2 —
// classic Stellar amounts carry up to 7 decimal places, which reads as noise.
function formatAmount(amount: string): string {
  const n = parseFloat(amount);
  return Number.isInteger(n) ? n.toString() : n.toFixed(2);
}

// Summarise what a G wallet transaction is doing (for the review UI).
function summariseGTx(txXdr: string, network: 'testnet' | 'mainnet'): { lines: string[]; feeXlm: string | null } {
  try {
    const passphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
    const tx = TransactionBuilder.fromXDR(txXdr, passphrase);
    // tx.fee is the transaction's actual declared total fee (in stroops) —
    // show what the user is really about to pay, not a guessed constant.
    const feeXlm = (parseInt(tx.fee, 10) / 1e7).toString();

    if (!('operations' in tx)) return { lines: ['Sign transaction'], feeXlm };

    const ops: string[] = (tx as { operations: Operation[] }).operations
      // Orbi's swap-fee payment to its treasury rides along inside the same
      // signed transaction as the swap — it's an internal charge, not a
      // user-directed send, so it's omitted from this user-facing summary.
      .filter(op => !(op.type === 'payment' && (op as Operation.Payment).destination === TREASURY_ADDRESS))
      .map(op => {
        if (op.type === 'payment') {
          const p = op as Operation.Payment;
          const asset = p.asset.isNative() ? 'XLM' : p.asset.code;
          return `Send ${formatAmount(p.amount)} ${asset} to ${p.destination.slice(0, 6)}…${p.destination.slice(-4)}`;
        }
        if (op.type === 'pathPaymentStrictSend' || op.type === 'pathPaymentStrictReceive') {
          return 'Swap';
        }
        if (op.type === 'changeTrust') {
          const c = op as Operation.ChangeTrust;
          // c.line is an Asset for ordinary trustlines, or a LiquidityPoolAsset
          // (no code/issuer — just pool parameters) for pool-share trustlines.
          const asset = c.line instanceof Asset
            ? (c.line.isNative() ? 'XLM' : c.line.getCode())
            : 'liquidity pool shares';
          return `Add trustline: ${asset}`;
        }
        return op.type;
      });

    return { lines: ops, feeXlm };
  } catch {
    return { lines: ['Sign transaction'], feeXlm: null };
  }
}

// Human summary for an EVM request. Note the inherent clear-signing limit:
// arbitrary contract calls can't be fully decoded the way Stellar XDR can, so
// we surface to/value/calldata honestly rather than pretending to interpret it.
function summariseEvm(r: SignRequest): string[] {
  let symbol = 'ETH';
  try { symbol = getEvmChain(r.chainId).nativeCurrency.symbol; } catch { /* unknown chain */ }

  if (r.evmAction === 'message') return ['Sign message', r.message];
  if (r.evmAction === 'typedData') {
    try {
      const td = JSON.parse(r.typedData);
      return ['Sign typed data', td?.domain?.name ? `Domain: ${td.domain.name}` : 'EIP-712'];
    } catch { return ['Sign typed data']; }
  }

  const short = `${r.to.slice(0, 6)}…${r.to.slice(-4)}`;
  const amount = r.value && r.value !== '0' ? `${formatEther(BigInt(r.value))} ${symbol}` : null;
  if (r.data) {
    return amount ? [`Contract call to ${short}`, `Value: ${amount}`] : [`Contract call to ${short}`];
  }
  return [`Send ${amount ?? `0 ${symbol}`} to ${short}`];
}

/**
 * keys.orbiwallet.xyz/sign
 *
 * Stellar URL params: xdr, network, walletAddress, origin.
 * EVM URL params: chain=botchain, evmAction (tx|message|typedData), chainId,
 * to/value/data | message | typedData, walletAddress, origin.
 */
export default function SignPage() {
  const [step, setStep] = useState<Step>('loading');
  const [req, setReq] = useState<SignRequest | null>(null);
  const [error, setError] = useState('');
  const [gSummary, setGSummary] = useState<string[]>([]);
  const [feeXlm, setFeeXlm] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const chain: Chain = params.get('chain') === 'botchain' ? 'botchain' : 'stellar';
    const network = (params.get('network') ?? 'testnet') as 'testnet' | 'mainnet';
    const evmAction = (params.get('evmAction') ?? 'tx') as EvmAction;

    const r: SignRequest = {
      channelId: params.get('channelId') ?? '',
      walletAddress: params.get('walletAddress') ?? '',
      chain,
      xdr: params.get('xdr') ?? '',
      network,
      evmAction,
      chainId: Number(params.get('chainId') ?? 0),
      to: params.get('to') ?? '',
      value: params.get('value') ?? '',
      data: params.get('data') ?? '',
      message: params.get('message') ?? '',
      typedData: params.get('typedData') ?? '',
      origin: params.get('origin') ?? '',
    };

    if (chain === 'stellar' && !r.xdr) { setError('Missing transaction XDR'); setStep('error'); return; }
    if (chain === 'botchain') {
      if (evmAction === 'tx' && (!r.to || !r.chainId)) { setError('Missing transaction details'); setStep('error'); return; }
      if (evmAction === 'message' && !r.message) { setError('Missing message'); setStep('error'); return; }
      if (evmAction === 'typedData' && !r.typedData) { setError('Missing typed data'); setStep('error'); return; }
    }

    // If walletAddress wasn't provided in URL, get it from storage
    if (!r.walletAddress) {
      const stored = loadWallet();
      if (stored) r.walletAddress = stored.walletAddress;
    }

    setReq(r);
    if (chain === 'stellar') {
      const summary = summariseGTx(r.xdr, r.network);
      setGSummary(summary.lines);
      setFeeXlm(summary.feeXlm);
    } else {
      setGSummary(summariseEvm(r));
      setFeeXlm(null);
    }
    setStep('review');
  }, []);

  function postToOpener(msg: Record<string, unknown>) {
    if (req?.channelId) {
      const bc = new BroadcastChannel(req.channelId);
      bc.postMessage(msg);
      bc.close();
    }
    try { if (window.opener) window.opener.postMessage(msg, '*'); } catch { /* COOP */ }
  }

  function sendResult(signedXdr: string) {
    postToOpener({ type: 'orbi_g_signed', signedXdr, walletAddress: req?.walletAddress });
    setTimeout(() => window.close(), 500);
  }

  function sendEvmResult(txHash: string) {
    postToOpener({ type: 'orbi_evm_sent', txHash, walletAddress: req?.walletAddress });
    setTimeout(() => window.close(), 500);
  }

  function sendEvmSignature(signature: string) {
    postToOpener({ type: 'orbi_evm_signed', signature, walletAddress: req?.walletAddress });
    setTimeout(() => window.close(), 500);
  }

  function sendCancel() {
    postToOpener({ type: 'orbi_cancelled' });
    window.close();
  }

  async function handleSign() {
    if (!req) return;
    setStep('signing');
    setError('');
    try {
      const wallet = loadWallet();
      if (!wallet) throw new Error('Not signed in');
      const expected = req.walletAddress || wallet.walletAddress;

      if (req.chain === 'botchain') {
        if (req.evmAction === 'message') {
          sendEvmSignature(await signEvmMessage(wallet.credentialId, req.message, expected));
        } else if (req.evmAction === 'typedData') {
          const typedData = JSON.parse(req.typedData) as TypedDataDefinition;
          sendEvmSignature(await signEvmTypedData(wallet.credentialId, typedData, expected));
        } else {
          const txHash = await sendEvmTransaction(
            wallet.credentialId,
            req.chainId,
            { to: req.to, value: req.value || undefined, data: req.data || undefined },
            expected,
          );
          sendEvmResult(txHash);
        }
      } else {
        const signedXdr = await signTransactionWithPRF(wallet.credentialId, req.xdr, req.network, expected);
        sendResult(signedXdr);
      }
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

        <Image src="/Orbi Icon.png" alt="Orbi" width={56} height={56} className="w-14 h-14 rounded-2xl" priority />

        {step === 'loading' && (
          <div className="animate-pulse text-slate-500 text-sm">Loading…</div>
        )}

        {step === 'review' && req && (
          <>
            <div className="text-center">
              <h1 className="text-xl font-bold text-white">
                {req.chain === 'botchain' && req.evmAction !== 'tx' ? 'Signature Request' : 'Approve Transaction'}
              </h1>
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
                <span className="text-white capitalize">
                  {req.chain === 'botchain'
                    ? (() => { try { return getEvmChain(req.chainId).name; } catch { return 'BOT Chain'; } })()
                    : `Stellar ${req.network}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Fee</span>
                <span className="text-white">
                  {feeXlm !== null
                    ? `${feeXlm} XLM`
                    : req.chain === 'botchain' && req.evmAction === 'tx'
                      ? 'Gas in network token'
                      : '—'}
                </span>
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

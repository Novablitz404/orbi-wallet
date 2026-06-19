'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { formatEther } from 'viem';
import { OrbiClient } from '@orbi-wallet/sdk';
import { getNetworkPreference, type StellarNetwork } from '../../lib/storage';
import { getEvmBalance } from '../../lib/evm-wallet';
import { botchain } from '../../lib/chains';

const NETWORK = getNetworkPreference();
const orbi = new OrbiClient({ network: NETWORK, chain: 'botchain' });

export default function BotChainDashboard({ onSwitchChain }: { onSwitchChain: () => void }) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [network] = useState<StellarNetwork>(NETWORK);
  const [balance, setBalance] = useState<string | null>(null);
  const [panel, setPanel] = useState<'none' | 'send' | 'receive'>('none');
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (orbi.getAddress() && orbi.getChain() === 'botchain') {
      setAddress(orbi.getAddress());
    } else {
      router.replace('/');
    }
  }, [router]);

  async function refresh(addr: string) {
    try {
      setBalance(formatEther(await getEvmBalance(network, addr)));
    } catch {
      setBalance(null);
    }
  }

  useEffect(() => {
    if (address) refresh(address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function handleSend() {
    if (!address) return;
    setBusy(true);
    setError('');
    setTxHash(null);
    try {
      // Signing + submission happen in the keys.orbiwallet.xyz popup (the
      // passkey's origin), then the tx hash comes back over postMessage.
      const { txHash } = await orbi.signEvmTransaction({ to: to.trim(), value: amount.trim() });
      setTxHash(txHash);
      setTo('');
      setAmount('');
      setTimeout(() => refresh(address), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally {
      setBusy(false);
    }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function signOut() {
    orbi.disconnect();
    router.replace('/');
  }

  if (!address) return null;

  const explorer = botchain(network).blockExplorers.default.url;

  return (
    <main className="min-h-screen bg-[#020817] text-white px-4 py-8">
      <div className="max-w-md mx-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/Orbi Icon.png" alt="Orbi" width={32} height={32} className="w-8 h-8 rounded-xl" priority />
            <span className="font-semibold">BOT Chain</span>
            <span className="text-xs px-2 py-0.5 rounded-full border border-slate-700 text-slate-400 capitalize">{network}</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onSwitchChain} className="text-xs text-slate-400 hover:text-white">Switch to Stellar</button>
            <button onClick={signOut} className="text-xs text-slate-500 hover:text-slate-300">Sign out</button>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-6 flex flex-col items-center gap-2">
          <p className="text-slate-400 text-xs">Balance</p>
          <p className="text-3xl font-bold">{balance ?? '…'} <span className="text-base text-slate-400">BOT</span></p>
          <button onClick={copyAddress} className="text-xs text-slate-500 hover:text-slate-300 font-mono mt-1">
            {copied ? 'Copied!' : `${address.slice(0, 8)}…${address.slice(-6)}`}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setPanel(panel === 'send' ? 'none' : 'send')}
            className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold">Send</button>
          <button onClick={() => setPanel(panel === 'receive' ? 'none' : 'receive')}
            className="py-3 rounded-xl border border-slate-700 hover:border-slate-500 font-semibold">Receive</button>
        </div>

        {panel === 'receive' && (
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-2">
            <p className="text-slate-400 text-xs">Your address</p>
            <p className="font-mono text-sm break-all">{address}</p>
            <button onClick={copyAddress} className="self-start text-xs text-blue-400">
              {copied ? 'Copied!' : 'Copy address'}
            </button>
          </div>
        )}

        {panel === 'send' && (
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4 flex flex-col gap-3">
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="Recipient 0x…"
              className="bg-slate-900 rounded-xl p-3 font-mono text-sm outline-none" />
            <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (BOT)" inputMode="decimal"
              className="bg-slate-900 rounded-xl p-3 font-mono text-sm outline-none" />
            <button onClick={handleSend} disabled={busy || !to || !amount}
              className="py-3 rounded-xl bg-blue-600 hover:bg-blue-500 font-semibold disabled:opacity-50">
              {busy ? 'Confirm in popup…' : 'Send with passkey'}
            </button>
          </div>
        )}

        {txHash && (
          <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer"
            className="text-sm text-green-400 break-all">View transaction ↗</a>
        )}
        {error && <p className="text-red-400 text-sm break-all">{error}</p>}
      </div>
    </main>
  );
}

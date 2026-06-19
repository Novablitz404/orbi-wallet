'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { formatEther, parseEther } from 'viem';
import { OrbiClient } from '@orbi-wallet/sdk';
import { getNetworkPreference, setNetworkPreference, type StellarNetwork } from '../../lib/storage';
import { getEvmBalance } from '../../lib/evm-wallet';
import { getEvmChain, defaultEvmChainId } from '../../lib/chains';

const NETWORK = getNetworkPreference();
const CHAIN_ID = defaultEvmChainId(NETWORK);
const orbi = new OrbiClient({ network: NETWORK, chain: 'botchain', chainId: CHAIN_ID });

const dicebearUrl = (seed: string, size: number) =>
  `https://api.dicebear.com/9.x/rings/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

function truncate(addr: string) { return `${addr.slice(0, 6)}...${addr.slice(-4)}`; }
function fmt(n: number): string { return parseFloat(n.toFixed(4)).toString(); }

type Nav = 'assets' | 'activity' | 'apps';

export default function EvmDashboard({ onSwitchChain }: { onSwitchChain: () => void }) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<Nav>('assets');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'send' | 'receive'>('send');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [txHash, setTxHash] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);
  const networkMenuRef = useRef<HTMLDivElement>(null);

  const chain = getEvmChain(CHAIN_ID);
  const symbol = chain.nativeCurrency.symbol;
  const explorer = chain.blockExplorers!.default.url;

  useEffect(() => {
    if (orbi.getAddress() && orbi.getChain() === 'botchain') setAddress(orbi.getAddress());
    else router.replace('/');
  }, [router]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(t) && mobileDropdownRef.current && !mobileDropdownRef.current.contains(t)) setDropdownOpen(false);
      if (networkMenuRef.current && !networkMenuRef.current.contains(t)) setNetworkMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function refresh(addr: string) {
    try { setBalance(formatEther(await getEvmBalance(CHAIN_ID, addr))); } catch { setBalance(null); }
  }
  useEffect(() => { if (address) refresh(address); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [address]);

  function openPanel(tab: 'send' | 'receive') { setPanelTab(tab); setPanelOpen(true); setError(''); }
  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function disconnect() { orbi.disconnect(); router.replace('/'); }

  async function handleSend() {
    if (!address) return;
    setBusy(true); setError(''); setTxHash(null);
    try {
      const { txHash } = await orbi.signEvmTransaction({ to: sendTo.trim(), value: parseEther(sendAmount.trim()).toString(), chainId: CHAIN_ID });
      setTxHash(txHash);
      setSendTo(''); setSendAmount('');
      setPanelOpen(false);
      setTimeout(() => refresh(address), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transaction failed');
    } finally { setBusy(false); }
  }

  if (!address) return null;

  const bal = balance !== null ? parseFloat(balance) : null;

  const accountMenu = (
    <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
      <div className="px-5 pt-5 pb-3">
        <p className="text-white font-semibold text-base mb-4">Your Account</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={dicebearUrl(address, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
            <button onClick={copyAddress} className="flex items-center gap-1.5 text-white text-sm font-medium hover:text-slate-300 transition-colors">
              <span className="font-mono">{truncate(address)}</span>
              <span className="text-slate-500">{copied ? '✓' : '⎘'}</span>
            </button>
          </div>
          <p className="text-white text-sm font-medium">{bal !== null ? `${fmt(bal)} ${symbol}` : '—'}</p>
        </div>
      </div>
      <div className="px-3 pb-3 flex flex-col gap-1">
        <button onClick={() => { setDropdownOpen(false); onSwitchChain(); }} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
          <span className="text-white text-sm font-medium">Switch to Stellar</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </button>
        <a href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700/80 transition-colors">
          <span className="text-white text-sm font-medium">Settings</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </a>
        <button onClick={disconnect} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
          <span className="text-red-400 text-sm font-medium">Disconnect</span>
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] md:h-auto md:min-h-screen bg-[#020817] relative overflow-hidden md:overflow-visible font-display">

      {/* ── Sidebar ── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-slate-800 px-4 py-6 shrink-0">
        <Image src="/Orbi logo - Landscape white.png" alt="Orbi" width={1862} height={647} className="h-9 w-auto max-w-[140px] mb-8" priority />
        <nav className="flex flex-col gap-1">
          {[
            { id: 'assets' as const, label: 'Assets', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M12 6v6l4 2"/></svg> },
            { id: 'activity' as const, label: 'Activity', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg> },
            { id: 'apps' as const, label: 'Apps', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg> },
          ].map(({ id, label, icon }) => (
            <button key={id} onClick={() => setActiveNav(id)} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeNav === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}>
              {icon}{label}
            </button>
          ))}
        </nav>
        <div className="mt-8">
          <p className="text-slate-600 text-xs font-medium uppercase tracking-wider px-3 mb-2">Actions</p>
          <div className="flex flex-col gap-1">
            <button onClick={() => openPanel('send')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>Send
            </button>
            <button onClick={() => openPanel('receive')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>Receive
            </button>
          </div>
        </div>
        <div className="mt-auto" />
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 flex flex-col overflow-hidden md:overflow-visible">
        {/* Top bar */}
        <div className="hidden md:flex items-center justify-end px-10 pt-6 pb-2">
          <div className="relative" ref={dropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
              <img src={dicebearUrl(address, 24)} alt="avatar" className="w-6 h-6 rounded-full" />
              <span className="font-mono">{truncate(address)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && accountMenu}
          </div>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-6 pb-4 border-b border-slate-800">
          <Image src="/Orbi logo - Landscape white.png" alt="Orbi" width={1862} height={647} className="h-6 w-auto" priority />
          <div className="relative" ref={mobileDropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
              <img src={dicebearUrl(address, 22)} alt="avatar" className="w-5 h-5 rounded-full" />
              <span className="font-mono">{truncate(address)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && accountMenu}
          </div>
        </div>

        <div className="px-6 md:px-10 py-6 pb-4 flex-1 overflow-y-auto md:overflow-visible min-h-0">
          <div className="mb-4 text-left">
            <p className="text-slate-400 text-base mb-1">Your balance:</p>
            <p className="text-5xl md:text-6xl font-bold text-white">
              {bal === null ? <span className="animate-pulse text-slate-600">···</span> : <>{fmt(bal)} <span className="text-2xl md:text-3xl text-slate-400">{symbol}</span></>}
            </p>
          </div>

          <div className="md:hidden flex gap-3 mb-6">
            <button onClick={() => openPanel('send')} className="flex-1 py-3 rounded-2xl bg-white text-slate-900 font-semibold text-sm">Send</button>
            <button onClick={() => openPanel('receive')} className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm">Receive</button>
          </div>

          {activeNav === 'assets' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-medium">Tokens</h2>
                <div className="relative" ref={networkMenuRef}>
                  <button onClick={() => setNetworkMenuOpen(o => !o)} title="Switch network — reloads the app"
                    className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 bg-slate-800/50 transition-colors">
                    {NETWORK === 'mainnet' ? 'Mainnet' : 'Testnet'}
                    <svg className={`w-3 h-3 text-slate-500 transition-transform ${networkMenuOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {networkMenuOpen && (
                    <div className="absolute right-0 top-full mt-2 w-32 bg-slate-900 border border-slate-700/50 rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                      {(['mainnet', 'testnet'] as const).map(net => (
                        <button key={net} onClick={() => { setNetworkMenuOpen(false); if (net === NETWORK) return; setNetworkPreference(net); window.location.reload(); }}
                          className={`flex items-center justify-between w-full px-3 py-2.5 text-sm transition-colors ${net === NETWORK ? 'text-white bg-slate-800' : 'text-slate-400 hover:text-white hover:bg-slate-800/60'}`}>
                          {net === 'mainnet' ? 'Mainnet' : 'Testnet'}
                          {net === NETWORK && (<svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 px-4 pb-2 border-b border-slate-800 text-slate-500 text-xs font-medium">
                <span>Asset</span><span className="text-right">Balance</span>
                <span className="text-right hidden md:block">Portfolio %</span>
                <span className="text-right hidden md:block">Price</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 px-4 py-4 items-center hover:bg-slate-800/20 transition-colors rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">{symbol.slice(0, 1)}</div>
                  <div><p className="text-white text-sm font-medium">{chain.nativeCurrency.name}</p><p className="text-slate-500 text-xs">{symbol}</p></div>
                </div>
                <div className="text-right">
                  <p className="text-white text-sm font-medium">{bal !== null ? `${fmt(bal)} ${symbol}` : <span className="animate-pulse">···</span>}</p>
                </div>
                <div className="text-right hidden md:block"><p className="text-white text-sm">100%</p></div>
                <div className="text-right hidden md:block"><p className="text-white text-sm">—</p></div>
              </div>
            </>
          )}

          {activeNav === 'activity' && (
            <div className="flex flex-col gap-4">
              <h2 className="text-white font-medium">Activity</h2>
              <div className="rounded-2xl bg-slate-800/40 border border-slate-700 p-6 text-center">
                <p className="text-slate-400 text-sm mb-3">Full transaction history isn&apos;t indexed yet for this chain.</p>
                <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="text-blue-400 text-sm hover:underline">View this wallet on {chain.blockExplorers!.default.name} ↗</a>
              </div>
            </div>
          )}

          {activeNav === 'apps' && (
            <div className="flex flex-col gap-4">
              <h2 className="text-white font-medium">Apps</h2>
              <div className="rounded-2xl bg-slate-800/40 border border-slate-700 p-6 text-center">
                <p className="text-slate-400 text-sm">Connected apps will appear here.</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Send/Receive slide panel ── */}
      {panelOpen && (<div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPanelOpen(false)} />)}

      <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-slate-900 border-l border-slate-700/50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        <div className="flex items-center justify-between p-5 border-b border-slate-800">
          <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
          </button>
          <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
            <button onClick={() => setPanelTab('send')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'send' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Send</button>
            <button onClick={() => setPanelTab('receive')} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'receive' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Receive</button>
          </div>
          <div className="w-5" />
        </div>

        {panelTab === 'send' && (
          <div className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
            <div className="flex items-center gap-3 py-4 border-b border-slate-800">
              <input type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)} placeholder="0"
                className="flex-1 bg-transparent text-4xl font-bold text-white outline-none min-w-0" />
              <span className="text-slate-400 font-medium">{symbol}</span>
            </div>
            <div>
              <label className="text-slate-400 text-xs">Recipient address</label>
              <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="0x…"
                className="w-full mt-1 bg-slate-800 rounded-xl p-3 font-mono text-sm text-white outline-none" />
            </div>
            {error && <p className="text-red-400 text-sm break-all">{error}</p>}
            <button onClick={handleSend} disabled={busy || !sendTo || !sendAmount}
              className="mt-auto py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
              {busy ? 'Confirm in popup…' : 'Send with passkey'}
            </button>
          </div>
        )}

        {panelTab === 'receive' && (
          <div className="flex-1 flex flex-col p-5 gap-4 items-center">
            <p className="text-slate-400 text-sm mt-4">Your {chain.name} address</p>
            <img src={dicebearUrl(address, 96)} alt="avatar" className="w-20 h-20 rounded-2xl" />
            <p className="font-mono text-sm text-white break-all text-center bg-slate-800 rounded-xl p-3 w-full">{address}</p>
            <button onClick={copyAddress} className="py-3 px-5 rounded-2xl bg-white text-slate-900 font-semibold text-sm">{copied ? 'Copied!' : 'Copy address'}</button>
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {txHash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <span className="text-green-400 text-sm">Sent!</span>
          <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 text-sm hover:underline">View ↗</a>
          <button onClick={() => setTxHash(null)} className="text-slate-500 text-sm">✕</button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatEther, parseEther } from 'viem';
import { OrbiClient } from '@orbi-wallet/sdk';
import DashboardChrome from '../../components/DashboardChrome';
import { getNetworkPreference, setNetworkPreference } from '../../lib/storage';
import { getEvmBalance } from '../../lib/evm-wallet';
import { getEvmChain, defaultEvmChainId } from '../../lib/chains';

const NETWORK = getNetworkPreference();
const CHAIN_ID = defaultEvmChainId(NETWORK);
const orbi = new OrbiClient({ network: NETWORK, chain: 'botchain', chainId: CHAIN_ID });

const dicebearUrl = (seed: string, size: number) =>
  `https://api.dicebear.com/9.x/rings/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

function fmt(n: number): string { return parseFloat(n.toFixed(4)).toString(); }
function truncate(addr: string) { return `${addr.slice(0, 6)}...${addr.slice(-4)}`; }

type Nav = 'assets' | 'activity' | 'apps';
type PanelStep = 'send-form' | 'send-preview' | 'receive';

interface EvmTx {
  hash: string;
  from: string;
  to: string;
  value: string;     // wei
  timeStamp: string; // unix seconds
  isError: string;
}

export default function EvmDashboard({ onSwitchChain }: { onSwitchChain: () => void }) {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState<Nav>('assets');
  const [networkMenuOpen, setNetworkMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<'send' | 'receive'>('send');
  const [panelStep, setPanelStep] = useState<PanelStep>('send-form');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  const [transactions, setTransactions] = useState<EvmTx[] | null>(null);
  const [txLoading, setTxLoading] = useState(false);

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
      if (networkMenuRef.current && !networkMenuRef.current.contains(e.target as Node)) setNetworkMenuOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function refresh(addr: string) {
    try { setBalance(formatEther(await getEvmBalance(CHAIN_ID, addr))); } catch { setBalance(null); }
  }
  useEffect(() => { if (address) refresh(address); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [address]);

  // Transaction history via the chain explorer's Etherscan-compatible API
  // (BotChain's BOTScan exposes ?module=account&action=txlist). Raw RPC can't
  // answer "all txs for an address", so we lean on the indexer the chain ships.
  async function fetchActivity(addr: string) {
    setTxLoading(true);
    try {
      const res = await fetch(`${explorer}/api?module=account&action=txlist&address=${addr}&page=1&offset=25&sort=desc`);
      const json = await res.json();
      setTransactions(Array.isArray(json.result) ? json.result : []);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }
  useEffect(() => {
    if (activeNav === 'activity' && address && transactions === null) fetchActivity(address);
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [activeNav, address]);

  function openPanel(tab: 'send' | 'receive') {
    setPanelTab(tab);
    setPanelStep(tab === 'send' ? 'send-form' : 'receive');
    setPanelOpen(true);
    setSendError('');
  }
  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  function disconnect() { orbi.disconnect(); router.replace('/'); }

  function handlePreview() {
    setSendError('');
    if (!/^0x[0-9a-fA-F]{40}$/.test(sendTo.trim())) { setSendError('Enter a valid 0x recipient address'); return; }
    if (!(parseFloat(sendAmount) > 0)) { setSendError('Enter an amount'); return; }
    setPanelStep('send-preview');
  }

  async function handleConfirm() {
    if (!address) return;
    setSending(true); setSendError('');
    try {
      const { txHash } = await orbi.signEvmTransaction({ to: sendTo.trim(), value: parseEther(sendAmount.trim()).toString(), chainId: CHAIN_ID });
      setTxHash(txHash);
      setSendTo(''); setSendAmount('');
      setPanelOpen(false); setPanelStep('send-form');
      setTimeout(() => { refresh(address); setTransactions(null); }, 4000);
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : 'Transaction failed');
      setPanelStep('send-form');
    } finally { setSending(false); }
  }

  if (!address) return null;

  const bal = balance !== null ? parseFloat(balance) : null;

  const headline = (
    <div className="mb-4 text-left">
      <p className="text-slate-400 text-base mb-1">Your balance:</p>
      <p className="text-5xl md:text-6xl font-bold text-white">
        {bal === null ? <span className="animate-pulse text-slate-600">···</span> : <>{fmt(bal)} <span className="text-2xl md:text-3xl text-slate-400">{symbol}</span></>}
      </p>
    </div>
  );

  const tabs = (
    <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
      <button onClick={() => { setPanelTab('send'); setPanelStep('send-form'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'send' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Send</button>
      <button onClick={() => { setPanelTab('receive'); setPanelStep('receive'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'receive' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Receive</button>
    </div>
  );

  const overlays = (
    <>
      {panelOpen && (<div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPanelOpen(false)} />)}

      <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-slate-900 border-l border-slate-700/50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* ── Send form ── */}
        {panelStep === 'send-form' && (
          <>
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
              {tabs}
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
              <div className="flex items-center gap-3 py-4 border-b border-slate-800">
                <input type="number" value={sendAmount} onChange={e => setSendAmount(e.target.value)} placeholder="0"
                  className="flex-1 bg-transparent text-5xl font-bold text-white outline-none placeholder-slate-700 w-0" />
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-2xl font-light">{symbol}</span>
                  <button onClick={() => bal !== null && setSendAmount(String(bal))} className="text-xs text-slate-500 border border-slate-700 px-2.5 py-1 rounded-lg hover:border-slate-500 transition-colors">Max</button>
                </div>
              </div>

              {/* Token (native only on EVM for now) */}
              <div className="flex items-center justify-between w-full p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm font-bold">{symbol.slice(0, 1)}</div>
                  <div className="text-left">
                    <p className="text-white text-sm font-medium">{chain.nativeCurrency.name}</p>
                    <p className="text-slate-500 text-xs">{bal !== null ? `${fmt(bal)} ${symbol}` : '—'} available</p>
                  </div>
                </div>
              </div>

              {/* Recipient */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <input value={sendTo} onChange={e => setSendTo(e.target.value)} placeholder="To: 0x…"
                  className="flex-1 bg-transparent text-white text-sm outline-none placeholder-slate-600 font-mono" />
              </div>

              {sendError && <p className="text-red-400 text-xs">{sendError}</p>}
            </div>

            <div className="p-5 border-t border-slate-800">
              <button onClick={handlePreview} disabled={!sendTo.trim() || !sendAmount}
                className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold flex items-center justify-center gap-2 transition-colors">
                Preview send <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </>
        )}

        {/* ── Send preview / confirm ── */}
        {panelStep === 'send-preview' && (
          <>
            <div className="flex items-center gap-3 p-5 border-b border-slate-800">
              <button onClick={() => setPanelStep('send-form')} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <span className="text-white text-sm font-medium flex-1 text-center">Confirm send</span>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col p-5 gap-5 overflow-y-auto">
              <div className="text-center py-4">
                <p className="text-4xl font-bold text-white">{sendAmount} {symbol}</p>
              </div>
              <div className="flex flex-col gap-3 rounded-2xl bg-slate-800/50 border border-slate-700/50 p-4 text-sm">
                <div className="flex justify-between"><span className="text-slate-400">From</span><span className="text-white font-mono">{truncate(address)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">To</span><span className="text-white font-mono">{truncate(sendTo)}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Network</span><span className="text-white">{chain.name}</span></div>
                <div className="flex justify-between"><span className="text-slate-400">Fee</span><span className="text-white">Gas in {symbol}</span></div>
              </div>
              {sendError && <p className="text-red-400 text-xs">{sendError}</p>}
            </div>

            <div className="p-5 border-t border-slate-800 flex gap-3">
              <button onClick={() => setPanelStep('send-form')} disabled={sending} className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold transition-colors">Back</button>
              <button onClick={handleConfirm} disabled={sending} className="flex-1 py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-semibold transition-colors">
                {sending ? 'Confirm in popup…' : 'Confirm'}
              </button>
            </div>
          </>
        )}

        {/* ── Receive ── */}
        {panelStep === 'receive' && (
          <>
            <div className="flex items-center gap-3 p-5 border-b border-slate-800">
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <div className="flex items-center gap-2 flex-1 justify-center">
                <img src={dicebearUrl(address, 20)} alt="avatar" className="w-5 h-5 rounded-full" />
                <span className="text-white text-sm font-medium font-mono">{truncate(address)}</span>
              </div>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col items-center p-6 gap-5 overflow-y-auto">
              <div className="p-4 bg-white rounded-2xl">
                <img src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(address)}&qzone=1&color=000000&bgcolor=ffffff`} alt="QR code" className="w-[220px] h-[220px]" />
              </div>
              <p className="text-white font-mono text-xs text-center break-all px-2 leading-relaxed">{address}</p>
              <button onClick={copyAddress} className="px-8 py-2.5 rounded-xl border border-slate-700 hover:border-slate-500 text-white text-sm font-medium transition-colors">{copied ? '✓ Copied!' : 'Copy'}</button>

              <div className="w-full flex flex-col gap-3 border-t border-slate-800 pt-4 mt-2">
                <div className="flex justify-between text-sm"><span className="text-slate-400">Balance</span><span className="text-white">{bal !== null ? `${fmt(bal)} ${symbol}` : '—'}</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Provider</span><span className="text-white">Orbi Wallet</span></div>
                <div className="flex justify-between text-sm"><span className="text-slate-400">Network</span><span className="text-white">{chain.name}</span></div>
              </div>

              <div className="w-full flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 mt-1">
                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <p className="text-yellow-400 text-xs">Only send {symbol} and {chain.name} (EVM) assets to this address.</p>
              </div>
            </div>
          </>
        )}
      </div>

      {txHash && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 shadow-2xl flex items-center gap-3">
          <span className="text-green-400 text-sm">Sent!</span>
          <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 text-sm hover:underline">View ↗</a>
          <button onClick={() => setTxHash(null)} className="text-slate-500 text-sm">✕</button>
        </div>
      )}
    </>
  );

  return (
    <DashboardChrome
      walletAddress={address}
      accountValue={bal !== null ? `${fmt(bal)} ${symbol}` : '—'}
      switchChainLabel="Switch to Stellar"
      copied={copied}
      activeNav={activeNav}
      onNav={(id) => setActiveNav(id as Nav)}
      onAction={(a) => { if (a !== 'swap') openPanel(a); }}
      onSwitchChain={onSwitchChain}
      onDisconnect={disconnect}
      onCopy={copyAddress}
      headline={headline}
      overlays={overlays}
    >
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
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-white font-medium">Activity</h2>
            <button onClick={() => fetchActivity(address)} disabled={txLoading}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40">Refresh</button>
          </div>

          {txLoading && transactions === null && (
            <p className="text-slate-500 text-sm py-10 text-center animate-pulse">Loading…</p>
          )}

          {!txLoading && transactions !== null && transactions.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <p className="text-slate-500 text-sm">No transactions yet</p>
              <p className="text-slate-600 text-xs text-center max-w-xs">Your transaction history will appear here after your first send or receive.</p>
            </div>
          )}

          {transactions && transactions.map(tx => {
            const isIncoming = tx.to?.toLowerCase() === address.toLowerCase();
            const amount = `${fmt(Number(formatEther(BigInt(tx.value || '0'))))} ${symbol}`;
            const date = new Date(Number(tx.timeStamp) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
            const counterparty = isIncoming ? tx.from : tx.to;
            return (
              <a key={tx.hash} href={`${explorer}/tx/${tx.hash}`} target="_blank" rel="noreferrer"
                className="flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-slate-800/20 transition-colors">
                <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-slate-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    {isIncoming
                      ? <path strokeLinecap="round" strokeLinejoin="round" d="M12 7.5v9m0 0l-3.5-3.5M12 16.5l3.5-3.5" />
                      : <path strokeLinecap="round" strokeLinejoin="round" d="M12 16.5v-9m0 0L8.5 11m3.5-3.5L15.5 11" />}
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{isIncoming ? 'Received' : 'Sent'}{tx.isError === '1' ? ' (failed)' : ''}</p>
                  <p className="text-slate-500 text-xs font-mono truncate">{counterparty ? truncate(counterparty) : '—'}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={`text-sm font-medium ${isIncoming ? 'text-green-400' : 'text-white'}`}>{isIncoming ? '+' : '-'}{amount}</p>
                  <p className="text-xs text-slate-500">{date}</p>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {activeNav === 'apps' && (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <p className="text-slate-500 text-sm">No apps connected</p>
          <p className="text-slate-600 text-xs text-center max-w-xs">Connect Orbi to {chain.name} dApps and they&apos;ll appear here.</p>
        </div>
      )}
    </DashboardChrome>
  );
}

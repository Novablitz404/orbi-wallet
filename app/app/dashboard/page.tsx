'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { loadWallet, clearWallet, getConnections, type StoredConnection } from '../../lib/storage';
import { Networks, Asset, TransactionBuilder, Operation, Account, BASE_FEE } from '@stellar/stellar-sdk';
import { STELLAR_TOKENS, tokenLetterAvatar, XLM_ICON, stellarExpertIcon, TOKEN_PRICE_IDS } from '../../lib/tokens';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

const dicebearUrl = (seed: string, size: number) =>
  `https://api.dicebear.com/9.x/rings/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

const KEYS_URL = 'https://keys.orbiwallet.xyz';
const ACCOUNT_URL = 'https://account.orbiwallet.xyz';
const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = NETWORK === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);

function truncate(addr: string) { return `${addr.slice(0, 6)}...${addr.slice(-4)}`; }
function fmt(n: number): string { return parseFloat(n.toFixed(2)).toString(); }

interface Quote { quoteId: string; feeXlm: string; nativeSacId: string; }
type PanelStep = 'send-form' | 'send-preview' | 'receive';

interface TxRecord {
  id: string;
  direction: 'outgoing' | 'incoming';
  type: 'transfer' | 'contract_call';
  status: 'pending' | 'batched' | 'confirmed' | 'failed';
  assetCode?: string;
  amount?: string;
  to?: string;
  from?: string;
  functionName?: string;
  contractId?: string;
  txHash?: string | null;
  createdAt: string;
}

interface SendToken {
  code: string;
  name: string;
  sacId: string;
  decimals: number;
  iconSrc: string;
  issuer?: string;
}

interface DisplayToken {
  code: string;
  name: string;
  sacId: string;
  decimals: number;
  iconSrc: string;
  issuer?: string;
}

const XLM_SEND_TOKEN: SendToken = {
  code: 'XLM', name: 'Stellar', sacId: NATIVE_SAC_ID, decimals: 7, iconSrc: XLM_ICON,
};

export default function DashboardPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<ReturnType<typeof loadWallet>>(null);
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [activeNav, setActiveNav] = useState('assets');
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  // Send/Receive panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelStep, setPanelStep] = useState<PanelStep>('send-form');
  const [panelTab, setPanelTab] = useState<'send' | 'receive'>('send');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendQuote, setSendQuote] = useState<Quote | null>(null);
  const [sendError, setSendError] = useState('');
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  const [selectedToken, setSelectedToken] = useState<SendToken>(XLM_SEND_TOKEN);
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);

  // Toast notification for tx confirmation
  type Toast = { type: 'pending' | 'success' | 'error'; message: string; txHash?: string };
  const [toast, setToast] = useState<Toast | null>(null);
  const [transactions, setTransactions] = useState<TxRecord[] | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txPage, setTxPage] = useState(1);
  const [txHasMore, setTxHasMore] = useState(false);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const outsideDesktop = !dropdownRef.current || !dropdownRef.current.contains(e.target as Node);
      const outsideMobile = !mobileDropdownRef.current || !mobileDropdownRef.current.contains(e.target as Node);
      if (outsideDesktop && outsideMobile) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  async function fetchHistory(walletAddress: string, page = 1) {
    setTxLoading(true);
    try {
      const cursor = page > 1 ? `&cursor=TODO` : ''; // simple pagination for now
      const res = await fetch(
        `${HORIZON_URL}/accounts/${walletAddress}/payments?order=desc&limit=10${cursor}`,
      );
      if (!res.ok) { if (page === 1) setTransactions([]); return; }
      const data = await res.json() as {
        _embedded: { records: Array<{
          id: string; type: string; created_at: string;
          from?: string; to?: string; amount?: string; asset_type?: string;
        }> };
        _links: { next?: { href?: string } };
      };
      const records = data._embedded?.records ?? [];
      const txs: TxRecord[] = records.map(r => ({
        id: r.id,
        direction: r.to === walletAddress ? 'incoming' : 'outgoing',
        type: 'transfer',
        status: 'confirmed',
        assetCode: r.asset_type === 'native' ? 'XLM' : undefined,
        amount: r.amount ? String(Math.round(parseFloat(r.amount) * 1e7)) : undefined,
        to: r.to,
        from: r.from,
        createdAt: r.created_at,
      }));
      setTransactions(prev => page === 1 ? txs : [...(prev ?? []), ...txs]);
      setTxHasMore(!!data._links?.next?.href);
      setTxPage(page);
    } catch {
      if (page === 1) setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => {
    const w = loadWallet();
    if (!w) { router.replace('/'); return; }
    setWallet(w);
    setConnections(getConnections(w.walletAddress));

    // Horizon's account record carries the native balance plus every trustline
    // balance in one call — no separate per-token lookups needed for a G wallet.
    fetch(`${HORIZON_URL}/accounts/${w.walletAddress}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> }) => {
        const balances = d.balances ?? [];
        const native = balances.find(b => b.asset_type === 'native');
        setXlmBalance(native?.balance ?? '0.0000000');

        const map: Record<string, string> = {};
        for (const token of STELLAR_TOKENS) {
          const trustline = balances.find(b => b.asset_code === token.code && b.asset_issuer === token.issuer);
          if (trustline) map[token.sacId] = String(Math.round(parseFloat(trustline.balance) * 10 ** token.decimals));
        }
        setTokenBalances(map);
      })
      .catch(() => setXlmBalance('0.0000000'));

    const priceIds = [...new Set(Object.values(TOKEN_PRICE_IDS))].join(',');
    fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${priceIds}&vs_currencies=usd`)
      .then(r => r.json())
      .then((d: Record<string, { usd?: number }>) => {
        const byCode: Record<string, number> = {};
        for (const [code, id] of Object.entries(TOKEN_PRICE_IDS)) {
          const p = d?.[id]?.usd;
          if (typeof p === 'number') byCode[code] = p;
        }
        setTokenPrices(byCode);
        if (typeof byCode.XLM === 'number') setXlmPrice(byCode.XLM);
      })
      .catch(() => { setXlmPrice(null); setTokenPrices({}); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // G wallet submits directly to Horizon — sign-callback redirects back with
  // either a txHash (success) or txError (failure) immediately, no polling needed.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const txError = params.get('txError');
    const txHash = params.get('txHash');

    // Clean URL immediately
    window.history.replaceState({}, '', '/dashboard');

    if (txError) {
      setToast({ type: 'error', message: decodeURIComponent(txError) });
    } else if (txHash) {
      setToast({ type: 'success', message: 'Sent!', txHash });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss success toast after 5 seconds
  useEffect(() => {
    if (toast?.type !== 'success') return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (activeNav === 'activity' && wallet && transactions === null) {
      fetchHistory(wallet.walletAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav, wallet]);

  function copyAddress() {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.walletAddress);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  function signOut() {
    clearWallet();
    window.location.href = 'https://keys.orbiwallet.xyz/signout?redirect=https://account.orbiwallet.xyz';
  }

  function openPanel(tab: 'send' | 'receive') {
    setPanelTab(tab);
    setPanelStep(tab === 'send' ? 'send-form' : 'receive');
    setSendTo(''); setSendAmount(''); setSendQuote(null); setSendError('');
    setSelectedToken(XLM_SEND_TOKEN);
    setTokenSelectorOpen(false);
    setPanelOpen(true);
  }

  // Derive selected token's available balance in human units
  function getSelectedBalance(): string {
    if (selectedToken.code === 'XLM') {
      return xlmBalance ? fmt(parseFloat(xlmBalance)) : '0';
    }
    const raw = tokenBalances[selectedToken.sacId] ?? '0';
    return fmt(Number(BigInt(raw)) / 10 ** selectedToken.decimals);
  }

  function setMax() {
    if (selectedToken.code !== 'XLM' || !xlmBalance) {
      setSendAmount(getSelectedBalance());
      return;
    }

    // Fee is always BASE_FEE, and the 1 XLM base reserve must remain.
    const balanceStroops = Math.floor(parseFloat(xlmBalance) * 1e7);
    const maxStroops = Math.max(0, balanceStroops - 100 - 10_000_000); // BASE_FEE + 1 XLM reserve
    setSendAmount((maxStroops / 1e7).toFixed(7).replace(/0+$/, '').replace(/\.$/, ''));
  }

  // Curated default tokens, with whatever balance the account's trustlines show.
  function getDisplayTokens(): DisplayToken[] {
    return STELLAR_TOKENS.map(t => ({
      code: t.code, name: t.name, sacId: t.sacId, decimals: t.decimals,
      iconSrc: stellarExpertIcon(t.code, t.issuer), issuer: t.issuer,
    }));
  }

  // All tokens with a non-zero balance, for the send selector
  function getAvailableTokens(): SendToken[] {
    const tokens: SendToken[] = [XLM_SEND_TOKEN];
    for (const t of getDisplayTokens()) {
      const raw = tokenBalances[t.sacId] ?? '0';
      if (BigInt(raw) > 0n) {
        tokens.push({ code: t.code, name: t.name, sacId: t.sacId, decimals: t.decimals, iconSrc: t.iconSrc, issuer: t.issuer });
      }
    }
    return tokens;
  }

  function handlePreview() {
    if (!wallet || !sendTo.trim() || !sendAmount) return;
    setSendError('');
    // Fee is always BASE_FEE (0.00001 XLM) for a classic Stellar payment.
    setSendQuote({ quoteId: '', feeXlm: '0.00001', nativeSacId: '' });
    setPanelStep('send-preview');
  }

  async function handleConfirm() {
    if (!wallet || !sendQuote) return;

    setSendError('');
    try {
      const accountRes = await fetch(`${HORIZON_URL}/accounts/${wallet.walletAddress}`);
      if (!accountRes.ok) throw new Error('Account not found on Stellar — deposit 1 XLM first');
      const accountData = await accountRes.json() as { sequence: string };
      const account = new Account(wallet.walletAddress, accountData.sequence);
      const tx = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(Operation.payment({
          destination: sendTo.trim(),
          asset: selectedToken.code === 'XLM' || !selectedToken.issuer
            ? Asset.native()
            : new Asset(selectedToken.code, selectedToken.issuer),
          amount: sendAmount,
        }))
        .setTimeout(30)
        .build();

      const txXdr = tx.toXDR();
      const params = new URLSearchParams({
        xdr: txXdr,
        network: NETWORK,
        redirect: `${ACCOUNT_URL}/sign-callback`,
        origin: window.location.origin,
        walletAddress: wallet.walletAddress,
      });
      window.location.href = `${KEYS_URL}/sign?${params}`;
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Failed to build transaction');
    }
  }

  const xlmFloat = xlmBalance ? parseFloat(xlmBalance) : 0;
  const xlmUsd = xlmPrice != null ? xlmFloat * xlmPrice : null;

  // Per-token portfolio: balance, price (where known), and USD value.
  const tokenEntries = getDisplayTokens().map(t => {
    const raw = tokenBalances[t.sacId];
    const bal = raw ? Number(BigInt(raw)) / 10 ** t.decimals : 0;
    const price = typeof tokenPrices[t.code] === 'number' ? tokenPrices[t.code] : null;
    const usd = price != null ? bal * price : null;
    return { token: t, bal, price, usd };
  });

  // Total portfolio value (priced holdings only) — drives the headline + percentages.
  const totalUsd = (xlmUsd ?? 0) + tokenEntries.reduce((s, e) => s + (e.bal > 0 ? (e.usd ?? 0) : 0), 0);
  const usdValue = xlmPrice != null ? totalUsd : null;
  const pct = (usd: number | null): number | null =>
    totalUsd > 0 && usd != null ? (usd / totalUsd) * 100 : null;

  // USD equivalent of the send amount — only for XLM
  const sendUsd = selectedToken.code === 'XLM' && xlmPrice && sendAmount
    ? (parseFloat(sendAmount) * xlmPrice).toFixed(2)
    : null;

  if (!wallet) return null;

  return (
    <div className="flex h-[100dvh] md:h-auto md:min-h-screen bg-[#020817] relative overflow-hidden md:overflow-visible">

      {/* ── Sidebar ── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-slate-800 px-4 py-6 shrink-0">
        <img src="/Orbi%20logo%20-%20Landscape%20white.png" alt="Orbi" className="h-9 w-auto max-w-[140px] mb-8" />
        <nav className="flex flex-col gap-1">
          {[
            { id: 'assets', label: 'Assets', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M12 6v6l4 2"/></svg> },
            { id: 'activity', label: 'Activity', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg> },
            { id: 'apps', label: 'Apps', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg> },
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
              <img src={dicebearUrl(wallet.walletAddress, 24)} alt="avatar" className="w-6 h-6 rounded-full" />
              <span className="font-mono">{truncate(wallet.walletAddress)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                <div className="px-5 pt-5 pb-3">
                  <p className="text-white font-semibold text-base mb-4">Your Account</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={dicebearUrl(wallet.walletAddress, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
                      <div>
                        <p className="text-white text-sm font-medium truncate max-w-[120px]">{wallet.email}</p>
                        <button onClick={copyAddress} className="flex items-center gap-1 text-slate-500 text-xs hover:text-slate-300 transition-colors">
                          <span className="font-mono">{truncate(wallet.walletAddress)}</span>
                          <span>{copied ? '✓' : '⎘'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="text-white text-sm font-medium">{usdValue !== null ? `$${usdValue.toFixed(2)}` : '—'}</p>
                  </div>
                </div>
                <div className="px-3 pb-3 flex flex-col gap-1">
                  <a href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700/80 transition-colors">
                    <span className="text-white text-sm font-medium">Settings</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </a>
                  <button onClick={signOut} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                    <span className="text-red-400 text-sm font-medium">Sign out</span>
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-6 pb-4 border-b border-slate-800">
          <img src="/Orbi%20logo%20-%20Landscape%20white.png" alt="Orbi" className="h-6 w-auto" />
          <div className="relative" ref={mobileDropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
              <img src={dicebearUrl(wallet.walletAddress, 22)} alt="avatar" className="w-5 h-5 rounded-full" />
              <span className="font-mono">{truncate(wallet.walletAddress)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                <div className="px-5 pt-5 pb-3">
                  <p className="text-white font-semibold text-base mb-4">Your Account</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={dicebearUrl(wallet.walletAddress, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
                      <div>
                        <p className="text-white text-sm font-medium truncate max-w-[120px]">{wallet.email}</p>
                        <button onClick={copyAddress} className="flex items-center gap-1 text-slate-500 text-xs hover:text-slate-300 transition-colors">
                          <span className="font-mono">{truncate(wallet.walletAddress)}</span>
                          <span>{copied ? '✓' : '⎘'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="text-white text-sm font-medium">{usdValue !== null ? `$${usdValue.toFixed(2)}` : '—'}</p>
                  </div>
                </div>
                <div className="px-3 pb-3 flex flex-col gap-1">
                  <a href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700/80 transition-colors">
                    <span className="text-white text-sm font-medium">Settings</span>
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  </a>
                  <button onClick={signOut} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                    <span className="text-red-400 text-sm font-medium">Sign out</span>
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-6 md:px-10 py-6 pb-4 flex-1 overflow-y-auto md:overflow-visible min-h-0">
          <div className="mb-4 text-left">
            <p className="text-slate-400 text-base mb-1">Your balance:</p>
            <p className="text-5xl md:text-6xl font-bold text-white">
              {usdValue === null ? <span className="animate-pulse text-slate-600">$···</span> : `$${usdValue.toFixed(2)}`}
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
                <span className="text-xs text-slate-500 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50">Stellar Testnet</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 px-4 pb-2 border-b border-slate-800 text-slate-500 text-xs font-medium">
                <span>Asset</span><span className="text-right">Balance</span>
                <span className="text-right hidden md:block">Portfolio %</span>
                <span className="text-right hidden md:block">Price</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 px-4 py-4 items-center hover:bg-slate-800/20 transition-colors rounded-xl">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
                    <img src={XLM_ICON} alt="XLM" className="w-full h-full object-cover"
                      onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar('XLM'); }} />
                  </div>
                  <div><p className="text-white text-sm font-medium">Stellar</p><p className="text-slate-500 text-xs">XLM</p></div>
                </div>
                <div className="text-right">
                  <p className="text-white text-sm font-medium">{xlmUsd !== null ? `$${xlmUsd.toFixed(2)}` : '—'}</p>
                  <p className="text-slate-500 text-xs">{xlmBalance !== null ? `${fmt(parseFloat(xlmBalance))} XLM` : <span className="animate-pulse">···</span>}</p>
                </div>
                <div className="text-right hidden md:block"><p className="text-white text-sm">{pct(xlmUsd) !== null ? `${pct(xlmUsd)!.toFixed(1)}%` : '—'}</p></div>
                <div className="text-right hidden md:block"><p className="text-white text-sm">{xlmPrice ? `$${xlmPrice.toFixed(4)}` : '—'}</p></div>
              </div>

              {tokenEntries.map(({ token, bal, price, usd }) => {
                if (bal === 0) return null;
                const tokenPct = pct(usd);
                return (
                  <div key={token.sacId} className="group grid grid-cols-2 md:grid-cols-4 px-4 py-4 items-center hover:bg-slate-800/20 transition-colors rounded-xl">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
                        <img
                          src={token.iconSrc}
                          alt={token.code}
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(token.code); }}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{token.name}</p>
                        <p className="text-slate-500 text-xs">{token.code}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      <div className="text-right">
                        <p className="text-white text-sm font-medium">{usd !== null ? `$${usd.toFixed(2)}` : '—'}</p>
                        <p className="text-slate-500 text-xs">{fmt(bal)} {token.code}</p>
                      </div>
                    </div>
                    <div className="text-right hidden md:block"><p className="text-white text-sm">{tokenPct !== null ? `${tokenPct.toFixed(1)}%` : '—'}</p></div>
                    <div className="text-right hidden md:block"><p className="text-white text-sm">{price !== null ? `$${price.toFixed(4)}` : '—'}</p></div>
                  </div>
                );
              })}
            </>
          )}

          {activeNav === 'activity' && (
            <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-white font-medium">Activity</h2>
                  <button
                    onClick={() => wallet && fetchHistory(wallet.walletAddress, 1)}
                    disabled={txLoading}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
                  >
                    Refresh
                  </button>
                </div>

                {txLoading && transactions === null && (
                  <div className="flex flex-col gap-1">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="flex items-center gap-4 px-2 py-3">
                        <Skeleton circle width={36} height={36} />
                        <div className="flex-1">
                          <Skeleton width="40%" height={13} className="mb-1.5" />
                          <Skeleton width="55%" height={11} />
                        </div>
                        <div className="text-right">
                          <Skeleton width={64} height={13} className="mb-1.5" />
                          <Skeleton width={40} height={11} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {!txLoading && transactions !== null && transactions.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 gap-3">
                    <p className="text-slate-500 text-sm">No transactions yet</p>
                    <p className="text-slate-600 text-xs text-center max-w-xs">Your transaction history will appear here after your first send or receive.</p>
                  </div>
                )}

                {transactions && transactions.map(tx => {
                  const isIncoming = tx.direction === 'incoming';
                  const isTransfer = tx.type === 'transfer';
                  const humanAmount = tx.amount && tx.assetCode
                    ? `${fmt(Number(BigInt(tx.amount)) / 1e7)} ${tx.assetCode}`
                    : null;
                  const counterparty = isIncoming ? tx.from : tx.to;
                  const label = isTransfer ? (isIncoming ? 'Received' : 'Sent') : (tx.functionName ?? 'Contract call');
                  const date = new Date(tx.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                  return (
                    <div key={tx.id} className="flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-slate-800/20 transition-colors">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isIncoming ? 'bg-green-500/10' : 'bg-slate-800'}`}>
                        {isTransfer ? (
                          <svg className={`w-4 h-4 ${isIncoming ? 'text-green-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            {isIncoming
                              ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                              : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
                          </svg>
                        ) : (
                          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
                          </svg>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{label}</p>
                        <p className="text-slate-500 text-xs truncate font-mono">
                          {counterparty ? truncate(counterparty) : tx.contractId ? truncate(tx.contractId) : '—'}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        {humanAmount && (
                          <p className={`text-sm font-medium ${isIncoming ? 'text-green-400' : 'text-white'}`}>
                            {isIncoming ? '+' : '-'}{humanAmount}
                          </p>
                        )}
                        <p className={`text-xs ${tx.status === 'failed' ? 'text-red-400' : tx.status !== 'confirmed' ? 'text-yellow-400' : 'text-slate-500'}`}>
                          {tx.status !== 'confirmed' ? tx.status : date}
                        </p>
                      </div>
                    </div>
                  );
                })}

                {txHasMore && (
                  <button
                    onClick={() => wallet && fetchHistory(wallet.walletAddress, txPage + 1)}
                    disabled={txLoading}
                    className="w-full mt-3 py-2.5 rounded-xl border border-slate-700 text-slate-400 text-sm hover:border-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {txLoading
                      ? <><svg className="animate-spin w-3.5 h-3.5" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/></svg>Loading…</>
                      : 'Load more'}
                  </button>
                )}
              </div>
            </SkeletonTheme>
          )}

          {activeNav === 'apps' && (
            connections.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <p className="text-slate-500 text-sm">No apps connected</p>
                <p className="text-slate-600 text-xs text-center max-w-xs">Connect Orbi to Stellar dApps and they'll appear here.</p>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700/50">
                {connections.map(c => (
                  <div key={c.origin} className="flex items-center justify-between p-4">
                    <div>
                      <p className="text-white text-sm font-medium">{c.appName || c.origin}</p>
                      <p className="text-slate-500 text-xs">{c.origin}</p>
                      <p className="text-slate-600 text-xs">Connected {new Date(c.connectedAt).toLocaleDateString()}</p>
                    </div>
                    <a href="/settings" className="text-blue-400 text-xs hover:underline">Manage →</a>
                  </div>
                ))}
              </div>
            )
          )}
        </div>

        {/* Mobile bottom nav - always in-flow at bottom of the flex column */}
        <div className="md:hidden shrink-0 border-t border-slate-800 bg-[#020817] px-4 py-3 flex justify-around">
          {[{ id: 'assets', label: 'Assets' }, { id: 'activity', label: 'Activity' }, { id: 'apps', label: 'Apps' }].map(({ id, label }) => (
            <button key={id} onClick={() => setActiveNav(id)} className={`text-xs font-medium px-4 py-1.5 rounded-lg transition-colors ${activeNav === id ? 'text-white bg-slate-800' : 'text-slate-500'}`}>{label}</button>
          ))}
        </div>
      </main>

      {/* ── Send/Receive slide panel ── */}
      {panelOpen && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setPanelOpen(false)} />
      )}

      <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-slate-900 border-l border-slate-700/50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>

        {/* ── Send form ── */}
        {panelStep === 'send-form' && (
          <>
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
              <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
                <button onClick={() => { setPanelTab('send'); setPanelStep('send-form'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'send' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Send</button>
                <button onClick={() => { setPanelTab('receive'); setPanelStep('receive'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'receive' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Receive</button>
              </div>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col p-5 gap-4 overflow-y-auto">
              {/* Amount */}
              <div className="flex items-center gap-3 py-4 border-b border-slate-800">
                <input
                  type="number"
                  value={sendAmount}
                  onChange={e => setSendAmount(e.target.value)}
                  placeholder="0"
                  className="flex-1 bg-transparent text-5xl font-bold text-white outline-none placeholder-slate-700 w-0"
                />
                <div className="flex items-center gap-2">
                  <span className="text-slate-400 text-2xl font-light">{selectedToken.code}</span>
                  <button onClick={setMax} className="text-xs text-slate-500 border border-slate-700 px-2.5 py-1 rounded-lg hover:border-slate-500 transition-colors">Max</button>
                </div>
              </div>
              {sendUsd !== null && (
                <p className="text-blue-400 text-sm">≈ ${sendUsd} USD</p>
              )}

              {/* Token selector */}
              <div className="relative">
                <button
                  onClick={() => setTokenSelectorOpen(o => !o)}
                  className="flex items-center justify-between w-full p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 hover:border-slate-500 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                      <img src={selectedToken.iconSrc} alt={selectedToken.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(selectedToken.code); }} />
                    </div>
                    <div className="text-left">
                      <p className="text-white text-sm font-medium">{selectedToken.name}</p>
                      <p className="text-slate-500 text-xs">{getSelectedBalance()} {selectedToken.code} available</p>
                    </div>
                  </div>
                  <svg className={`w-4 h-4 text-slate-500 transition-transform ${tokenSelectorOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                </button>

                {tokenSelectorOpen && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl z-10">
                    {getAvailableTokens().map(token => (
                      <button
                        key={token.sacId}
                        onClick={() => { setSelectedToken(token); setSendAmount(''); setTokenSelectorOpen(false); }}
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

              {/* Recipient */}
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50 border border-slate-700/50">
                <svg className="w-4 h-4 text-slate-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                <input
                  value={sendTo}
                  onChange={e => setSendTo(e.target.value)}
                  placeholder="To: G... or C..."
                  className="flex-1 bg-transparent text-white text-sm outline-none placeholder-slate-600 font-mono"
                />
              </div>

              {sendError && <p className="text-red-400 text-xs">{sendError}</p>}
            </div>

            <div className="p-5 border-t border-slate-800">
              <button
                onClick={handlePreview}
                disabled={!sendTo.trim() || !sendAmount}
                className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                Preview send <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </>
        )}

        {/* ── Send preview / confirm ── */}
        {panelStep === 'send-preview' && sendQuote && (
          <>
            <div className="flex items-center gap-3 p-5 border-b border-slate-800">
              <button onClick={() => setPanelStep('send-form')} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <h2 className="text-white font-semibold">Send</h2>
            </div>

            <div className="flex-1 p-5 flex flex-col gap-5">
              {/* From → To */}
              <div className="flex flex-col items-center gap-1 py-4">
                <div className="flex items-center gap-3 w-full justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                      <img src={selectedToken.iconSrc} alt={selectedToken.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(selectedToken.code); }} />
                    </div>
                    <div>
                      <p className="text-white font-medium">{selectedToken.name}</p>
                      <p className="text-slate-500 text-xs">{sendAmount} {selectedToken.code}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {sendUsd !== null && <p className="text-white font-medium">${sendUsd}</p>}
                  </div>
                </div>

                <svg className="w-5 h-5 text-slate-600 my-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>

                <div className="flex items-center gap-3 w-full">
                  <div className="w-10 h-10 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center">
                    <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                  </div>
                  <p className="text-white font-mono text-sm">{truncate(sendTo)}</p>
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-3 border-t border-slate-800 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Wallet used</span>
                  <span className="text-white font-mono">{truncate(wallet.walletAddress)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network fee</span>
                  <span className="text-white">{sendQuote.feeXlm} XLM</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network</span>
                  <span className="text-white">Stellar Testnet</span>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 flex gap-3">
              <button onClick={() => setPanelStep('send-form')} className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={handleConfirm} className="flex-1 py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-semibold transition-colors">
                Confirm
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
                <img src={dicebearUrl(wallet.walletAddress, 20)} alt="avatar" className="w-5 h-5 rounded-full" />
                <span className="text-white text-sm font-medium font-mono">{truncate(wallet.walletAddress)}</span>
              </div>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col items-center p-6 gap-5 overflow-y-auto">
              <div className="p-4 bg-white rounded-2xl">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(wallet.walletAddress)}&qzone=1&color=000000&bgcolor=ffffff`}
                  alt="QR code"
                  className="w-[220px] h-[220px]"
                />
              </div>

              <p className="text-white font-mono text-xs text-center break-all px-2 leading-relaxed">
                {wallet.walletAddress}
              </p>

              <button
                onClick={copyAddress}
                className="px-8 py-2.5 rounded-xl border border-slate-700 hover:border-slate-500 text-white text-sm font-medium transition-colors"
              >
                {copied ? '✓ Copied!' : 'Copy'}
              </button>

              <div className="w-full flex flex-col gap-3 border-t border-slate-800 pt-4 mt-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Balance</span>
                  <span className="text-white">{usdValue !== null ? `$${usdValue.toFixed(2)}` : '—'}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Provider</span>
                  <span className="text-white">Orbi Wallet</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network</span>
                  <span className="text-white">Stellar Testnet</span>
                </div>
              </div>

              <div className="w-full flex items-start gap-2 p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20 mt-1">
                <svg className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                <p className="text-yellow-400 text-xs">Only send XLM and Stellar tokens to this address.</p>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-3 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium transition-all
          ${toast.type === 'pending' ? 'bg-slate-800 border border-slate-700 text-slate-300' : ''}
          ${toast.type === 'success' ? 'bg-green-500/10 border border-green-500/30 text-green-400' : ''}
          ${toast.type === 'error' ? 'bg-red-500/10 border border-red-500/30 text-red-400' : ''}
        `}>
          {toast.type === 'pending' && (
            <svg className="animate-spin w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          )}
          {toast.type === 'success' && <span className="shrink-0">✓</span>}
          {toast.type === 'error' && <span className="shrink-0">✗</span>}
          <span>{toast.message}</span>
          {toast.type === 'success' && toast.txHash && (
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${toast.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-500 hover:underline text-xs"
            >
              View ↗
            </a>
          )}
          {toast.type !== 'pending' && (
            <button onClick={() => setToast(null)} className="ml-1 text-slate-500 hover:text-slate-300 shrink-0">✕</button>
          )}
        </div>
      )}

    </div>
  );
}

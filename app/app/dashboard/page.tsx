'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { getConnections, type StoredConnection, loadCachedBalances, saveCachedBalances } from '../../lib/storage';
import { fullWalletSignOut } from '../../lib/walletSignOut';
import { Networks, Asset, TransactionBuilder, Operation, Account, BASE_FEE } from '@stellar/stellar-sdk';
import { OrbiClient } from '@orbi-wallet/sdk';
import { STELLAR_TOKENS, tokenLetterAvatar, XLM_ICON, stellarExpertIcon, TOKEN_PRICE_IDS, TREASURY_ADDRESS } from '../../lib/tokens';
import Skeleton, { SkeletonTheme } from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

const dicebearUrl = (seed: string, size: number) =>
  `https://api.dicebear.com/9.x/rings/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
const orbi = new OrbiClient({ network: NETWORK });
const NETWORK_PASSPHRASE = NETWORK === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const HORIZON_URL = NETWORK === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org';
const STELLAR_EXPERT_NETWORK = NETWORK === 'mainnet' ? 'public' : 'testnet';
const NATIVE_SAC_ID = Asset.native().contractId(NETWORK_PASSPHRASE);
// A classic Stellar payment always costs exactly BASE_FEE (100 stroops) — no
// quote/estimation needed, unlike the relay-bundled fees of the old smart wallet.
const SEND_FEE_XLM = '0.00001';

function truncate(addr: string) { return `${addr.slice(0, 6)}...${addr.slice(-4)}`; }
function fmt(n: number): string { return parseFloat(n.toFixed(2)).toString(); }

type PanelStep = 'send-form' | 'send-preview' | 'receive' | 'swap-form' | 'swap-preview';

interface TxRecord {
  id: string;
  direction: 'outgoing' | 'incoming';
  assetCode?: string;
  amount?: string;
  to?: string;
  from?: string;
  createdAt: string;
  transactionHash: string;
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

interface SwapQuote {
  destAmount: string;
  path: Asset[];
}

// Tolerance applied to a quote's destination amount to compute `destMin` —
// protects the swap from failing if the price moves between quote and submission.
const SWAP_SLIPPAGE = 0.01;

// Stellar locks this much XLM as a reserve for every new trustline an account
// opens — it isn't spent or sent anywhere, just no longer freely spendable.
const TRUSTLINE_RESERVE_XLM = '0.5';

export default function DashboardPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [xlmBalance, setXlmBalance] = useState<string | null>(null);
  const [xlmPrice, setXlmPrice] = useState<number | null>(null);
  const [tokenPrices, setTokenPrices] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [activeNav, setActiveNav] = useState('assets');
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  // Send/Receive/Swap panel
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelStep, setPanelStep] = useState<PanelStep>('send-form');
  const [panelTab, setPanelTab] = useState<'send' | 'receive' | 'swap'>('send');
  const [sendTo, setSendTo] = useState('');
  const [sendAmount, setSendAmount] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [tokenBalances, setTokenBalances] = useState<Record<string, string>>({});
  // True while what's on screen is last-known cached data, not yet confirmed
  // by a live Horizon read — drives the "Syncing…" hint so a stale figure is
  // never presented as gospel (see refreshBalances).
  const [balancesStale, setBalancesStale] = useState(false);
  const [selectedToken, setSelectedToken] = useState<SendToken>(XLM_SEND_TOKEN);
  const [tokenSelectorOpen, setTokenSelectorOpen] = useState(false);
  // Prefetched account (sequence number), kicked off when entering the send
  // preview so Confirm can build the XDR and open the approval popup with no
  // visible delay — see handlePreview/handleConfirm.
  const sendAccountRef = useRef<Promise<Account> | null>(null);

  // Swap panel — quotes come live from Horizon's path-finding (no fixed pair
  // list, since which pairs actually have liquidity varies by network/time —
  // see fetchSwapQuote/handleSwapPreview).
  const [swapFromToken, setSwapFromToken] = useState<SendToken>(XLM_SEND_TOKEN);
  const [swapToToken, setSwapToToken] = useState<SendToken | null>(null);
  const [swapFromAmount, setSwapFromAmount] = useState('');
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [swapQuoteLoading, setSwapQuoteLoading] = useState(false);
  // Orbi's disclosed "Swap fee" — Horizon's live fee_stats.max_fee.mode, in XLM.
  // This is a network-wide stat (not specific to any one swap), so it's fetched
  // once on load rather than per-quote — see the mount effect below.
  const [swapFeeXLM, setSwapFeeXLM] = useState<string | null>(null);
  const [swapError, setSwapError] = useState('');
  const [swapping, setSwapping] = useState(false);
  const [swapTokenSelector, setSwapTokenSelector] = useState<'from' | 'to' | null>(null);
  // Guards against a stale, slower quote response clobbering a newer one.
  const swapQuoteSeq = useRef(0);
  const swapAccountRef = useRef<Promise<Account> | null>(null);

  // Toast notification for tx confirmation
  type Toast = { type: 'pending' | 'success' | 'error'; title: string; message: string; txHash?: string };
  const [toast, setToast] = useState<Toast | null>(null);
  const [transactions, setTransactions] = useState<TxRecord[] | null>(null);
  // Transaction details slide-over — opened from an Activity row. The fee isn't
  // in the payment-operation record, so it's fetched on demand from the tx itself.
  const [txDetail, setTxDetail] = useState<TxRecord | null>(null);
  const [txDetailFee, setTxDetailFee] = useState<string | null>(null);
  const [txLoading, setTxLoading] = useState(false);
  const [txNextUrl, setTxNextUrl] = useState<string | null>(null);
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

  // Horizon's account record carries the native balance plus every trustline
  // balance in one call — no separate per-token lookups needed for a G wallet.
  // Re-runnable on demand (not just on load) so a completed send/swap — which
  // can change balances and add new trustlines — reflects immediately rather
  // than waiting for the next full page load.
  function refreshBalances(addr: string) {
    fetch(`${HORIZON_URL}/accounts/${addr}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { balances?: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string; balance: string }> }) => {
        const balances = d.balances ?? [];
        const native = balances.find(b => b.asset_type === 'native');
        const xlm = native?.balance ?? '0.0000000';

        const map: Record<string, string> = {};
        for (const token of STELLAR_TOKENS) {
          const trustline = balances.find(b => b.asset_code === token.code && b.asset_issuer === token.issuer);
          if (trustline) map[token.sacId] = String(Math.round(parseFloat(trustline.balance) * 10 ** token.decimals));
        }

        // Live data always wins — it overwrites both on-screen state and the
        // cache, so a cached figure can never linger past its next refresh.
        setXlmBalance(xlm);
        setTokenBalances(map);
        setBalancesStale(false);
        saveCachedBalances(addr, xlm, map);
      })
      // A failed refresh shouldn't blank out a balance we already know (from
      // cache or an earlier load) — "stale" beats "wrong". Only fall back to
      // zero if we truly have nothing to show yet.
      .catch(() => setXlmBalance(prev => prev ?? '0.0000000'));
  }

  const TX_PAGE_SIZE = 10;

  // Pass `url` to fetch a specific page (e.g. Horizon's `_links.next.href`,
  // which already encodes the correct cursor); omit it to load the first page.
  async function fetchHistory(walletAddress: string, url?: string) {
    setTxLoading(true);
    try {
      const res = await fetch(
        url ?? `${HORIZON_URL}/accounts/${walletAddress}/payments?order=desc&limit=${TX_PAGE_SIZE}`,
      );
      if (!res.ok) { if (!url) { setTransactions([]); setTxHasMore(false); } return; }
      const data = await res.json() as {
        _embedded: { records: Array<{
          id: string; type: string; created_at: string; transaction_hash: string;
          from?: string; to?: string; amount?: string;
          asset_type?: string; asset_code?: string; asset_issuer?: string;
          // create_account shapes its fields differently — it's how every G
          // wallet's very first (funding) transaction appears in this feed.
          account?: string; funder?: string; starting_balance?: string;
        }> };
        _links: { next?: { href?: string } };
      };
      const records = data._embedded?.records ?? [];
      const txs: TxRecord[] = records.map(r => {
        const isCreateAccount = r.type === 'create_account';
        const to = isCreateAccount ? r.account : r.to;
        const from = isCreateAccount ? r.funder : r.from;
        const amount = isCreateAccount ? r.starting_balance : r.amount;
        return {
          id: r.id,
          direction: to === walletAddress ? 'incoming' : 'outgoing',
          assetCode: (isCreateAccount || r.asset_type === 'native') ? 'XLM' : r.asset_code,
          amount: amount ? String(Math.round(parseFloat(amount) * 1e7)) : undefined,
          to,
          from,
          createdAt: r.created_at,
          transactionHash: r.transaction_hash,
        };
      });
      setTransactions(prev => url ? [...(prev ?? []), ...txs] : txs);
      setTxNextUrl(data._links?.next?.href ?? null);
      // Horizon always returns a `next` link (more could arrive later), so the
      // real "more right now" signal is whether this page came back full.
      setTxHasMore(records.length === TX_PAGE_SIZE);
    } catch {
      if (!url) { setTransactions([]); setTxHasMore(false); }
    } finally {
      setTxLoading(false);
    }
  }

  useEffect(() => {
    const addr = orbi.getAddress();
    if (!addr) { router.replace('/'); return; }
    setWalletAddress(addr);
    setConnections(getConnections(addr));

    // Paint last-known balances immediately (stale-while-revalidate) — this is
    // what gives returning users the same "instantly there" feel XLM has,
    // instead of every non-zero token row blinking out until the live read
    // lands. The live fetch below reconciles (and overwrites) it right away.
    const cached = loadCachedBalances(addr);
    if (cached) {
      setXlmBalance(cached.xlm);
      setTokenBalances(cached.tokens);
      setBalancesStale(true);
    }

    refreshBalances(addr);

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

    // Orbi's "Swap fee" is disclosed honestly as fee_stats.max_fee.mode — the
    // same live, queryable number wallets like Freighter show as their fee
    // estimate, rather than a markup dressed up as a "network fee".
    fetch(`${HORIZON_URL}/fee_stats`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { max_fee?: { mode?: string } }) => {
        if (d.max_fee?.mode) setSwapFeeXLM((Number(d.max_fee.mode) / 1e7).toFixed(7));
      })
      .catch(() => {});
  }, [router]);

  // Auto-dismiss after ~5s — except 'pending', which reflects an ongoing
  // operation and should stay until that operation resolves into one of these.
  useEffect(() => {
    if (toast?.type === 'pending') return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (activeNav === 'activity' && walletAddress && transactions === null) {
      fetchHistory(walletAddress);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav, walletAddress]);

  // Payment-operation records don't carry the transaction's fee — fetch the
  // real fee_charged from the transaction itself once the user opens details.
  function openTxDetail(tx: TxRecord) {
    setTxDetail(tx);
    setTxDetailFee(null);
    fetch(`${HORIZON_URL}/transactions/${tx.transactionHash}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: { fee_charged?: string }) => {
        if (d.fee_charged) setTxDetailFee((parseInt(d.fee_charged, 10) / 1e7).toString());
      })
      .catch(() => {});
  }

  function copyAddress() {
    if (!walletAddress) return;
    navigator.clipboard.writeText(walletAddress);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  async function disconnect() {
    await fullWalletSignOut();
    orbi.disconnect();
    router.replace('/');
  }

  function openPanel(tab: 'send' | 'receive' | 'swap') {
    setPanelTab(tab);
    setPanelStep(tab === 'send' ? 'send-form' : tab === 'swap' ? 'swap-form' : 'receive');
    setSendTo(''); setSendAmount(''); setSendError('');
    setSelectedToken(XLM_SEND_TOKEN);
    setTokenSelectorOpen(false);
    setSwapFromToken(XLM_SEND_TOKEN); setSwapToToken(null);
    setSwapFromAmount(''); resetSwapQuote();
    setSwapTokenSelector(null);
    setPanelOpen(true);
  }

  // A token's available balance in human units
  function tokenBalance(token: SendToken): string {
    if (token.code === 'XLM') {
      return xlmBalance ? fmt(parseFloat(xlmBalance)) : '0';
    }
    const raw = tokenBalances[token.sacId] ?? '0';
    return fmt(Number(BigInt(raw)) / 10 ** token.decimals);
  }

  function getSelectedBalance(): string {
    return tokenBalance(selectedToken);
  }

  // Native XLM has no issuer; everything else is a classic credit asset.
  function toAsset(token: SendToken): Asset {
    return token.code === 'XLM' || !token.issuer ? Asset.native() : new Asset(token.code, token.issuer);
  }

  function assetCanonical(token: SendToken): string {
    return token.code === 'XLM' || !token.issuer ? 'native' : `${token.code}:${token.issuer}`;
  }

  // XLM never needs a trustline; for issued assets, tokenBalances only carries
  // an entry when the account already holds a trustline to that asset (see the
  // account-loading effect above) — its absence means one must be created.
  function needsTrustline(token: SendToken): boolean {
    return token.code !== 'XLM' && !!token.issuer && tokenBalances[token.sacId] === undefined;
  }

  // Trims an XLM amount to its meaningful digits — fees are too small for fmt()'s
  // 2-decimal rounding (which would just show "0.00").
  function fmtXLM(n: number): string {
    return n.toFixed(7).replace(/0+$/, '').replace(/\.$/, '');
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

  // Swap destination candidates: any curated token other than whichever is
  // selected as the source — the user doesn't need to already hold it.
  function getSwapToTokens(): SendToken[] {
    const all: SendToken[] = [XLM_SEND_TOKEN, ...getDisplayTokens()];
    return all.filter(t => t.sacId !== swapFromToken.sacId);
  }

  async function fetchSendAccount(addr: string): Promise<Account> {
    const accountRes = await fetch(`${HORIZON_URL}/accounts/${addr}`);
    if (!accountRes.ok) throw new Error('Account not found on Stellar — deposit 1 XLM first');
    const accountData = await accountRes.json() as { sequence: string };
    return new Account(addr, accountData.sequence);
  }

  // Asks Horizon's native-DEX path-finder for the best route between two
  // assets — covers both order-book and liquidity-pool liquidity in one call.
  // Returns null when no route exists (e.g. the pair has no shared liquidity).
  async function fetchPathQuote(from: SendToken, to: SendToken, amount: string): Promise<{ destAmount: string; path: Asset[] } | null> {
    const fromAsset = toAsset(from);
    const params = new URLSearchParams({
      source_amount: amount,
      destination_assets: assetCanonical(to),
    });
    if (fromAsset.isNative()) {
      params.set('source_asset_type', 'native');
    } else {
      params.set('source_asset_type', fromAsset.code.length > 4 ? 'credit_alphanum12' : 'credit_alphanum4');
      params.set('source_asset_code', fromAsset.code);
      params.set('source_asset_issuer', fromAsset.issuer!);
    }

    const res = await fetch(`${HORIZON_URL}/paths/strict-send?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch swap quote');
    const data = await res.json() as {
      _embedded: { records: Array<{
        destination_amount: string;
        path: Array<{ asset_type: string; asset_code?: string; asset_issuer?: string }>;
      }> };
    };

    const best = data._embedded.records[0];
    if (!best) return null;
    return {
      destAmount: best.destination_amount,
      path: best.path.map(p => p.asset_type === 'native' ? Asset.native() : new Asset(p.asset_code!, p.asset_issuer!)),
    };
  }

  function flipSwapTokens() {
    if (!swapToToken) return;
    setSwapFromToken(swapToToken);
    setSwapToToken(swapFromToken);
    setSwapFromAmount('');
    resetSwapQuote();
  }

  // Resets the live quote — called from the input handlers below whenever the
  // pair or amount changes, so stale numbers never linger on screen.
  function resetSwapQuote() {
    ++swapQuoteSeq.current; // invalidate any in-flight fetch
    setSwapQuote(null);
    setSwapQuoteLoading(false);
    setSwapError('');
  }

  // Live quote: re-fetched (debounced) whenever the pair or amount changes.
  // The seq ref discards a slow response that's been superseded by a newer one
  // (e.g. by resetSwapQuote, or by this same effect re-running before it resolves).
  useEffect(() => {
    if (!swapToToken || !swapFromAmount || parseFloat(swapFromAmount) <= 0) return;

    const seq = ++swapQuoteSeq.current;
    const t = setTimeout(() => {
      setSwapQuoteLoading(true);
      setSwapError('');
      fetchPathQuote(swapFromToken, swapToToken, swapFromAmount)
        .then(quote => {
          if (swapQuoteSeq.current !== seq) return;
          setSwapQuote(quote);
          if (!quote) setSwapError('No swap route available for this pair');
        })
        .catch(() => {
          if (swapQuoteSeq.current === seq) setSwapError('Failed to fetch quote');
        })
        .finally(() => {
          if (swapQuoteSeq.current === seq) setSwapQuoteLoading(false);
        });
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapFromToken, swapToToken, swapFromAmount]);

  function handlePreview() {
    if (!walletAddress || !sendTo.trim() || !sendAmount) return;
    setSendError('');
    setPanelStep('send-preview');
    // Kick off the sequence-number fetch now, while the user reviews the preview,
    // so Confirm can build the XDR and open the approval popup immediately —
    // no visible gap between the click and the "Approve Transaction" screen.
    sendAccountRef.current = fetchSendAccount(walletAddress);
  }

  // Builds the payment XDR, has the user approve it with their passkey via the
  // Orbi popup (OrbiClient.signTransaction), then submits the signed result to
  // Horizon directly — no relay, no full-page redirect round-trip.
  async function handleConfirm() {
    if (!walletAddress) return;

    setSending(true);
    try {
      const account = await (sendAccountRef.current ?? fetchSendAccount(walletAddress));
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

      const { signedXdr } = await orbi.signTransaction({ xdr: tx.toXDR(), walletAddress });

      // Passkey approved — return to the dashboard right away rather than
      // making the user wait through the Horizon submission round-trip with
      // the send sidebar still open.
      setPanelOpen(false);
      sendAccountRef.current = null;

      const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: signedXdr }),
      });
      const submitData = await submitRes.json() as { hash?: string; extras?: { result_codes?: unknown }; title?: string };
      if (!submitData.hash) {
        throw new Error(JSON.stringify(submitData.extras?.result_codes ?? submitData.title ?? 'Submit failed'));
      }

      setTransactions(null); // refetch activity next time it's viewed, so the new tx shows up
      if (walletAddress) refreshBalances(walletAddress); // reflect the new balance immediately, no manual refresh needed
      setToast({ type: 'success', title: 'Sent!', message: 'Your transaction was submitted to the network.', txHash: submitData.hash });
    } catch (e: unknown) {
      setToast({ type: 'error', title: 'Transaction failed', message: e instanceof Error ? e.message : 'Failed to send' });
    } finally {
      setSending(false);
    }
  }

  function handleSwapPreview() {
    if (!walletAddress || !swapToToken || !swapFromAmount || !swapQuote || !swapFeeXLM) return;
    setSwapError('');
    setPanelStep('swap-preview');
    swapAccountRef.current = fetchSendAccount(walletAddress);
  }

  // A swap on Stellar's native DEX is just a path payment to yourself: you
  // send `swapFromToken` and the DEX converts it along the quoted path,
  // crediting `swapToToken`. We bundle in two more operations when needed —
  // a trustline for a destination asset the wallet doesn't hold yet, and
  // Orbi's disclosed Swap fee to the treasury — all atomic in one signed
  // transaction (everything lands together, or nothing does). Same
  // build/sign/submit pipeline as a send.
  async function handleSwapConfirm() {
    if (!walletAddress || !swapToToken || !swapQuote || !swapFeeXLM) return;

    setSwapping(true);
    try {
      const account = await (swapAccountRef.current ?? fetchSendAccount(walletAddress));
      // destMin guards against the rate moving between quote and execution —
      // the swap simply fails rather than executing at a worse-than-expected price.
      const destMin = (parseFloat(swapQuote.destAmount) * (1 - SWAP_SLIPPAGE)).toFixed(7);
      const builder = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      });

      if (needsTrustline(swapToToken)) {
        builder.addOperation(Operation.changeTrust({ asset: toAsset(swapToToken) }));
      }

      builder.addOperation(Operation.pathPaymentStrictSend({
        sendAsset: toAsset(swapFromToken),
        sendAmount: swapFromAmount,
        destination: walletAddress,
        destAsset: toAsset(swapToToken),
        destMin,
        path: swapQuote.path,
      }));

      builder.addOperation(Operation.payment({
        destination: TREASURY_ADDRESS,
        asset: Asset.native(),
        amount: swapFeeXLM,
      }));

      const tx = builder.setTimeout(30).build();

      const { signedXdr } = await orbi.signTransaction({ xdr: tx.toXDR(), walletAddress });

      setPanelOpen(false);
      swapAccountRef.current = null;

      const submitRes = await fetch(`${HORIZON_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ tx: signedXdr }),
      });
      const submitData = await submitRes.json() as { hash?: string; extras?: { result_codes?: unknown }; title?: string };
      if (!submitData.hash) {
        throw new Error(JSON.stringify(submitData.extras?.result_codes ?? submitData.title ?? 'Submit failed'));
      }

      setTransactions(null);
      if (walletAddress) refreshBalances(walletAddress); // reflect the new balance/trustline immediately, no manual refresh needed
      setToast({ type: 'success', title: 'Swapped!', message: 'Your swap was submitted to the network.', txHash: submitData.hash });
    } catch (e: unknown) {
      setToast({ type: 'error', title: 'Swap failed', message: e instanceof Error ? e.message : 'Failed to swap' });
    } finally {
      setSwapping(false);
    }
  }

  const xlmFloat = xlmBalance ? parseFloat(xlmBalance) : 0;
  const xlmUsd = xlmPrice != null ? xlmFloat * xlmPrice : null;

  // Swap fee breakdown for the preview panel — the transaction always bundles
  // a path payment + Orbi's disclosed Swap-fee payment to the treasury (2 ops),
  // plus a changeTrust op (a 3rd) when the destination asset needs a new
  // trustline. Each cost gets its own honestly-labeled line: "Network fee" is
  // the real per-op network cost (never inflated with Orbi's cut), "Swap fee"
  // is Orbi's disclosed charge (live fee_stats.max_fee.mode), and the trustline
  // reserve is shown separately since it's locked, not spent.
  const swapNeedsTrustline = swapToToken ? needsTrustline(swapToToken) : false;
  const swapOpCount = 2 + (swapNeedsTrustline ? 1 : 0);
  const swapNetworkFeeXLM = swapQuote ? swapOpCount * (Number(BASE_FEE) / 1e7) : null;

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

  if (!walletAddress) return null;

  return (
    <div className="flex h-[100dvh] md:h-auto md:min-h-screen bg-[#020817] relative overflow-hidden md:overflow-visible font-display">

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
            <button onClick={() => openPanel('swap')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/></svg>Swap
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
              <img src={dicebearUrl(walletAddress, 24)} alt="avatar" className="w-6 h-6 rounded-full" />
              <span className="font-mono">{truncate(walletAddress)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                <div className="px-5 pt-5 pb-3">
                  <p className="text-white font-semibold text-base mb-4">Your Account</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={dicebearUrl(walletAddress, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
                      <div>
                        <button onClick={copyAddress} className="flex items-center gap-1.5 text-white text-sm font-medium hover:text-slate-300 transition-colors">
                          <span className="font-mono">{truncate(walletAddress)}</span>
                          <span className="text-slate-500">{copied ? '✓' : '⎘'}</span>
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
                  <button onClick={disconnect} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                    <span className="text-red-400 text-sm font-medium">Disconnect</span>
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
              <img src={dicebearUrl(walletAddress, 22)} alt="avatar" className="w-5 h-5 rounded-full" />
              <span className="font-mono">{truncate(walletAddress)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
                <div className="px-5 pt-5 pb-3">
                  <p className="text-white font-semibold text-base mb-4">Your Account</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <img src={dicebearUrl(walletAddress, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
                      <div>
                        <button onClick={copyAddress} className="flex items-center gap-1.5 text-white text-sm font-medium hover:text-slate-300 transition-colors">
                          <span className="font-mono">{truncate(walletAddress)}</span>
                          <span className="text-slate-500">{copied ? '✓' : '⎘'}</span>
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
                  <button onClick={disconnect} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
                    <span className="text-red-400 text-sm font-medium">Disconnect</span>
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
            <button onClick={() => openPanel('swap')} className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm">Swap</button>
            <button onClick={() => openPanel('receive')} className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm">Receive</button>
          </div>

          {activeNav === 'assets' && (
            <>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <h2 className="text-white font-medium">Tokens</h2>
                  {/* Cached balances paint instantly but aren't confirmed yet —
                      this hint is what makes that distinction honest (the fix
                      for stale-while-revalidate's "could be wrong" trade-off):
                      it disappears the moment the live read reconciles. */}
                  {balancesStale && (
                    <span className="text-xs text-amber-400/80 animate-pulse">Syncing…</span>
                  )}
                </div>
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

              {xlmBalance === null ? (
                // True cold start — neither cache nor a live read has landed
                // yet. Mirror XLM's always-present row for the curated tokens
                // too, so they paint a placeholder instead of popping in once
                // the fetch resolves (the original "not persistent" bug).
                <SkeletonTheme baseColor="#1e293b" highlightColor="#334155">
                  {getDisplayTokens().map(t => (
                    <div key={t.sacId} className="grid grid-cols-2 md:grid-cols-4 px-4 py-4 items-center">
                      <div className="flex items-center gap-3 min-w-0">
                        <Skeleton circle width={36} height={36} />
                        <div className="min-w-0 flex-1">
                          <Skeleton width="50%" height={13} className="mb-1.5" />
                          <Skeleton width="30%" height={11} />
                        </div>
                      </div>
                      <div className="flex flex-col items-end">
                        <Skeleton width={64} height={13} className="mb-1.5" />
                        <Skeleton width={80} height={11} />
                      </div>
                      <div className="hidden md:flex justify-end"><Skeleton width={40} height={13} /></div>
                      <div className="hidden md:flex justify-end"><Skeleton width={56} height={13} /></div>
                    </div>
                  ))}
                </SkeletonTheme>
              ) : tokenEntries.map(({ token, bal, price, usd }) => {
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
                    onClick={() => walletAddress && fetchHistory(walletAddress)}
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
                  const humanAmount = tx.amount && tx.assetCode
                    ? `${fmt(Number(BigInt(tx.amount)) / 1e7)} ${tx.assetCode}`
                    : null;
                  const counterparty = isIncoming ? tx.from : tx.to;
                  const label = isIncoming ? 'Received' : 'Sent';
                  const date = new Date(tx.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                  return (
                    <div key={tx.id} onClick={() => openTxDetail(tx)} className="flex items-center gap-4 px-2 py-3 rounded-xl hover:bg-slate-800/20 transition-colors cursor-pointer">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${isIncoming ? 'bg-green-500/10' : 'bg-slate-800'}`}>
                        <svg className={`w-4 h-4 ${isIncoming ? 'text-green-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          {isIncoming
                            ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
                        </svg>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium">{label}</p>
                        <p className="text-slate-500 text-xs truncate font-mono">
                          {counterparty ? truncate(counterparty) : '—'}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        {humanAmount && (
                          <p className={`text-sm font-medium ${isIncoming ? 'text-green-400' : 'text-white'}`}>
                            {isIncoming ? '+' : '-'}{humanAmount}
                          </p>
                        )}
                        <p className="text-xs text-slate-500">{date}</p>
                      </div>
                    </div>
                  );
                })}

                {txHasMore && (
                  <button
                    onClick={() => walletAddress && txNextUrl && fetchHistory(walletAddress, txNextUrl)}
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

        {/* Mobile bottom nav - always in-flow at bottom of the flex column.
            Stacked icon-over-label with a pill highlight on the active tab —
            the standard native iOS/Android tab-bar pattern — plus safe-area
            padding so it clears the home indicator on notched phones. */}
        <div className="md:hidden shrink-0 border-t border-slate-800 bg-[#020817] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex">
          {[
            { id: 'assets', label: 'Assets', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M12 6v6l4 2"/></svg> },
            { id: 'activity', label: 'Activity', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg> },
            { id: 'apps', label: 'Apps', icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg> },
          ].map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveNav(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-1 rounded-xl transition-colors ${activeNav === id ? 'text-white' : 'text-slate-500'}`}
            >
              <span className={`flex items-center justify-center w-10 h-8 rounded-full transition-colors ${activeNav === id ? 'bg-slate-800' : ''}`}>
                {icon}
              </span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
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
                <button onClick={() => { setPanelTab('swap'); setPanelStep('swap-form'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'swap' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Swap</button>
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
        {panelStep === 'send-preview' && (
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
                  <span className="text-white font-mono">{truncate(walletAddress)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network fee</span>
                  <span className="text-white">{SEND_FEE_XLM} XLM</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network</span>
                  <span className="text-white">Stellar Testnet</span>
                </div>
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 flex gap-3">
              <button onClick={() => setPanelStep('send-form')} disabled={sending} className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={handleConfirm} disabled={sending} className="flex-1 py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold transition-colors flex items-center justify-center gap-2">
                {sending ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Confirm in popup…
                  </>
                ) : 'Confirm'}
              </button>
            </div>
          </>
        )}

        {/* ── Swap form ── */}
        {panelStep === 'swap-form' && (
          <>
            <div className="flex items-center justify-between p-5 border-b border-slate-800">
              <button onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
              <div className="flex gap-1 bg-slate-800 rounded-xl p-1">
                <button onClick={() => { setPanelTab('send'); setPanelStep('send-form'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'send' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Send</button>
                <button onClick={() => { setPanelTab('swap'); setPanelStep('swap-form'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'swap' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Swap</button>
                <button onClick={() => { setPanelTab('receive'); setPanelStep('receive'); }} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${panelTab === 'receive' ? 'bg-white text-slate-900' : 'text-slate-400 hover:text-white'}`}>Receive</button>
              </div>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col p-5 gap-2 overflow-y-auto">
              {/* You pay */}
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 p-4 relative">
                <p className="text-slate-500 text-xs mb-2">You pay</p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    value={swapFromAmount}
                    onChange={e => { setSwapFromAmount(e.target.value); resetSwapQuote(); }}
                    placeholder="0"
                    className="flex-1 bg-transparent text-3xl font-bold text-white outline-none placeholder-slate-700 w-0"
                  />
                  <button
                    onClick={() => setSwapTokenSelector(o => o === 'from' ? null : 'from')}
                    className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl bg-slate-700/50 hover:bg-slate-700 transition-colors shrink-0"
                  >
                    <div className="w-6 h-6 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                      <img src={swapFromToken.iconSrc} alt={swapFromToken.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(swapFromToken.code); }} />
                    </div>
                    <span className="text-white text-sm font-medium">{swapFromToken.code}</span>
                    <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${swapTokenSelector === 'from' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                  </button>
                </div>
                <button onClick={() => { setSwapFromAmount(tokenBalance(swapFromToken)); resetSwapQuote(); }} className="text-slate-500 text-xs mt-2 hover:text-slate-300 transition-colors">
                  {tokenBalance(swapFromToken)} {swapFromToken.code} available
                </button>

                {swapTokenSelector === 'from' && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl z-20">
                    {getAvailableTokens().map(token => (
                      <button
                        key={token.sacId}
                        onClick={() => {
                          setSwapFromToken(token);
                          if (swapToToken?.sacId === token.sacId) setSwapToToken(null);
                          setSwapFromAmount(''); setSwapTokenSelector(null);
                          resetSwapQuote();
                        }}
                        className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-slate-800 transition-colors text-left ${swapFromToken.sacId === token.sacId ? 'bg-slate-800/60' : ''}`}
                      >
                        <div className="w-7 h-7 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                          <img src={token.iconSrc} alt={token.code} className="w-full h-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(token.code); }} />
                        </div>
                        <div className="flex-1">
                          <p className="text-white text-sm font-medium">{token.name}</p>
                          <p className="text-slate-500 text-xs">{token.code}</p>
                        </div>
                        {swapFromToken.sacId === token.sacId && (
                          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Flip */}
              <div className="flex justify-center -my-2 z-10">
                <button
                  onClick={flipSwapTokens}
                  disabled={!swapToToken}
                  className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-700 flex items-center justify-center text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/></svg>
                </button>
              </div>

              {/* You receive */}
              <div className="rounded-2xl bg-slate-800/50 border border-slate-700/50 p-4 relative">
                <p className="text-slate-500 text-xs mb-2">You receive (estimated)</p>
                <div className="flex items-center gap-3">
                  <div className="flex-1 text-3xl font-bold text-white truncate">
                    {swapQuoteLoading
                      ? <span className="animate-pulse text-slate-600">···</span>
                      : swapQuote ? fmt(parseFloat(swapQuote.destAmount)) : <span className="text-slate-700">0</span>}
                  </div>
                  <button
                    onClick={() => setSwapTokenSelector(o => o === 'to' ? null : 'to')}
                    className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-xl bg-slate-700/50 hover:bg-slate-700 transition-colors shrink-0"
                  >
                    {swapToToken ? (
                      <>
                        <div className="w-6 h-6 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                          <img src={swapToToken.iconSrc} alt={swapToToken.code} className="w-full h-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(swapToToken.code); }} />
                        </div>
                        <span className="text-white text-sm font-medium">{swapToToken.code}</span>
                      </>
                    ) : (
                      <span className="text-white text-sm font-medium">Select token</span>
                    )}
                    <svg className={`w-3.5 h-3.5 text-slate-500 transition-transform ${swapTokenSelector === 'to' ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                  </button>
                </div>

                {swapTokenSelector === 'to' && (
                  <div className="absolute top-full mt-1 left-0 right-0 bg-slate-900 border border-slate-700/50 rounded-xl overflow-hidden shadow-xl z-20">
                    {getSwapToTokens().map(token => (
                      <button
                        key={token.sacId}
                        onClick={() => { setSwapToToken(token); setSwapTokenSelector(null); resetSwapQuote(); }}
                        className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-slate-800 transition-colors text-left ${swapToToken?.sacId === token.sacId ? 'bg-slate-800/60' : ''}`}
                      >
                        <div className="w-7 h-7 rounded-full bg-slate-700 overflow-hidden flex-shrink-0">
                          <img src={token.iconSrc} alt={token.code} className="w-full h-full object-cover"
                            onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(token.code); }} />
                        </div>
                        <div className="flex-1">
                          <p className="text-white text-sm font-medium">{token.name}</p>
                          <p className="text-slate-500 text-xs">{token.code}</p>
                        </div>
                        {swapToToken?.sacId === token.sacId && (
                          <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7"/></svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Rate */}
              {swapQuote && swapToToken && !swapQuoteLoading && parseFloat(swapFromAmount) > 0 && (
                <p className="text-slate-500 text-xs px-1">
                  1 {swapFromToken.code} ≈ {fmt(parseFloat(swapQuote.destAmount) / parseFloat(swapFromAmount))} {swapToToken.code}
                </p>
              )}

              {swapError && <p className="text-red-400 text-xs px-1">{swapError}</p>}
            </div>

            <div className="p-5 border-t border-slate-800">
              <button
                onClick={handleSwapPreview}
                disabled={!swapToToken || !swapFromAmount || !swapQuote || swapQuoteLoading}
                className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-slate-900 font-semibold flex items-center justify-center gap-2 transition-colors"
              >
                Preview swap <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            </div>
          </>
        )}

        {/* ── Swap preview / confirm ── */}
        {panelStep === 'swap-preview' && swapToToken && swapQuote && (
          <>
            <div className="flex items-center gap-3 p-5 border-b border-slate-800">
              <button onClick={() => setPanelStep('swap-form')} className="text-slate-400 hover:text-white transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
              </button>
              <h2 className="text-white font-semibold">Swap</h2>
            </div>

            <div className="flex-1 p-5 flex flex-col gap-5">
              {/* From → To */}
              <div className="flex flex-col items-center gap-1 py-4">
                <div className="flex items-center gap-3 w-full justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                      <img src={swapFromToken.iconSrc} alt={swapFromToken.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(swapFromToken.code); }} />
                    </div>
                    <div>
                      <p className="text-white font-medium">{swapFromToken.name}</p>
                      <p className="text-slate-500 text-xs">{swapFromAmount} {swapFromToken.code}</p>
                    </div>
                  </div>
                </div>

                <svg className="w-5 h-5 text-slate-600 my-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>

                <div className="flex items-center gap-3 w-full justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden flex items-center justify-center">
                      <img src={swapToToken.iconSrc} alt={swapToToken.code} className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = tokenLetterAvatar(swapToToken.code); }} />
                    </div>
                    <div>
                      <p className="text-white font-medium">{swapToToken.name}</p>
                      <p className="text-slate-500 text-xs">≈ {fmt(parseFloat(swapQuote.destAmount))} {swapToToken.code}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Details */}
              <div className="flex flex-col gap-3 border-t border-slate-800 pt-4">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Rate</span>
                  <span className="text-white">1 {swapFromToken.code} ≈ {fmt(parseFloat(swapQuote.destAmount) / parseFloat(swapFromAmount))} {swapToToken.code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Minimum received</span>
                  <span className="text-white">{fmt(parseFloat(swapQuote.destAmount) * (1 - SWAP_SLIPPAGE))} {swapToToken.code}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Slippage tolerance</span>
                  <span className="text-white">{(SWAP_SLIPPAGE * 100).toFixed(0)}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Wallet used</span>
                  <span className="text-white font-mono">{truncate(walletAddress)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Network fee</span>
                  <span className="text-white">{swapNetworkFeeXLM != null ? fmtXLM(swapNetworkFeeXLM) : '—'} XLM</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-400">Swap fee</span>
                  <span className="text-white">{swapFeeXLM != null ? fmtXLM(parseFloat(swapFeeXLM)) : '—'} XLM</span>
                </div>
                {swapNeedsTrustline && (
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-400">Trustline fee</span>
                    <span className="text-white">{TRUSTLINE_RESERVE_XLM} XLM</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-5 border-t border-slate-800 flex gap-3">
              <button onClick={() => setPanelStep('swap-form')} disabled={swapping} className="flex-1 py-4 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white font-semibold transition-colors">
                Cancel
              </button>
              <button onClick={handleSwapConfirm} disabled={swapping} className="flex-1 py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold transition-colors flex items-center justify-center gap-2">
                {swapping ? (
                  <>
                    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    Confirm in popup…
                  </>
                ) : 'Confirm'}
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
                <img src={dicebearUrl(walletAddress, 20)} alt="avatar" className="w-5 h-5 rounded-full" />
                <span className="text-white text-sm font-medium font-mono">{truncate(walletAddress)}</span>
              </div>
              <div className="w-5" />
            </div>

            <div className="flex-1 flex flex-col items-center p-6 gap-5 overflow-y-auto">
              <div className="p-4 bg-white rounded-2xl">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(walletAddress)}&qzone=1&color=000000&bgcolor=ffffff`}
                  alt="QR code"
                  className="w-[220px] h-[220px]"
                />
              </div>

              <p className="text-white font-mono text-xs text-center break-all px-2 leading-relaxed">
                {walletAddress}
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

      {/* ── Transaction details slide panel ── */}
      {txDetail && (
        <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setTxDetail(null)} />
      )}

      <div className={`fixed top-0 right-0 h-full w-full md:w-96 bg-slate-900 border-l border-slate-700/50 z-50 flex flex-col shadow-2xl transition-transform duration-300 ease-out ${txDetail ? 'translate-x-0' : 'translate-x-full'}`}>
        {txDetail && (() => {
          const isIncoming = txDetail.direction === 'incoming';
          const counterparty = isIncoming ? txDetail.from : txDetail.to;
          const humanAmount = txDetail.amount && txDetail.assetCode
            ? `${fmt(Number(BigInt(txDetail.amount)) / 1e7)} ${txDetail.assetCode}`
            : null;
          const label = isIncoming ? 'Received' : 'Sent';
          const when = new Date(txDetail.createdAt).toLocaleString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
          });

          return (
            <>
              <div className="flex items-center gap-3 p-5 border-b border-slate-800">
                <button onClick={() => setTxDetail(null)} className="text-slate-400 hover:text-white transition-colors">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
                <h2 className="text-white font-semibold">Transaction details</h2>
              </div>

              <div className="flex-1 p-5 flex flex-col gap-5 overflow-y-auto">
                {/* Header */}
                <div className="flex flex-col items-center gap-2 py-2 text-center">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${isIncoming ? 'bg-green-500/10' : 'bg-slate-800'}`}>
                    <svg className={`w-5 h-5 ${isIncoming ? 'text-green-400' : 'text-slate-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      {isIncoming
                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />}
                    </svg>
                  </div>
                  <div>
                    <p className="text-white font-semibold">{label}{txDetail.assetCode ? ` ${txDetail.assetCode}` : ''}</p>
                    <p className="text-slate-500 text-xs mt-0.5">{when}</p>
                  </div>
                </div>

                {/* Amount + counterparty */}
                <div className="rounded-2xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700/50 text-sm">
                  <div className="flex items-center justify-between p-4">
                    <span className="text-slate-400">{label}</span>
                    <span className={`font-medium ${isIncoming ? 'text-green-400' : 'text-white'}`}>
                      {humanAmount ? `${isIncoming ? '+' : '-'}${humanAmount}` : '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <span className="text-slate-400">{isIncoming ? 'From' : 'To'}</span>
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
                        <svg className="w-3 h-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>
                      </div>
                      <span className="text-white font-mono text-xs">{counterparty ? truncate(counterparty) : '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Status + fee */}
                <div className="rounded-2xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700/50 text-sm">
                  <div className="flex items-center justify-between p-4">
                    <span className="text-slate-400">Status</span>
                    <span className="text-green-400 font-medium">Success</span>
                  </div>
                  <div className="flex items-center justify-between p-4">
                    <span className="text-slate-400">Fee</span>
                    <span className="text-white">{txDetailFee !== null ? `${txDetailFee} XLM` : '—'}</span>
                  </div>
                </div>
              </div>

              <div className="p-5 border-t border-slate-800">
                <a
                  href={`https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${txDetail.transactionHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white hover:bg-slate-100 text-slate-900 font-semibold transition-colors"
                >
                  View on stellar.expert
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg>
                </a>
              </div>
            </>
          );
        })()}
      </div>

      {/* ── Toast notification ── */}
      {toast && (
        <div className={`fixed top-6 left-1/2 -translate-x-1/2 z-[100] w-[calc(100vw-2rem)] max-w-sm flex items-start gap-3 px-4 py-3.5 rounded-2xl border shadow-xl transition-all
          ${toast.type === 'pending' ? 'bg-slate-800/95 border-slate-700' : ''}
          ${toast.type === 'success' ? 'bg-green-500/10 border-green-500/20' : ''}
          ${toast.type === 'error' ? 'bg-red-500/10 border-red-500/20' : ''}
        `}>
          <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center
            ${toast.type === 'pending' ? 'bg-slate-700 text-slate-300' : ''}
            ${toast.type === 'success' ? 'bg-green-500/15 text-green-400' : ''}
            ${toast.type === 'error' ? 'bg-red-500/15 text-red-400' : ''}
          `}>
            {toast.type === 'pending' && (
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
            {toast.type === 'success' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7"/></svg>
            )}
            {toast.type === 'error' && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/></svg>
            )}
          </div>

          <div className="flex-1 min-w-0 pt-0.5">
            <p className={`text-sm font-semibold
              ${toast.type === 'pending' ? 'text-slate-200' : ''}
              ${toast.type === 'success' ? 'text-green-400' : ''}
              ${toast.type === 'error' ? 'text-red-400' : ''}
            `}>{toast.title}</p>
            <p className="text-slate-400 text-xs mt-0.5 leading-relaxed">{toast.message}</p>
            {toast.type === 'success' && toast.txHash && (
              <a
                href={`https://stellar.expert/explorer/${STELLAR_EXPERT_NETWORK}/tx/${toast.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block mt-1.5 text-green-400 hover:underline text-xs font-medium"
              >
                View on stellar.expert ↗
              </a>
            )}
          </div>

          {toast.type !== 'pending' && (
            <button onClick={() => setToast(null)} className="shrink-0 text-slate-500 hover:text-slate-300 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          )}
        </div>
      )}

    </div>
  );
}

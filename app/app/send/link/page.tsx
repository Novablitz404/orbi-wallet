'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Copy,
  Check,
  Share2,
  MessageCircle,
  MessageSquare,
  ArrowLeft,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { OrbiClient } from '@orbi-wallet/sdk';
import { getNetworkPreference, loadWallet, getSdkSession } from '../../../lib/storage';
import { STELLAR_TOKENS, XLM_ICON } from '../../../lib/tokens';
import { createMagicLink } from '../../../lib/magic-link';

const NETWORK = getNetworkPreference();
const orbi = new OrbiClient({ network: NETWORK });

export default function SendMagicLinkPage() {
  const router = useRouter();

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<{ code: string; name: string; issuer?: string; icon: string }>({
    code: 'XLM',
    name: 'Stellar Lumens',
    icon: XLM_ICON,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [magicLink, setMagicLink] = useState<{ url: string; balanceId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const session = getSdkSession();
    if (session?.walletAddress) {
      setWalletAddress(session.walletAddress);
    } else {
      const w = loadWallet();
      if (w?.walletAddress) setWalletAddress(w.walletAddress);
    }
  }, []);

  const availableAssets = [
    { code: 'XLM', name: 'Stellar Lumens', icon: XLM_ICON },
    ...STELLAR_TOKENS.map((t) => ({
      code: t.code,
      name: t.name,
      issuer: t.issuer,
      icon: `https://stellar.expert/img/assets/${t.code}-${t.issuer}.png`,
    })),
  ];

  async function handleCreateLink(e: React.FormEvent) {
    e.preventDefault();
    if (!walletAddress) {
      setError('Please connect your wallet first.');
      return;
    }
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Please enter a valid amount.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      const result = await createMagicLink({
        senderAddress: walletAddress,
        amount,
        assetCode: selectedAsset.code,
        assetIssuer: selectedAsset.issuer,
        signTransactionFn: (params) => orbi.signTransaction(params),
      });

      setMagicLink({
        url: result.magicLinkUrl,
        balanceId: result.balanceId,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create Magic Link');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    if (!magicLink) return;
    navigator.clipboard.writeText(magicLink.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleNativeShare() {
    if (!magicLink) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Claim ${amount} ${selectedAsset.code} on Orbi Wallet`,
          text: `I sent you ${amount} ${selectedAsset.code}! Claim it instantly using this link:`,
          url: magicLink.url,
        });
      } catch {
        // Share dismissed
      }
    } else {
      handleCopy();
    }
  }

  const shareText = encodeURIComponent(
    `I sent you ${amount} ${selectedAsset.code}! Claim it instantly with Face ID using Orbi Wallet: ${magicLink?.url}`
  );

  return (
    <main className="min-h-screen bg-[#020817] text-white p-4 md:p-8 flex flex-col items-center justify-center font-display">
      <div className="w-full max-w-md">
        {/* Top Back Navigation */}
        <button
          onClick={() => router.push('/dashboard')}
          className="flex items-center gap-2 text-xs text-slate-400 hover:text-white transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>

        <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-6 md:p-8 shadow-xl">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl font-bold text-white">Send via Magic Link</h1>
            <p className="text-xs text-slate-400 mt-1">
              Send funds to anyone via WhatsApp, SMS, or direct link — no recipient address needed.
            </p>
          </div>

          {!magicLink ? (
            /* Form State */
            <form onSubmit={handleCreateLink} className="space-y-4">
              {/* Asset Selector */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-2">
                  Select Asset
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {availableAssets.map((asset) => (
                    <button
                      key={asset.code}
                      type="button"
                      onClick={() => setSelectedAsset(asset)}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-colors text-left ${
                        selectedAsset.code === asset.code
                          ? 'bg-slate-800 border-white text-white'
                          : 'bg-slate-900/50 border-slate-800 hover:bg-slate-800/50 text-slate-400'
                      }`}
                    >
                      <img
                        src={asset.icon}
                        alt={asset.code}
                        className="w-6 h-6 rounded-full object-cover shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = XLM_ICON;
                        }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{asset.code}</p>
                        <p className="text-[10px] text-slate-400 truncate">{asset.name}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount Input */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-2">
                  Amount
                </label>
                <div className="flex items-center p-3.5 rounded-xl bg-slate-900/60 border border-slate-700/50 focus-within:border-slate-500 transition-colors">
                  <input
                    type="number"
                    step="any"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent text-2xl font-bold font-mono text-white outline-none placeholder-slate-600"
                    required
                  />
                  <span className="text-xs font-bold text-slate-400 shrink-0 ml-2">{selectedAsset.code}</span>
                </div>
              </div>

              {/* Security Banner */}
              <div className="p-3 rounded-xl bg-slate-900/40 border border-slate-800 flex items-start gap-2.5">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-xs text-slate-400 leading-relaxed">
                  Funds are locked on Stellar into a Claimable Balance. The recipient claims them with 1-tap Face ID.
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={loading || !amount}
                className="w-full py-3.5 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 font-semibold text-slate-900 text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {loading ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-900/30 border-t-slate-900 rounded-full animate-spin" />
                    Approve with Face ID…
                  </>
                ) : (
                  `Generate Magic Link (${amount || '0'} ${selectedAsset.code})`
                )}
              </button>
            </form>
          ) : (
            /* Created Magic Link Success State */
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Magic Link Ready</p>
                <p className="text-2xl font-bold text-white font-mono mt-1">
                  {amount} {selectedAsset.code}
                </p>
              </div>

              {/* Copy URL Input Box */}
              <div>
                <label className="text-xs font-medium text-slate-400 uppercase tracking-wider block mb-2">
                  Claimable Link
                </label>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/80 border border-slate-700/50">
                  <input
                    type="text"
                    readOnly
                    value={magicLink.url}
                    className="flex-1 bg-transparent px-2 text-xs font-mono text-slate-300 outline-none truncate"
                  />
                  <button
                    onClick={handleCopy}
                    className="px-3 py-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs transition-colors flex items-center gap-1 shrink-0"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              {/* Action Buttons for Sharing */}
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`https://wa.me/?text=${shareText}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 font-medium text-xs flex items-center justify-center gap-2 transition-all"
                >
                  <MessageCircle className="w-4 h-4 text-emerald-400" /> WhatsApp
                </a>

                <a
                  href={`sms:?body=${shareText}`}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white border border-slate-700 font-medium text-xs flex items-center justify-center gap-2 transition-all"
                >
                  <MessageSquare className="w-4 h-4 text-blue-400" /> SMS / Message
                </a>
              </div>

              <button
                onClick={handleNativeShare}
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-medium text-xs border border-slate-700 flex items-center justify-center gap-2 transition-all"
              >
                <Share2 className="w-4 h-4" /> Share via App Menu
              </button>

              <button
                onClick={() => {
                  setMagicLink(null);
                  setAmount('');
                }}
                className="w-full text-center text-xs text-slate-500 hover:text-white transition-colors"
              >
                + Create another Magic Link
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

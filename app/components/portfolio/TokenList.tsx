'use client';

import { useState } from 'react';
import { Token } from './types';
import { MOCK_TOKENS } from './mockData';
import { TrendingUp, TrendingDown, ExternalLink, X, ArrowLeftRight, Copy, Check } from 'lucide-react';

interface TokenListProps {
  tokens?: Token[];
  currencySymbol?: string;
  onSwapToken?: (token: Token) => void;
}

export default function TokenList({
  tokens = MOCK_TOKENS,
  currencySymbol = '₱',
  onSwapToken,
}: TokenListProps) {
  const [activeTab, setActiveTab] = useState<'holdings' | 'watchlist'>('holdings');
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [copied, setCopied] = useState(false);

  const displayedTokens = activeTab === 'holdings'
    ? tokens.filter(t => t.holdingAmount > 0)
    : tokens;

  function copyIssuer(text: string) {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Mini SVG Sparkline renderer
  const renderSparkline = (data: number[], isPositive: boolean) => {
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const width = 80;
    const height = 28;

    const points = data.map((val, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((val - min) / range) * (height - 6) - 3;
      return `${x},${y}`;
    }).join(' ');

    return (
      <svg width={width} height={height} className="overflow-visible">
        <polyline
          fill="none"
          stroke={isPositive ? '#22C55E' : '#EF4444'}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={points}
        />
      </svg>
    );
  };

  return (
    <div className="rounded-3xl bg-slate-900/80 border border-slate-800 p-6 shadow-xl font-sans">
      {/* Header Tabs */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-4 mb-4">
        <div className="flex items-center gap-2 p-1 bg-slate-800/80 rounded-2xl border border-slate-700/50">
          <button
            onClick={() => setActiveTab('holdings')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
              activeTab === 'holdings'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            My Assets ({tokens.filter(t => t.holdingAmount > 0).length})
          </button>
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
              activeTab === 'watchlist'
                ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
            }`}
          >
            Watchlist ({tokens.length})
          </button>
        </div>

        <span className="text-xs text-slate-500 hidden sm:inline">Tap token for details</span>
      </div>

      {/* Token Rows */}
      <div className="flex flex-col gap-2">
        {displayedTokens.map((token) => {
          const isPositive = token.change24h >= 0;

          return (
            <div
              key={token.id}
              onClick={() => setSelectedToken(token)}
              className="group flex items-center justify-between p-4 rounded-2xl bg-slate-800/30 border border-slate-800/60 hover:bg-slate-800/80 hover:border-slate-700 transition-all cursor-pointer"
            >
              {/* Left Column: Icon + Name + Ticker */}
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-10 h-10 rounded-full overflow-hidden shrink-0 bg-slate-800 border border-slate-700 flex items-center justify-center p-0.5">
                  <img
                    src={token.icon}
                    alt={token.name}
                    className="w-full h-full object-cover rounded-full"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${token.symbol}&background=1e293b&color=fff`;
                    }}
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-white truncate">{token.name}</p>
                    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-bold font-mono text-slate-400 border border-slate-700">
                      {token.symbol}
                    </span>
                  </div>
                  <p className="text-xs font-mono text-slate-400 mt-0.5">
                    {currencySymbol}{token.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Center Column: Sparkline (hidden on small mobile) */}
              <div className="hidden md:flex items-center justify-center px-4 shrink-0">
                {renderSparkline(token.sparkline, isPositive)}
              </div>

              {/* Right Column: Price change + User holdings */}
              <div className="text-right shrink-0 ml-3">
                <div className="flex items-center justify-end gap-1.5 mb-1">
                  <span
                    className={`inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-xs font-semibold ${
                      isPositive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {isPositive ? '+' : ''}{token.change24h}%
                  </span>
                </div>
                {token.holdingAmount > 0 ? (
                  <p className="text-xs font-mono font-semibold text-white">
                    {currencySymbol}{token.holdingValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    <span className="text-slate-500 font-normal block text-[10px]">
                      {token.holdingAmount.toLocaleString()} {token.symbol}
                    </span>
                  </p>
                ) : (
                  <p className="text-[11px] text-slate-500">No balance</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Slide-over Token Detail Sheet / Drawer */}
      {selectedToken && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
          <div
            className="fixed inset-0"
            onClick={() => setSelectedToken(null)}
          />
          <div className="relative w-full max-w-md bg-slate-900 border-l border-slate-800 h-full overflow-y-auto p-6 shadow-2xl flex flex-col justify-between z-10">
            <div>
              {/* Sheet Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <img src={selectedToken.icon} alt="" className="w-10 h-10 rounded-full" />
                  <div>
                    <h3 className="text-lg font-bold text-white">{selectedToken.name}</h3>
                    <span className="text-xs font-mono text-slate-400">{selectedToken.symbol} • Stellar Asset</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedToken(null)}
                  className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Price & Change Banner */}
              <div className="my-6 p-4 rounded-2xl bg-slate-800/50 border border-slate-800">
                <p className="text-xs text-slate-400 uppercase font-semibold">Current Price</p>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-3xl font-black text-white font-mono">
                    {currencySymbol}{selectedToken.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      selectedToken.change24h >= 0
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}
                  >
                    {selectedToken.change24h >= 0 ? '+' : ''}{selectedToken.change24h}% (24h)
                  </span>
                </div>
              </div>

              {/* Token Analytics Grid */}
              <div className="space-y-4">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Token Metrics</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-2xl bg-slate-800/30 border border-slate-800">
                    <p className="text-[11px] text-slate-500 font-medium">Market Cap</p>
                    <p className="text-sm font-bold text-white font-mono mt-1">{selectedToken.marketCap}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-800/30 border border-slate-800">
                    <p className="text-[11px] text-slate-500 font-medium">24h Volume</p>
                    <p className="text-sm font-bold text-white font-mono mt-1">{selectedToken.volume24h}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-800/30 border border-slate-800">
                    <p className="text-[11px] text-slate-500 font-medium">All-Time High</p>
                    <p className="text-sm font-bold text-white font-mono mt-1">
                      {currencySymbol}{selectedToken.ath.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-800/30 border border-slate-800">
                    <p className="text-[11px] text-slate-500 font-medium">Asset Code</p>
                    <p className="text-sm font-bold text-blue-400 font-mono mt-1">{selectedToken.assetCode}</p>
                  </div>
                </div>

                {/* Issuer Info */}
                <div className="p-4 rounded-2xl bg-slate-800/30 border border-slate-800">
                  <p className="text-xs font-medium text-slate-400 mb-1">Stellar Issuer Address</p>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono text-slate-300 truncate max-w-[240px]">
                      {selectedToken.issuer}
                    </span>
                    <button
                      onClick={() => copyIssuer(selectedToken.issuer)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                      title="Copy issuer address"
                    >
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <a
                  href={`https://stellar.expert/explorer/public/asset/${selectedToken.assetCode}-${selectedToken.issuer}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-center gap-2 p-3 rounded-2xl bg-slate-800/50 hover:bg-slate-800 text-xs font-semibold text-blue-400 border border-slate-700/50 transition-colors"
                >
                  View on StellarExpert <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Bottom Actions */}
            <div className="pt-6 border-t border-slate-800">
              <button
                onClick={() => {
                  onSwapToken?.(selectedToken);
                  setSelectedToken(null);
                }}
                className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm shadow-xl shadow-blue-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                <ArrowLeftRight className="w-4 h-4" /> Swap {selectedToken.symbol}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

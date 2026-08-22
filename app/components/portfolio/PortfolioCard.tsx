'use client';

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface PortfolioCardProps {
  totalBalance?: number;
  change24hAmount?: number;
  change24hPercentage?: number;
  currencySymbol?: string;
}

export default function PortfolioCard({
  totalBalance = 24499.66,
  change24hAmount = 1249.66,
  change24hPercentage = 5.38,
  currencySymbol = '₱',
}: PortfolioCardProps) {
  const [showBalance, setShowBalance] = useState(true);

  const isPositive = change24hAmount >= 0;
  const formattedBalance = totalBalance.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedChange = `${isPositive ? '+' : ''}${currencySymbol}${Math.abs(change24hAmount).toLocaleString('en-US', { minimumFractionDigits: 2 })} (${isPositive ? '+' : ''}${change24hPercentage.toFixed(2)}%)`;

  return (
    <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-5 font-display">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Portfolio Value</span>
          <button
            onClick={() => setShowBalance(!showBalance)}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-300 transition-colors"
            title={showBalance ? 'Hide balance' : 'Show balance'}
          >
            {showBalance ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
          </button>
        </div>
        <span className="text-xs text-slate-500 font-mono">Live Sync</span>
      </div>

      {/* Main Balance Display */}
      <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold text-slate-400">{currencySymbol}</span>
          <span className="text-3xl md:text-4xl font-bold text-white font-mono">
            {showBalance ? formattedBalance : '••••••••'}
          </span>
        </div>

        {/* 24-Hour P&L Pill Badge */}
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium border ${
              isPositive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                : 'bg-red-500/10 text-red-400 border-red-500/20'
            }`}
          >
            {showBalance ? formattedChange : '••••••••'}
          </span>
          <span className="text-[11px] text-slate-500">24h</span>
        </div>
      </div>
    </div>
  );
}

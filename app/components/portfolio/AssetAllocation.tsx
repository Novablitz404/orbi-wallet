'use client';

import { Token } from './types';
import { MOCK_TOKENS } from './mockData';

interface AssetAllocationProps {
  tokens?: Token[];
  currencySymbol?: string;
}

export default function AssetAllocation({
  tokens = MOCK_TOKENS,
  currencySymbol = '₱',
}: AssetAllocationProps) {
  const heldTokens = tokens.filter(t => t.holdingValue > 0);
  const totalValue = heldTokens.reduce((sum, t) => sum + t.holdingValue, 0);

  const allocations = heldTokens.map(token => {
    const percentage = totalValue > 0 ? (token.holdingValue / totalValue) * 100 : 0;
    return {
      ...token,
      percentage: Number(percentage.toFixed(1)),
    };
  });

  return (
    <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-5 font-display">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Asset Breakdown</span>
        <span className="text-xs font-mono text-slate-400">
          {currencySymbol}{totalValue.toLocaleString('en-US', { minimumFractionDigits: 2 })}
        </span>
      </div>

      {/* Progress Bar */}
      <div className="h-2.5 w-full bg-slate-900/60 rounded-full overflow-hidden flex gap-0.5 mb-4">
        {allocations.map((asset) => (
          <div
            key={asset.id}
            style={{
              width: `${asset.percentage}%`,
              backgroundColor: asset.color,
            }}
            className="h-full transition-all duration-300"
            title={`${asset.symbol}: ${asset.percentage}%`}
          />
        ))}
      </div>

      {/* Legend Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {allocations.map((asset) => (
          <div key={asset.id} className="flex items-center gap-2 p-2 rounded-xl bg-slate-900/40 border border-slate-800">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: asset.color }} />
            <div className="min-w-0 flex-1 flex items-center justify-between text-xs">
              <span className="font-medium text-white truncate">{asset.symbol}</span>
              <span className="font-mono text-slate-400">{asset.percentage}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

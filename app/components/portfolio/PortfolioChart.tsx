'use client';

import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Timeframe, PortfolioPoint } from './types';
import { MOCK_HISTORY } from './mockData';

interface PortfolioChartProps {
  historyData?: Record<Timeframe, PortfolioPoint[]>;
  currencySymbol?: string;
}

const TIMEFRAMES: Timeframe[] = ['1D', '1W', '1M', '1Y', 'ALL'];

export default function PortfolioChart({
  historyData = MOCK_HISTORY,
  currencySymbol = '₱',
}: PortfolioChartProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');
  const data = historyData[timeframe];

  const startVal = data[0]?.value ?? 0;
  const currentVal = data[data.length - 1]?.value ?? 0;
  const diff = currentVal - startVal;
  const percentage = startVal > 0 ? (diff / startVal) * 100 : 0;
  const isPositive = diff >= 0;

  return (
    <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-5 font-display">
      {/* Header with Performance metrics and Timeframe Pills */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Performance</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-lg font-bold text-white font-mono">
              {currencySymbol}{currentVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
              }`}
            >
              {isPositive ? '+' : ''}{percentage.toFixed(2)}% ({timeframe})
            </span>
          </div>
        </div>

        {/* Timeframe Selector Pills */}
        <div className="flex items-center gap-1 bg-slate-900/60 rounded-xl p-1 border border-slate-700/40 self-start sm:self-auto">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                timeframe === tf
                  ? 'bg-white text-slate-900 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Area Chart Container */}
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorValSimple" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={isPositive ? '#22C55E' : '#EF4444'} stopOpacity={0.25} />
                <stop offset="95%" stopColor={isPositive ? '#22C55E' : '#EF4444'} stopOpacity={0.0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="time"
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              stroke="#64748B"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={val => `${currencySymbol}${(val / 1000).toFixed(0)}k`}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const point = payload[0].payload as PortfolioPoint;
                  return (
                    <div className="rounded-xl bg-slate-900 border border-slate-700 p-2.5 shadow-xl">
                      <p className="text-[10px] font-medium text-slate-400">{point.time}</p>
                      <p className="text-xs font-bold text-white font-mono mt-0.5">
                        {currencySymbol}{point.value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={isPositive ? '#22C55E' : '#EF4444'}
              strokeWidth={2}
              fillOpacity={1}
              fill="url(#colorValSimple)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

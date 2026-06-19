'use client';

import type { Chain } from '../lib/storage';

interface Props {
  value: Chain;
  onChange: (chain: Chain) => void;
  disabled?: boolean;
}

const CHAINS: { id: Chain; name: string; symbol: string }[] = [
  { id: 'stellar', name: 'Stellar', symbol: 'XLM' },
  { id: 'botchain', name: 'BOT Chain', symbol: 'BOT' },
];

export default function ChainSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="w-full">
      <p className="text-slate-400 text-xs mb-2">Network</p>
      <div className="grid grid-cols-2 gap-2">
        {CHAINS.map(({ id, name, symbol }) => {
          const active = value === id;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(id)}
              className={`rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-50 ${
                active
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-700 bg-slate-800/40 hover:border-slate-500'
              }`}
            >
              <div className={`text-sm font-semibold ${active ? 'text-white' : 'text-slate-300'}`}>{name}</div>
              <div className="text-xs text-slate-500">{symbol}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

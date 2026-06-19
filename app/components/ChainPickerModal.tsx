'use client';

import type { Chain } from '../lib/storage';

interface Props {
  open: boolean;
  onPick: (chain: Chain) => void;
  onClose: () => void;
}

const CHAINS: { id: Chain; name: string; symbol: string; blurb: string }[] = [
  { id: 'stellar', name: 'Stellar', symbol: 'XLM', blurb: 'Classic G-account · fast, low fees' },
  { id: 'botchain', name: 'BOT Chain', symbol: 'BOT', blurb: 'EVM · relay-free, you pay gas in BOT' },
];

export default function ChainPickerModal({ open, onPick, onClose }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-sm bg-[#0b1424] border border-slate-700 rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-white font-semibold">Choose a network</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-sm">Cancel</button>
        </div>

        {CHAINS.map(({ id, name, symbol, blurb }) => (
          <button
            key={id}
            onClick={() => onPick(id)}
            className="w-full text-left rounded-2xl border border-slate-700 bg-slate-800/40 hover:border-blue-500 hover:bg-blue-500/10 px-4 py-3 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-white font-semibold">{name}</span>
              <span className="text-xs text-slate-500">{symbol}</span>
            </div>
            <div className="text-xs text-slate-400 mt-0.5">{blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

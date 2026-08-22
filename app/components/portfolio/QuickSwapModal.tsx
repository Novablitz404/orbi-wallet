'use client';

import { useState } from 'react';
import { Token } from './types';
import { MOCK_TOKENS } from './mockData';
import { X, ArrowDown, RefreshCw, CheckCircle2 } from 'lucide-react';

interface QuickSwapModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialFromToken?: Token;
}

export default function QuickSwapModal({
  isOpen,
  onClose,
  initialFromToken,
}: QuickSwapModalProps) {
  const [fromToken, setFromToken] = useState<Token>(initialFromToken || MOCK_TOKENS[1]); // Default XLM
  const [toToken, setToToken] = useState<Token>(MOCK_TOKENS[0]); // Default USDC
  const [payAmount, setPayAmount] = useState<string>('');
  const [swapping, setSwapping] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  // Estimate output rate
  const rate = fromToken.price > 0 && toToken.price > 0 ? fromToken.price / toToken.price : 0;
  const numPay = parseFloat(payAmount) || 0;
  const receiveAmount = numPay > 0 ? (numPay * rate).toFixed(4) : '0.00';

  function handleMaxClick() {
    setPayAmount(fromToken.holdingAmount.toString());
  }

  function handleSwitchTokens() {
    const temp = fromToken;
    setFromToken(toToken);
    setToToken(temp);
    setPayAmount('');
  }

  async function handleExecuteSwap() {
    if (!numPay || numPay <= 0) return;
    setSwapping(true);
    // Simulate Stellar DEX Path Payment execution
    await new Promise(r => setTimeout(r, 1500));
    setSwapping(false);
    setSuccess(true);
    setTimeout(() => {
      setSuccess(false);
      onClose();
    }, 1800);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-bold text-white">Instant Swap</h3>
            <span className="px-2 py-0.5 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 text-[11px] font-semibold">
              Stellar DEX Path
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {success ? (
          <div className="py-12 flex flex-col items-center justify-center text-center animate-in zoom-in-95 duration-200">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mb-4 animate-bounce" />
            <h4 className="text-xl font-bold text-white mb-1">Swap Completed!</h4>
            <p className="text-xs text-slate-400 max-w-xs">
              Swapped {payAmount} {fromToken.symbol} for ~{receiveAmount} {toToken.symbol} on Stellar network.
            </p>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            {/* YOU PAY Box */}
            <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800 hover:border-slate-700 transition-colors">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
                <span>You Pay</span>
                <span className="font-mono">
                  Available: {fromToken.holdingAmount} {fromToken.symbol}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  placeholder="0.00"
                  className="flex-1 bg-transparent text-2xl md:text-3xl font-black text-white outline-none font-mono placeholder-slate-600"
                />
                <button
                  onClick={handleMaxClick}
                  className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 text-xs font-bold transition-colors"
                >
                  MAX
                </button>
                <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-800 border border-slate-700 shrink-0">
                  <img src={fromToken.icon} alt="" className="w-6 h-6 rounded-full" />
                  <span className="text-sm font-bold text-white">{fromToken.symbol}</span>
                </div>
              </div>
            </div>

            {/* Switch Direction Button */}
            <div className="flex justify-center -my-2 z-10">
              <button
                onClick={handleSwitchTokens}
                className="p-2.5 rounded-2xl bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:bg-slate-700 shadow-xl transition-all active:scale-90"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            </div>

            {/* YOU RECEIVE Box */}
            <div className="p-4 rounded-2xl bg-slate-800/40 border border-slate-800">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-400 mb-2">
                <span>You Receive (Estimated)</span>
                <span className="text-[11px] text-emerald-400 font-mono">Best Rate</span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  readOnly
                  value={receiveAmount}
                  className="flex-1 bg-transparent text-2xl md:text-3xl font-black text-white outline-none font-mono"
                />
                <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-800 border border-slate-700 shrink-0">
                  <img src={toToken.icon} alt="" className="w-6 h-6 rounded-full" />
                  <span className="text-sm font-bold text-white">{toToken.symbol}</span>
                </div>
              </div>
            </div>

            {/* Exchange Rate Route Indicator */}
            <div className="p-3 rounded-xl bg-slate-800/20 border border-slate-800/60 flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                Rate
              </span>
              <span>1 {fromToken.symbol} ≈ {rate.toFixed(4)} {toToken.symbol}</span>
            </div>

            {/* Primary Action Button */}
            <button
              onClick={handleExecuteSwap}
              disabled={swapping || !numPay || numPay <= 0}
              className="w-full mt-2 py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-base shadow-xl shadow-indigo-600/20 flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
            >
              {swapping ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" /> Swapping on Stellar...
                </>
              ) : (
                `Tap to Swap ${fromToken.symbol} → ${toToken.symbol}`
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

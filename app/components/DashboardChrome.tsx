'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import RecoveryNudge from './RecoveryNudge';

// Shared dashboard frame (sidebar, top bar, mobile header, account dropdown)
// used by both the Stellar and EVM dashboards. Only the content differs per
// chain — this keeps the frame in one place so it can't drift.

const dicebearUrl = (seed: string, size: number) =>
  `https://api.dicebear.com/9.x/rings/svg?seed=${encodeURIComponent(seed)}&size=${size}`;

function truncate(addr: string) { return `${addr.slice(0, 6)}...${addr.slice(-4)}`; }

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'assets', label: 'Assets', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="9" strokeWidth={2}/><path strokeLinecap="round" strokeWidth={2} d="M12 6v6l4 2"/></svg> },
  { id: 'activity', label: 'Activity', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg> },
  { id: 'apps', label: 'Apps', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg> },
];

export interface DashboardChromeProps {
  walletAddress: string;
  /** Value shown on the right of the account dropdown (e.g. "$12.34" or "5 BOT"). */
  accountValue: string;
  /** Label for the chain-switch item (e.g. "Switch to BOT Chain"). */
  switchChainLabel: string;
  copied: boolean;
  showSwap?: boolean;
  activeNav: string;
  onNav: (id: string) => void;
  onAction: (action: 'send' | 'receive' | 'swap') => void;
  onSwitchChain: () => void;
  onDisconnect: () => void;
  onCopy: () => void;
  /** Balance headline, rendered at the top of the scrollable area. */
  headline: ReactNode;
  /** Tab content. */
  children: ReactNode;
  /** Fixed-position overlays (slide panels, toasts). */
  overlays?: ReactNode;
}

export default function DashboardChrome({
  walletAddress, accountValue, switchChainLabel, copied, showSwap,
  activeNav, onNav, onAction, onSwitchChain, onDisconnect, onCopy,
  headline, children, overlays,
}: DashboardChromeProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        dropdownRef.current && !dropdownRef.current.contains(t) &&
        mobileDropdownRef.current && !mobileDropdownRef.current.contains(t)
      ) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const accountMenu = (
    <div className="absolute right-0 top-full mt-2 w-72 bg-slate-900 border border-slate-700/50 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50">
      <div className="px-5 pt-5 pb-3">
        <p className="text-white font-semibold text-base mb-4">Your Account</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={dicebearUrl(walletAddress, 36)} alt="avatar" className="w-9 h-9 rounded-full shrink-0" />
            <button onClick={onCopy} className="flex items-center gap-1.5 text-white text-sm font-medium hover:text-slate-300 transition-colors">
              <span className="font-mono">{truncate(walletAddress)}</span>
              <span className="text-slate-500">{copied ? '✓' : '⎘'}</span>
            </button>
          </div>
          <p className="text-white text-sm font-medium">{accountValue}</p>
        </div>
      </div>
      <div className="px-3 pb-3 flex flex-col gap-1">
        <button onClick={() => { setDropdownOpen(false); onSwitchChain(); }} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
          <span className="text-white text-sm font-medium">{switchChainLabel}</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" /></svg>
        </button>
        <a href="/settings" onClick={() => setDropdownOpen(false)} className="flex items-center justify-between px-3 py-3 rounded-xl bg-slate-800 hover:bg-slate-700/80 transition-colors">
          <span className="text-white text-sm font-medium">Settings</span>
          <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </a>
        <button onClick={onDisconnect} className="flex items-center justify-between px-3 py-3 rounded-xl hover:bg-slate-800/50 transition-colors">
          <span className="text-red-400 text-sm font-medium">Disconnect</span>
          <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] md:h-auto md:min-h-screen bg-[#020817] relative overflow-hidden md:overflow-visible font-display">

      {/* ── Sidebar ── */}
      <aside className="hidden md:flex flex-col w-56 border-r border-slate-800 px-4 py-6 shrink-0">
        <Image src="/Orbi logo - Landscape white.png" alt="Orbi" width={1862} height={647} className="h-9 w-auto max-w-[140px] mb-8" priority />
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => onNav(id)} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeNav === id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'}`}>
              {icon}{label}
            </button>
          ))}
        </nav>
        <div className="mt-8">
          <p className="text-slate-600 text-xs font-medium uppercase tracking-wider px-3 mb-2">Actions</p>
          <div className="flex flex-col gap-1">
            <button onClick={() => onAction('send')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>Send
            </button>
            <button onClick={() => onAction('receive')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>Receive
            </button>
            {showSwap && (
              <button onClick={() => onAction('swap')} className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800/50 text-sm transition-colors text-left">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4"/></svg>Swap
              </button>
            )}
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
            {dropdownOpen && accountMenu}
          </div>
        </div>

        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between px-4 pt-6 pb-4 border-b border-slate-800">
          <Image src="/Orbi logo - Landscape white.png" alt="Orbi" width={1862} height={647} className="h-6 w-auto" priority />
          <div className="relative" ref={mobileDropdownRef}>
            <button onClick={() => setDropdownOpen(o => !o)} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-800/60 border border-slate-700/50 text-slate-300 text-sm hover:bg-slate-700/50 transition-colors">
              <img src={dicebearUrl(walletAddress, 22)} alt="avatar" className="w-5 h-5 rounded-full" />
              <span className="font-mono">{truncate(walletAddress)}</span>
              <svg className={`w-4 h-4 text-slate-500 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
            </button>
            {dropdownOpen && accountMenu}
          </div>
        </div>

        <div className="px-6 md:px-10 py-6 pb-4 flex-1 overflow-y-auto md:overflow-visible min-h-0">
          <RecoveryNudge />

          {headline}

          <div className="md:hidden flex gap-3 mb-6">
            <button onClick={() => onAction('send')} className="flex-1 py-3 rounded-2xl bg-white text-slate-900 font-semibold text-sm">Send</button>
            <button onClick={() => onAction('receive')} className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm">Receive</button>
            {showSwap && (
              <button onClick={() => onAction('swap')} className="flex-1 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-white font-semibold text-sm">Swap</button>
            )}
          </div>

          {children}
        </div>

        {/* Mobile bottom nav — native iOS/Android tab-bar pattern, with
            safe-area padding so it clears the home indicator. */}
        <div className="md:hidden shrink-0 border-t border-slate-800 bg-[#020817] px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex">
          {NAV_ITEMS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => onNav(id)}
              className={`flex-1 flex flex-col items-center gap-1 py-1 rounded-xl transition-colors ${activeNav === id ? 'text-white' : 'text-slate-500'}`}>
              <span className={`flex items-center justify-center w-10 h-8 rounded-full transition-colors ${activeNav === id ? 'bg-slate-800' : ''}`}>
                {icon}
              </span>
              <span className="text-[11px] font-medium">{label}</span>
            </button>
          ))}
        </div>
      </main>

      {overlays}
    </div>
  );
}

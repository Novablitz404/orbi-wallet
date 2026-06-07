'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadWallet, clearWallet, getConnections, removeConnection, type StoredConnection } from '../../lib/storage';
import BackButton from '../../components/BackButton';

export default function SettingsPage() {
  const router = useRouter();
  const [wallet, setWallet] = useState<ReturnType<typeof loadWallet>>(null);
  const [connections, setConnections] = useState<StoredConnection[]>([]);

  useEffect(() => {
    const w = loadWallet();
    if (!w) { router.replace('/'); return; }
    setWallet(w);
    setConnections(getConnections(w.walletAddress));
  }, [router]);

  function revoke(origin: string) {
    if (!wallet) return;
    removeConnection(wallet.walletAddress, origin);
    setConnections(prev => prev.filter(c => c.origin !== origin));
  }

  function signOut() {
    clearWallet();
    window.location.href = 'https://keys.orbiwallet.xyz/signout?redirect=https://account.orbiwallet.xyz';
  }

  if (!wallet) return null;

  return (
    <main className="flex flex-col min-h-screen bg-[#020817] px-4">
      <div className="flex items-center gap-3 pt-6 pb-6">
        <BackButton onClick={() => router.back()} />
        <h1 className="text-white font-semibold">Settings</h1>
      </div>

      {/* Wallet info */}
      <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4 mb-4">
        <p className="text-slate-400 text-xs mb-1">Your wallet</p>
        <p className="text-white font-mono text-xs break-all">{wallet.walletAddress}</p>
        <p className="text-slate-500 text-xs mt-1">{wallet.email}</p>
      </div>

      {/* Actions */}
      <div className="rounded-2xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700/50 mb-4">
        <a
          href="https://account.orbiwallet.xyz"
          className="flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors"
        >
          <div>
            <p className="text-white text-sm font-medium">View wallet</p>
            <p className="text-slate-500 text-xs">See your assets on account.orbiwallet.xyz</p>
          </div>
          <span className="text-slate-500 text-xs">↗</span>
        </a>
        <button
          onClick={signOut}
          className="w-full flex items-center justify-between p-4 hover:bg-slate-700/30 transition-colors text-left"
        >
          <p className="text-red-400 text-sm font-medium">Sign out</p>
          <span className="text-slate-500">›</span>
        </button>
      </div>

      {/* Connected dApps */}
      <div className="mb-4">
        <h2 className="text-slate-400 text-sm font-medium mb-2 px-1">Connected apps</h2>
        {connections.length === 0 ? (
          <div className="rounded-2xl bg-slate-800/30 border border-slate-700/50 p-6 text-center">
            <p className="text-slate-500 text-sm">No apps connected yet</p>
            <p className="text-slate-600 text-xs mt-1">Apps you connect via Orbi will appear here</p>
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-800/50 border border-slate-700 divide-y divide-slate-700/50">
            {connections.map(c => (
              <div key={c.origin} className="flex items-center justify-between p-4">
                <div>
                  <p className="text-white text-sm font-medium">{c.appName || c.origin}</p>
                  <p className="text-slate-500 text-xs">{c.origin}</p>
                  <p className="text-slate-600 text-xs">
                    Connected {new Date(c.connectedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => revoke(c.origin)}
                  className="text-red-400 text-xs hover:text-red-300 transition-colors px-2 py-1"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
        <p className="text-slate-600 text-xs mt-2 px-1">Connections are stored on this device only.</p>
      </div>

      {/* Network */}
      <div className="flex justify-center pt-2">
        <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-slate-500 text-xs">
          Stellar Testnet
        </span>
      </div>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getConnections, removeConnection, getNetworkPreference, loadWallet, setWalletRecovery, type StoredConnection, type StoredWallet } from '../../lib/storage';
import { setupRecoveryWithGoogle } from '../../lib/recovery';
import { prewarmGoogleAuth } from '../../lib/google-oauth';
import { OrbiClient } from '@orbi-wallet/sdk';
import BackButton from '../../components/BackButton';

const NETWORK = getNetworkPreference();
const NETWORK_LABEL = NETWORK === 'mainnet' ? 'Stellar Mainnet' : 'Stellar Testnet';
const orbi = new OrbiClient({ network: NETWORK });

export default function SettingsPage() {
  const router = useRouter();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [wallet, setWallet] = useState<StoredWallet | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  useEffect(() => {
    const addr = orbi.getAddress();
    if (!addr) { router.replace('/'); return; }
    setWalletAddress(addr);
    setConnections(getConnections(addr));
    setWallet(loadWallet());
    prewarmGoogleAuth();
  }, [router]);

  function revoke(origin: string) {
    if (!walletAddress) return;
    removeConnection(walletAddress, origin);
    setConnections(prev => prev.filter(c => c.origin !== origin));
  }

  async function setupRecovery() {
    if (!wallet?.publicKey || !wallet.walletAddress) return;
    setRecoveryError('');
    setRecoveryBusy(true);
    try {
      const { userId } = await setupRecoveryWithGoogle({
        credentialId: wallet.credentialId,
        publicKey: wallet.publicKey,
        stellarAddress: wallet.walletAddress,
        userId: wallet.recovery?.userId,
      });
      setWalletRecovery({ userId, googleLinked: true });
      setWallet(loadWallet());
    } catch (err: unknown) {
      setRecoveryError(err instanceof Error ? err.message : 'Could not set up recovery');
    } finally {
      setRecoveryBusy(false);
    }
  }

  if (!walletAddress) return null;

  return (
    <main className="flex flex-col min-h-screen bg-[#020817] px-4">
      <div className="flex items-center gap-3 pt-6 pb-6">
        <BackButton onClick={() => router.back()} />
        <h1 className="text-white font-semibold">Settings</h1>
      </div>

      {/* Wallet info */}
      <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4 mb-4">
        <p className="text-slate-400 text-xs mb-1">Your wallet</p>
        <p className="text-white font-mono text-xs break-all">{walletAddress}</p>
      </div>

      {/* Recovery */}
      <div className="mb-4">
        <h2 className="text-slate-400 text-sm font-medium mb-2 px-1">Recovery</h2>
        <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-4">
          {wallet?.recovery?.googleLinked ? (
            <div className="flex items-start gap-3">
              <span className="text-green-400 text-lg leading-none mt-0.5">✓</span>
              <div>
                <p className="text-white text-sm font-medium">Protected with Google</p>
                <p className="text-slate-500 text-xs mt-0.5">
                  An encrypted backup is stored in your Google Drive. You can recover this wallet on a
                  new device with Google sign-in.
                </p>
              </div>
            </div>
          ) : wallet?.publicKey ? (
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-white text-sm font-medium">Set up wallet recovery</p>
                <p className="text-slate-500 text-xs mt-0.5">
                  Link Google and store an encrypted backup in your own Drive, so you can get back in
                  if you lose this device. Non-custodial — your passkey stays your everyday sign-in.
                </p>
              </div>
              {recoveryError && <p className="text-red-400 text-xs">{recoveryError}</p>}
              <button
                onClick={setupRecovery}
                disabled={recoveryBusy}
                className="self-start px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold transition-colors disabled:opacity-50"
              >
                {recoveryBusy ? 'Setting up… check the prompts' : 'Set up recovery with Google'}
              </button>
            </div>
          ) : (
            <p className="text-slate-500 text-sm">
              Recovery isn&apos;t available for this wallet. Re-create your wallet to enable it.
            </p>
          )}
        </div>
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
          {NETWORK_LABEL}
        </span>
      </div>
    </main>
  );
}

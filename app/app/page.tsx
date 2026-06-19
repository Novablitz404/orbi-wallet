'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { OrbiClient } from '@orbi-wallet/sdk';
import ChainPickerModal from '../components/ChainPickerModal';
import { getNetworkPreference, type Chain } from '../lib/storage';

const NETWORK = getNetworkPreference();
const orbi = new OrbiClient({ network: NETWORK });

export default function Home() {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  // Returning visitor — skip the picker and go to the dashboard for whichever
  // chain the cached SDK session is on.
  useEffect(() => {
    if (orbi.getAddress()) router.replace(orbi.getChain() === 'botchain' ? '/evm' : '/dashboard');
  }, [router]);

  async function handlePick(chain: Chain) {
    setPickerOpen(false);
    setError('');
    setConnecting(true);
    try {
      // Both chains derive/sign on keys.orbiwallet.xyz (where the passkey
      // lives), via the same SDK popup handshake — just a different chain param.
      await orbi.connect({ chain });
      router.replace(chain === 'botchain' ? '/evm' : '/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Connection failed');
      setConnecting(false);
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="flex flex-col items-center gap-3 mb-10">
        <Image src="/Orbi Icon.png" alt="Orbi" width={64} height={64} className="w-16 h-16 rounded-2xl" priority />
        <h1 className="text-2xl font-bold text-white">Orbi Wallet</h1>
        <p className="text-slate-400 text-center text-sm max-w-xs">
          Connect your wallet to view your balance, activity, and send funds.
        </p>
      </div>

      <div className="w-full max-w-sm flex flex-col gap-4">
        <button
          onClick={() => setPickerOpen(true)}
          disabled={connecting}
          className="w-full py-4 rounded-2xl bg-white hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed text-slate-900 font-semibold transition-colors flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Connecting…
            </>
          ) : (
            'Connect wallet'
          )}
        </button>

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
      </div>

      <ChainPickerModal open={pickerOpen} onPick={handlePick} onClose={() => setPickerOpen(false)} />
    </main>
  );
}

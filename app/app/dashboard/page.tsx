'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrbiClient, type OrbiChain } from '@orbi-wallet/sdk';
import { getNetworkPreference } from '../../lib/storage';
import StellarDashboard from './StellarDashboard';
import BotChainDashboard from './BotChainDashboard';

// Thin shell: reads the active chain from the SDK session and renders the
// matching dashboard. Each sub-dashboard owns its own hooks (rules-of-hooks
// forbid branching them in one component), so the split keeps both clean.
const orbi = new OrbiClient({ network: getNetworkPreference() });

export default function DashboardPage() {
  const router = useRouter();
  const [chain, setChain] = useState<OrbiChain | null>(null);

  useEffect(() => {
    const c = orbi.getChain();
    if (!orbi.getAddress() || !c) { router.replace('/'); return; }
    setChain(c);
  }, [router]);

  // Switch chains in place: re-connect on the other chain (a passkey tap on
  // keys.orbiwallet.xyz to derive its address), then swap the rendered view.
  async function switchChain() {
    const next: OrbiChain = chain === 'botchain' ? 'stellar' : 'botchain';
    try {
      await orbi.connect({ chain: next });
      setChain(next);
    } catch { /* user cancelled the popup — stay on the current chain */ }
  }

  if (!chain) return null;

  return chain === 'botchain'
    ? <BotChainDashboard onSwitchChain={switchChain} />
    : <StellarDashboard onSwitchChain={switchChain} />;
}

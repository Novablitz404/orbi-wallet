'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OrbiClient } from '@orbi-wallet/sdk';
import { getNetworkPreference } from '../../lib/storage';
import StellarDashboard from './StellarDashboard';

const orbi = new OrbiClient({ network: getNetworkPreference() });

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!orbi.getAddress()) { router.replace('/'); return; }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return <StellarDashboard />;
}

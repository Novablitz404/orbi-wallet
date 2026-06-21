'use client';

import { useEffect, useState } from 'react';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

// Keep third-party analytics OFF the signing / RP origin (keys.orbiwallet.xyz),
// where the wallet key is briefly assembled in memory — no third-party JS should
// run on a page that touches key material. Analytics still loads on the main app
// origin (account.orbiwallet.xyz). Renders nothing until mounted, so server and
// first client render match (no hydration mismatch).
const KEYS_HOST = 'keys.orbiwallet.xyz';

export default function ConditionalAnalytics() {
  const [host, setHost] = useState<string | null>(null);
  useEffect(() => { setHost(window.location.hostname); }, []);

  if (host === null || host === KEYS_HOST) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}

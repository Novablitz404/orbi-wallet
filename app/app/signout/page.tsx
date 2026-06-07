'use client';

import { useEffect } from 'react';
import { clearWallet } from '../../lib/storage';

// Opened in a popup from account.orbiwallet.xyz to clear the wallet session
// on this origin (cross-origin storage means account. can't do it directly),
// then reports back and closes — see lib/walletSignOut.ts.
export default function SignOutPage() {
  useEffect(() => {
    clearWallet();
    try { window.opener?.postMessage({ type: 'orbi_signed_out' }, '*'); } catch { /* COOP */ }
    window.close();
  }, []);

  return null;
}

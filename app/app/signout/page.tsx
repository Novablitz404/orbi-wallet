'use client';

import { useEffect } from 'react';
import { clearWallet } from '../../lib/storage';

export default function SignOutPage() {
  useEffect(() => {
    // Clear wallet on this domain (keys.orbiwallet.xyz)
    clearWallet();

    // Redirect back to wherever we came from (account.orbiwallet.xyz)
    const params = new URLSearchParams(window.location.search);
    const redirect = params.get('redirect') ?? 'https://account.orbiwallet.xyz';
    window.location.replace(redirect);
  }, []);

  return null;
}

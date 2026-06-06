'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { loadWallet } from '../lib/storage';

const LANDING_URL = 'https://orbiwallet.xyz';

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (loadWallet()) {
      router.replace('/dashboard');
    } else {
      window.location.replace(LANDING_URL);
    }
  }, [router]);

  return null;
}

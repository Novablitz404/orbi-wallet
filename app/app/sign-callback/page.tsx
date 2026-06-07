'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const HORIZON_URL = process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
  ? 'https://horizon.stellar.org'
  : 'https://horizon-testnet.stellar.org';

export default function SignCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gSignedXdr = params.get('gSignedXdr');

    if (!gSignedXdr) {
      router.replace('/dashboard');
      return;
    }

    fetch(`${HORIZON_URL}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ tx: gSignedXdr }),
    })
      .then(res => res.json() as Promise<{ hash?: string; extras?: { result_codes?: unknown }; title?: string }>)
      .then(data => {
        if (data.hash) {
          router.replace(`/dashboard?txHash=${data.hash}`);
        } else {
          const detail = JSON.stringify(data.extras?.result_codes ?? data.title ?? 'Submit failed');
          router.replace('/dashboard?txError=' + encodeURIComponent(detail));
        }
      })
      .catch(err => {
        router.replace('/dashboard?txError=' + encodeURIComponent(err.message ?? 'Submit failed'));
      });
  }, [router]);

  return (
    <main className="flex items-center justify-center min-h-screen bg-[#020817]">
      <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveWallet } from '../../lib/storage';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL;

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('Invalid callback — no token');
      return;
    }

    fetch(`${RELAY_URL}/v1/auth/tokens/${token}`)
      .then(res => {
        if (!res.ok) throw new Error('Token expired or already used');
        return res.json() as Promise<{ walletAddress: string; credentialId: string; passkeyId: string; email: string }>;
      })
      .then(data => {
        saveWallet({
          walletAddress: data.walletAddress,
          credentialId: data.credentialId,
          passkeyId: data.passkeyId,
          email: data.email,
        });
        router.replace('/dashboard');
      })
      .catch(err => setError(err.message));
  }, [router]);

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      {error ? (
        <div className="text-center flex flex-col gap-4">
          <p className="text-red-400 text-sm">{error}</p>
          <a href="/" className="text-blue-400 text-sm hover:underline">Back to home</a>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <svg className="animate-spin w-8 h-8 text-blue-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <p className="text-slate-400 text-sm">Signing in…</p>
        </div>
      )}
    </main>
  );
}

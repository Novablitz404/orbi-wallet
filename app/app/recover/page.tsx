'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPasskey } from '../../lib/passkey';
import BackButton from '../../components/BackButton';
import { initiateRecovery, confirmRecovery } from '../../lib/relay';
import { saveWallet, loadWallet } from '../../lib/storage';

type Step = 'email' | 'passkey' | 'otp' | 'done';

export default function RecoverPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingCredential, setPendingCredential] = useState<{
    credentialId: string;
    passkeyId: string;
    publicKey: string;
  } | null>(null);

  async function handleCreateNewPasskey() {
    setError('');
    setLoading(true);
    try {
      const credential = await createPasskey(email, email);
      setPendingCredential(credential);

      await initiateRecovery({
        email,
        newPasskeyId: credential.passkeyId,
        newPublicKey: credential.publicKey,
      });

      setStep('otp');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmOtp() {
    if (!otp.trim() || !pendingCredential) return;
    setError('');
    setLoading(true);
    try {
      await confirmRecovery({ email, otp });

      // Reload existing wallet address or prompt re-entry
      const existing = loadWallet();
      if (existing) {
        saveWallet({ ...existing, credentialId: pendingCredential.credentialId, passkeyId: pendingCredential.passkeyId });
      }

      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col items-center justify-center min-h-screen px-4 bg-[#020817]">
      <div className="absolute top-6 left-4"><BackButton href="/" /></div>
      <div className="w-full max-w-sm">

        {step === 'email' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Recover wallet</h2>
              <p className="text-slate-400 text-sm mt-1">Enter the email linked to your wallet. We'll send a recovery code.</p>
            </div>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && email.trim() && setStep('passkey')}
              className="w-full px-4 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={() => email.trim() && setStep('passkey')}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'passkey' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Set up new passkey</h2>
              <p className="text-slate-400 text-sm mt-1">Create a new passkey on this device, then we'll send a code to verify it's really you.</p>
            </div>
            <div className="rounded-2xl bg-slate-800/50 border border-slate-700 p-6 flex flex-col items-center gap-3">
              <div className="w-14 h-14 rounded-full bg-blue-500/10 border border-blue-500/30 flex items-center justify-center">
                <svg className="w-7 h-7 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 11c0-2.76 2.24-5 5-5s5 2.24 5 5v2M5 11v2a7 7 0 0014 0v-2" />
                </svg>
              </div>
              <p className="text-slate-300 text-sm text-center">
                Recovering wallet for<br />
                <span className="text-white font-medium">{email}</span>
              </p>
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleCreateNewPasskey}
              disabled={loading}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? 'Setting up…' : 'Set up passkey & send code'}
            </button>
          </div>
        )}

        {step === 'otp' && (
          <div className="flex flex-col gap-6">
            <div>
              <h2 className="text-2xl font-bold text-white">Check your email</h2>
              <p className="text-slate-400 text-sm mt-1">We sent a 6-digit code to <span className="text-white">{email}</span>. It expires in 10 minutes.</p>
            </div>
            <input
              type="text"
              placeholder="000000"
              maxLength={6}
              value={otp}
              onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && handleConfirmOtp()}
              className="w-full px-4 py-4 rounded-xl bg-slate-800 border border-slate-700 text-white text-center text-2xl tracking-[0.5em] placeholder-slate-600 focus:outline-none focus:border-blue-500 transition-colors font-mono"
            />
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <button
              onClick={handleConfirmOtp}
              disabled={loading || otp.length < 6}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Confirm recovery'}
            </button>
            <button
              onClick={handleCreateNewPasskey}
              className="text-slate-500 hover:text-slate-300 text-sm text-center transition-colors"
            >
              Resend code
            </button>
          </div>
        )}

        {step === 'done' && (
          <div className="flex flex-col items-center gap-6">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-center">
              <h2 className="text-2xl font-bold text-white">Wallet recovered!</h2>
              <p className="text-slate-400 text-sm mt-1">Your wallet is now secured with your new passkey.</p>
            </div>
            <button
              onClick={() => router.push('/dashboard')}
              className="w-full py-4 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

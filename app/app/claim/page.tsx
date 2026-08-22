'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Wallet,
  Loader2,
} from 'lucide-react';
import { OrbiClient } from '@orbi-wallet/sdk';
import { getNetworkPreference, loadWallet, saveWallet, setSdkSession } from '../../lib/storage';
import { XLM_ICON } from '../../lib/tokens';
import { getClaimableBalanceDetails, claimMagicLink, ClaimableBalanceDetails } from '../../lib/magic-link';

const NETWORK = getNetworkPreference();
const orbi = new OrbiClient({ network: NETWORK });

function ClaimContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const balanceId = searchParams.get('balance_id');
  const claimSecret = searchParams.get('claim_secret');

  const [details, setDetails] = useState<ClaimableBalanceDetails | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState('');

  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [claimedSuccess, setClaimedSuccess] = useState(false);
  const [recipientAddr, setRecipientAddr] = useState<string | null>(null);

  useEffect(() => {
    if (!balanceId) {
      setFetchError('Invalid Magic Link: missing balance_id.');
      setFetching(false);
      return;
    }

    getClaimableBalanceDetails(balanceId)
      .then((data) => {
        setDetails(data);
        setFetching(false);
      })
      .catch((err) => {
        setFetchError(err instanceof Error ? err.message : 'Magic Link expired or already claimed.');
        setFetching(false);
      });
  }, [balanceId]);

  async function handleClaim() {
    if (!balanceId || !claimSecret) {
      setClaimError('Missing balance credentials. Please use the original Magic Link.');
      return;
    }

    setClaimError('');
    setClaiming(true);

    try {
      let currentAddress = orbi.getAddress();
      if (!currentAddress) {
        const stored = loadWallet();
        currentAddress = stored?.walletAddress ?? null;
      }

      if (!currentAddress) {
        const conn = await orbi.connect();
        currentAddress = conn.walletAddress || conn.addresses?.stellar || orbi.getAddress() || '';

        const newWallet = {
          walletAddress: currentAddress,
          credentialId: conn.credentialId || '',
          passkeyId: conn.credentialId || '',
        };
        saveWallet(newWallet);
        setSdkSession(newWallet);
      }

      setRecipientAddr(currentAddress);

      await claimMagicLink({
        balanceId,
        claimSecret,
        recipientAddress: currentAddress,
      });

      setClaimedSuccess(true);
    } catch (err: unknown) {
      setClaimError(err instanceof Error ? err.message : 'Failed to claim funds');
    } finally {
      setClaiming(false);
    }
  }

  const assetIcon = details?.isNative
    ? XLM_ICON
    : `https://stellar.expert/img/assets/${details?.assetCode}-${details?.assetIssuer}.png`;

  return (
    <main className="min-h-screen bg-[#020817] text-white p-4 md:p-8 flex flex-col items-center justify-center font-display">
      <div className="w-full max-w-md">
        {/* Header Branding */}
        <div className="flex flex-col items-center gap-2 mb-6 text-center">
          <Image src="/Orbi Icon.png" alt="Orbi" width={56} height={56} className="w-14 h-14 rounded-2xl" priority />
          <h1 className="text-xl font-bold text-white">Orbi Magic Link</h1>
          <p className="text-xs text-slate-400">
            Passkey-secured transfer on Stellar network.
          </p>
        </div>

        <div className="rounded-2xl bg-slate-800/40 border border-slate-700/50 p-6 md:p-8 shadow-xl">
          {fetching && (
            <div className="py-10 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
              <p className="text-xs text-slate-400">Verifying Magic Link on Stellar network…</p>
            </div>
          )}

          {!fetching && fetchError && (
            <div className="py-6 text-center space-y-4">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
                <AlertCircle className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-white">Link Unavailable</h2>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xs mx-auto">{fetchError}</p>
              <button
                onClick={() => router.push('/')}
                className="w-full py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition-colors"
              >
                Go to Orbi Home
              </button>
            </div>
          )}

          {!fetching && details && !claimedSuccess && (
            <div className="space-y-5">
              {/* Claim Details Card */}
              <div className="p-5 rounded-xl bg-slate-900/60 border border-slate-800 text-center">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Incoming Payment</p>

                <div className="flex items-center justify-center gap-2.5 mb-2">
                  <img
                    src={assetIcon}
                    alt={details.assetCode}
                    className="w-8 h-8 rounded-full object-cover shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).src = XLM_ICON;
                    }}
                  />
                  <span className="text-3xl font-bold text-white font-mono">
                    {parseFloat(details.amount).toLocaleString()} {details.assetCode}
                  </span>
                </div>

                <p className="text-xs text-slate-500 mt-1">
                  From <span className="font-mono text-slate-300">{details.sponsor.slice(0, 6)}...{details.sponsor.slice(-4)}</span>
                </p>
              </div>

              {claimError && (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{claimError}</span>
                </div>
              )}

              {/* Primary Claim CTA */}
              <button
                onClick={handleClaim}
                disabled={claiming}
                className="w-full py-3.5 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-50 font-semibold text-slate-900 text-sm shadow-md flex items-center justify-center gap-2 transition-all active:scale-[0.98]"
              >
                {claiming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-slate-900" />
                    Claiming into Wallet…
                  </>
                ) : (
                  <>
                    <Wallet className="w-4 h-4" /> Claim Funds with Face ID
                  </>
                )}
              </button>
            </div>
          )}

          {claimedSuccess && (
            <div className="py-4 space-y-5 text-center animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-7 h-7" />
              </div>

              <div>
                <h2 className="text-lg font-bold text-white">Funds Claimed!</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Received <span className="font-semibold text-white">{parseFloat(details?.amount ?? '0').toLocaleString()} {details?.assetCode}</span> into your wallet.
                </p>
              </div>

              <button
                onClick={() => router.push('/dashboard')}
                className="w-full py-3.5 rounded-xl bg-white hover:bg-slate-100 text-slate-900 font-semibold text-xs shadow-md flex items-center justify-center gap-1.5 transition-all active:scale-[0.98]"
              >
                Open Dashboard <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#020817] text-white p-4 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </main>
      }
    >
      <ClaimContent />
    </Suspense>
  );
}

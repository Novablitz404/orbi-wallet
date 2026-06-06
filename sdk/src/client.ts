/**
 * @orbi-wallet/sdk — Orbi Smart Wallet SDK
 *
 * Lets any Stellar dApp integrate Orbi passkey wallets using a redirect flow.
 * Works on all devices and browsers — no popups, no extensions needed.
 *
 * Quick start:
 *   const orbi = new OrbiClient({ apiUrl: 'https://api.orbiwallet.xyz' });
 *
 * Flow:
 *   1. orbi.connect({ redirectUrl })          — redirect user to connect wallet
 *   2. orbi.handleCallback()                  — on return, exchange token for wallet data
 *   3. orbi.sign({ ..., redirectUrl })        — redirect user to approve transaction
 *   4. orbi.handleSignCallback() → bundle()   — on return, submit signed tx
 *   5. orbi.waitForConfirmation(opId)         — wait for on-chain confirmation
 */

import type { OrbiClientConfig, OpStatus } from './types';

const KEYS_URL = 'https://keys.orbiwallet.xyz';

// @stellar/js-xdr calls readBigInt64BE / writeBigInt64BE on its internal buffer
// when serializing Int64/Hyper XDR values. The browser Buffer polyfill is missing
// these methods. Patch Uint8Array.prototype via DataView so they resolve everywhere.
type _TypedArr = Uint8Array & {
  readBigInt64BE?: (offset?: number) => bigint;
  readBigUInt64BE?: (offset?: number) => bigint;
  readBigInt64LE?: (offset?: number) => bigint;
  readBigUInt64LE?: (offset?: number) => bigint;
  writeBigInt64BE?: (value: bigint, offset?: number) => number;
  writeBigUInt64BE?: (value: bigint, offset?: number) => number;
  writeBigInt64LE?: (value: bigint, offset?: number) => number;
  writeBigUInt64LE?: (value: bigint, offset?: number) => number;
};
function _patchBuffer() {
  if (typeof window === 'undefined') return;
  function dv(b: Uint8Array) { return new DataView(b.buffer, b.byteOffset, b.byteLength); }
  function def(p: _TypedArr, n: string, fn: (this: Uint8Array, ...a: never[]) => unknown) {
    if (typeof (p as unknown as Record<string, unknown>)[n] !== 'function')
      Object.defineProperty(p, n, { value: fn, writable: true, configurable: true });
  }
  function patch(p: _TypedArr | undefined) {
    if (!p) return;
    def(p, 'readBigInt64BE',  function(this: Uint8Array, o = 0) { return dv(this).getBigInt64(o, false); } as never);
    def(p, 'readBigUInt64BE', function(this: Uint8Array, o = 0) { return dv(this).getBigUint64(o, false); } as never);
    def(p, 'readBigInt64LE',  function(this: Uint8Array, o = 0) { return dv(this).getBigInt64(o, true); } as never);
    def(p, 'readBigUInt64LE', function(this: Uint8Array, o = 0) { return dv(this).getBigUint64(o, true); } as never);
    def(p, 'writeBigInt64BE',  function(this: Uint8Array, v: bigint, o = 0) { dv(this).setBigInt64(o, v, false); return o + 8; } as never);
    def(p, 'writeBigUInt64BE', function(this: Uint8Array, v: bigint, o = 0) { dv(this).setBigUint64(o, v, false); return o + 8; } as never);
    def(p, 'writeBigInt64LE',  function(this: Uint8Array, v: bigint, o = 0) { dv(this).setBigInt64(o, v, true); return o + 8; } as never);
    def(p, 'writeBigUInt64LE', function(this: Uint8Array, v: bigint, o = 0) { dv(this).setBigUint64(o, v, true); return o + 8; } as never);
  }
  patch(Uint8Array.prototype as _TypedArr);
  patch((globalThis as unknown as { Buffer?: { prototype: _TypedArr } }).Buffer?.prototype);
}

export class OrbiClient {
  private apiUrl: string;

  constructor(config: OrbiClientConfig) {
    this.apiUrl = config.apiUrl.replace(/\/$/, '');
    _patchBuffer();
  }

  // ── Wallet connection ───────────────────────────────────────────────────────

  /** Redirect the user to Orbi to connect their wallet. */
  connect(params: { redirectUrl: string }) {
    const url = new URL(`${KEYS_URL}/connect`);
    url.searchParams.set('redirect', params.redirectUrl);
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }

  /**
   * Clear the Orbi session and redirect back to your app.
   * Call this when the user disconnects — clears the passkey session on
   * keys.orbiwallet.xyz so the next connect() prompts for authentication again.
   * You are responsible for clearing your own local wallet state before calling this.
   */
  disconnect(redirectUrl: string) {
    const url = new URL(`${KEYS_URL}/signout`);
    url.searchParams.set('redirect', redirectUrl);
    window.location.href = url.toString();
  }

  /** Call this on your callback page after orbi.connect() redirects back. */
  async handleCallback(): Promise<{ walletAddress: string; passkeyId: string; email: string } | null> {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (!token) return null;

    const res = await fetch(`${this.apiUrl}/v1/auth/tokens/${token}`);
    if (!res.ok) throw new Error('Invalid or expired Orbi token');
    return res.json() as Promise<{ walletAddress: string; passkeyId: string; email: string }>;
  }

  // ── Transaction signing ─────────────────────────────────────────────────────

  /** Redirect the user to Orbi to approve a transaction with their passkey. */
  sign(params: {
    walletAddress: string;
    contractId: string;
    functionName: string;
    argsXdr: string[];
    redirectUrl: string;
  }) {
    const url = new URL(`${KEYS_URL}/sign`);
    url.searchParams.set('redirect', params.redirectUrl);
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('walletAddress', params.walletAddress);
    url.searchParams.set('contractId', params.contractId);
    url.searchParams.set('functionName', params.functionName);
    url.searchParams.set('argsXdr', JSON.stringify(params.argsXdr));
    window.location.href = url.toString();
  }

  /** Call this on your sign-callback page after orbi.sign() redirects back. */
  handleSignCallback(): {
    signedAuthEntryXdr: string;
    quoteId: string;
    argsXdr: string[];
    nativeSacId: string;
    walletAddress: string;
  } | null {
    const params = new URLSearchParams(window.location.search);
    const signedXdr = params.get('signedXdr');
    const quoteId = params.get('quoteId');
    const argsXdrRaw = params.get('argsXdr');
    const nativeSacId = params.get('nativeSacId');
    const walletAddress = params.get('walletAddress');

    if (!signedXdr || !quoteId || !argsXdrRaw || !nativeSacId || !walletAddress) return null;
    return {
      signedAuthEntryXdr: signedXdr,
      quoteId,
      argsXdr: JSON.parse(argsXdrRaw) as string[],
      nativeSacId,
      walletAddress,
    };
  }

  // ── Token management ────────────────────────────────────────────────────────

  /** Redirect the user to add a token to their Orbi wallet. */
  watchAsset(params: { contractId: string; redirectUrl: string }) {
    const url = new URL(`${KEYS_URL}/watch-asset`);
    url.searchParams.set('contractId', params.contractId);
    url.searchParams.set('redirect', params.redirectUrl);
    url.searchParams.set('origin', window.location.origin);
    window.location.href = url.toString();
  }

  /** Call this on your callback page after orbi.watchAsset() redirects back. */
  handleWatchAssetCallback(): { contractId: string; added: boolean } | null {
    const params = new URLSearchParams(window.location.search);
    const contractId = params.get('watchedContractId');
    if (!contractId) return null;
    return { contractId, added: params.get('watched') === 'true' };
  }

  // ── Relay API ───────────────────────────────────────────────────────────────

  /** Submit a signed operation to the Orbi relay. */
  async bundle(params: {
    walletAddress: string;
    quoteId: string;
    signedAuthEntryXdr: string;
    contractId: string;
    functionName: string;
    argsXdr: string[];
  }): Promise<{ opId: string }> {
    const res = await fetch(`${this.apiUrl}/v1/bundle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        walletAddress: params.walletAddress,
        quoteId: params.quoteId,
        authEntryXdr: params.signedAuthEntryXdr,
        call: {
          contractId: params.contractId,
          function: params.functionName,
          argsXdr: params.argsXdr,
        },
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(err.error ?? `Bundle failed: ${res.status}`);
    }
    return res.json() as Promise<{ opId: string }>;
  }

  /** One-shot status check for an operation. */
  async getStatus(opId: string): Promise<OpStatus> {
    const res = await fetch(`${this.apiUrl}/v1/status/${opId}`);
    if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
    return res.json() as Promise<OpStatus>;
  }

  /** Wait for confirmed or failed via SSE (~5s on Stellar). */
  waitForConfirmation(opId: string): Promise<OpStatus> {
    return new Promise((resolve, reject) => {
      const es = new EventSource(`${this.apiUrl}/v1/wallet/events/${opId}`);
      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data as string) as { status: string; txHash?: string; error?: string };
          es.close();
          if (data.status === 'confirmed') {
            resolve({ opId, status: 'confirmed', txHash: data.txHash ?? null, error: null });
          } else if (data.status === 'failed') {
            resolve({ opId, status: 'failed', txHash: null, error: data.error ?? 'Transaction failed' });
          } else if (data.status === 'timeout') {
            reject(new Error(`Op ${opId} timed out`));
          }
        } catch {
          es.close();
          reject(new Error('Invalid SSE response'));
        }
      };
      es.onerror = () => {
        es.close();
        reject(new Error(`Lost connection waiting for op ${opId}`));
      };
    });
  }
}

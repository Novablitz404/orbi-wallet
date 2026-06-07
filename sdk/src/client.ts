/**
 * @orbi-wallet/sdk — Orbi Smart Wallet SDK (G-wallet)
 *
 * Connects a Stellar dApp to Orbi passkey wallets via a popup + postMessage
 * handshake — the same integration pattern Coinbase Smart Wallet uses.
 *
 *   const orbi = new OrbiClient();
 *   const { walletAddress } = await orbi.connect();
 *   const { signedXdr } = await orbi.signTransaction({ xdr });
 */

import type { ConnectedWallet, OrbiClientConfig, OrbiNetwork, SignResult } from './types';
// Generated from package.json at build time (see scripts/generate-version.js)
// — package.json stays the single source of truth for name/version.
import { SDK_NAME, SDK_VERSION } from './version';

const KEYS_URL = 'https://keys.orbiwallet.xyz';
const KEYS_ORIGIN = new URL(KEYS_URL).origin;
const SESSION_KEY = 'orbi_session';

const POPUP_WIDTH = 420;
const POPUP_HEIGHT = 640;

interface PopupRequest<T> {
  path: string;
  params?: Record<string, string>;
  successType: string;
  mapSuccess: (msg: Record<string, unknown>) => T;
}

export class OrbiClient {
  private network: OrbiNetwork;

  constructor(config: OrbiClientConfig = {}) {
    this.network = config.network ?? 'testnet';
  }

  // ── Session ─────────────────────────────────────────────────────────────────

  /** Wallet address from a previous `connect()`, restored from local storage. */
  getAddress(): string | null {
    return this.getSession()?.walletAddress ?? null;
  }

  /** Forget the cached session. The next `connect()` reopens the Orbi popup. */
  disconnect(): void {
    if (typeof window === 'undefined') return;
    localStorage.removeItem(SESSION_KEY);
  }

  private getSession(): ConnectedWallet | null {
    if (typeof window === 'undefined') return null;
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as ConnectedWallet) : null;
  }

  // ── Wallet connection ───────────────────────────────────────────────────────

  /**
   * Connect the user's Orbi wallet. Resolves immediately from a cached
   * session if one exists; otherwise opens the Orbi connect popup and
   * resolves once the user approves.
   */
  async connect(): Promise<ConnectedWallet> {
    const cached = this.getSession();
    if (cached) return cached;

    const wallet = await this.openPopup<ConnectedWallet>({
      path: '/connect',
      successType: 'orbi_connected',
      mapSuccess: (msg) => ({
        walletAddress: msg.address as string,
        credentialId: (msg.credentialId as string | undefined) ?? '',
        passkeyId: (msg.passkeyId as string | undefined) ?? '',
        email: (msg.email as string | undefined) ?? '',
      }),
    });

    localStorage.setItem(SESSION_KEY, JSON.stringify(wallet));
    return wallet;
  }

  // ── Transaction signing ─────────────────────────────────────────────────────

  /**
   * Ask the user to review and approve a transaction with their passkey.
   *
   * `xdr` is a base64-encoded TransactionEnvelope for a classic G account —
   * build it with `@stellar/stellar-sdk` on your end. Orbi only signs; submit
   * the returned `signedXdr` to Horizon yourself.
   */
  signTransaction(params: { xdr: string; walletAddress?: string }): Promise<SignResult> {
    const walletAddress = params.walletAddress ?? this.getAddress() ?? undefined;

    return this.openPopup<SignResult>({
      path: '/sign',
      params: {
        xdr: params.xdr,
        network: this.network,
        ...(walletAddress ? { walletAddress } : {}),
      },
      successType: 'orbi_g_signed',
      mapSuccess: (msg) => ({
        signedXdr: msg.signedXdr as string,
        walletAddress: msg.walletAddress as string,
      }),
    });
  }

  // ── Popup + postMessage handshake ───────────────────────────────────────────

  private openPopup<T>(req: PopupRequest<T>): Promise<T> {
    if (typeof window === 'undefined') {
      return Promise.reject(new Error('Orbi requires a browser environment'));
    }

    const url = new URL(`${KEYS_URL}${req.path}`);
    url.searchParams.set('origin', window.location.origin);
    url.searchParams.set('sdkName', SDK_NAME);
    url.searchParams.set('sdkVersion', SDK_VERSION);
    for (const [key, value] of Object.entries(req.params ?? {})) url.searchParams.set(key, value);

    const left = window.screenX + Math.max(0, (window.outerWidth - POPUP_WIDTH) / 2);
    const top = window.screenY + Math.max(0, (window.outerHeight - POPUP_HEIGHT) / 2);
    const popup = window.open(
      url.toString(),
      'orbi-wallet',
      `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top}`,
    );
    if (!popup) {
      return Promise.reject(new Error('Popup blocked — allow popups for this site to use Orbi'));
    }

    return new Promise<T>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('message', onMessage);
        clearInterval(closedCheck);
        fn();
      };

      const onMessage = (event: MessageEvent) => {
        // event.origin is never affected by Cross-Origin-Opener-Policy and
        // can't be spoofed — always required. event.source (the popup window
        // reference) adds extra anti-spoofing when the browser provides it,
        // but COOP isolation can null it out on either side, so we only
        // enforce it when present rather than rejecting legit messages.
        if (event.origin !== KEYS_ORIGIN) return;
        if (event.source !== null && event.source !== popup) return;

        const data = event.data as { type?: string } & Record<string, unknown>;
        if (data?.type === req.successType) {
          settle(() => resolve(req.mapSuccess(data)));
        } else if (data?.type === 'orbi_cancelled') {
          settle(() => reject(new Error('Cancelled in Orbi')));
        }
      };

      const closedCheck = setInterval(() => {
        if (popup.closed) settle(() => reject(new Error('Orbi window closed before completing')));
      }, 500);

      window.addEventListener('message', onMessage);
    });
  }
}

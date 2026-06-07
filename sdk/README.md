# @orbi-wallet/sdk

The official SDK for connecting your Stellar dApp to [Orbi Smart Wallet](https://orbiwallet.xyz).

Orbi is a passkey-secured **classic Stellar (G) account** wallet. Users sign in and approve transactions with Face ID / Touch ID — no seed phrase, no browser extension.

---

## Install

```bash
npm install @orbi-wallet/sdk
```

---

## Quick start

```ts
import { OrbiClient } from '@orbi-wallet/sdk';

const orbi = new OrbiClient({ network: 'testnet' });

// 1. Connect — opens a popup, resolves once the user approves
const { walletAddress } = await orbi.connect();

// 2. Build a transaction with @stellar/stellar-sdk and get its XDR
const xdr = transaction.toXDR();

// 3. Ask the user to review and sign — opens a popup, resolves with the signed XDR
const { signedXdr } = await orbi.signTransaction({ xdr });

// 4. Submit signedXdr to Horizon yourself (e.g. server.submitTransaction)
```

---

## How it works

Orbi uses a **popup + postMessage** handshake — the same integration pattern Coinbase Smart Wallet and most modern wallet SDKs use:

1. `orbi.connect()` / `orbi.signTransaction()` opens `keys.orbiwallet.xyz` in a popup
2. The user approves with their passkey (signs in, or creates a wallet first if new)
3. The popup posts the result back to your page and closes itself
4. The returned promise resolves with the result

The connected wallet is cached in `localStorage`, so later `connect()` calls resolve instantly without reopening the popup. Call `disconnect()` to clear it.

---

## API

### `new OrbiClient(config?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `network` | `'testnet' \| 'mainnet'` | `'testnet'` | Stellar network — passed through so Orbi shows the right network badge and validates the transaction against the matching ledger |

### `connect(): Promise<ConnectedWallet>`

Connects the user's wallet. Returns a cached session instantly if one exists; otherwise opens the connect popup and resolves once the user approves.

```ts
const { walletAddress, credentialId, passkeyId, email } = await orbi.connect();
```

### `signTransaction({ xdr, walletAddress? }): Promise<SignResult>`

Opens the sign popup so the user can review and approve a transaction with their passkey.

- `xdr` — base64-encoded `TransactionEnvelope` XDR for a classic G account (build it with `@stellar/stellar-sdk`)
- `walletAddress` — optional; defaults to the currently connected address

```ts
const { signedXdr, walletAddress } = await orbi.signTransaction({ xdr });
```

Orbi only signs — it does not submit. Submit `signedXdr` to Horizon yourself.

### `getAddress(): string | null`

Returns the cached wallet address from a previous `connect()`, or `null` if not connected.

### `disconnect(): void`

Clears the cached session on your side. Doesn't revoke anything on Orbi — the user can reconnect any time with their passkey.

---

## Notes

- Requires popups to be allowed for your site — `connect()`/`signTransaction()` reject with a clear error if the popup is blocked or the user closes it
- Works with Orbi G-wallets only (classic Stellar accounts)
- Results are only ever accepted from `https://keys.orbiwallet.xyz`, verified by both message origin and source window — never trust `postMessage` from elsewhere

---

## Links

- [Orbi Wallet](https://orbiwallet.xyz)
- [GitHub](https://github.com/Novablitz404/orbi-smart-wallet)

---

## License

MIT

# Orbi Wallet

A passkey-secured Stellar wallet for everyday people — paired with an open SDK that lets any Stellar dApp offer that same seedless, Face-ID-only experience to its own users. No seed phrases, no browser extensions, no smart contracts.

## Problem

Two problems share one root cause, and Orbi was built to close both at once.

**For everyday users**, seed phrases are the single biggest barrier between ordinary people and crypto. Twelve or twenty-four random words are something to write down, photograph, lose, or have stolen — and the entire wallet depends on getting that one step right, forever, with no second chances. For first-time users — exactly the population financial-inclusion efforts are trying to reach — that's not minor friction, it's a wall. The Philippines is a uniquely good place to tear it down: Stellar already underpins real remittance and anchor infrastructure serving Filipino users and OFWs abroad, and biometric phone unlock is already a daily habit on the devices most people actually own. The missing piece was never "access to Stellar" — it was a wallet that doesn't ask a first-time user to safely store 24 random words before they can receive their first payment.

**For builders**, every Stellar dApp that wants a frictionless "connect wallet" flow is stuck choosing between browser-extension wallets (which most everyday users have never installed) and custodial or relay-backed smart-wallet schemes (which reintroduce a trusted third party and usually require Soroban). There has been no drop-in, keyless, classic-account wallet primitive that a dApp can integrate in an afternoon — and that a brand-new user can adopt with nothing but a fingerprint.

Orbi closes both gaps with one piece of infrastructure: a wallet end users can create and use with just Face ID / Touch ID, and an SDK (`@orbi-wallet/sdk`) that lets any Stellar dApp offer that exact same experience to its own users — turning a hard UX problem into reusable rails for the wider ecosystem.

## How It Works

**For everyday users**
1. **Create** — tap "Create Wallet," approve a Face ID / Touch ID prompt (this creates a passkey), and instantly get a real Stellar address. No words to write down, no file to keep safe, nothing that can be lost.
2. **Use** — sending, receiving, swapping, or adding a token all work the same way: review what you're about to do, then approve it with the same biometric tap used to unlock the phone.
3. **Return** — opening the wallet on any device that shares the same passkey (synced automatically via iCloud Keychain / Google Password Manager, like any other passkey) restores the *exact same address* instantly — nothing to import, restore, or migrate.

**For builders**
4. **Integrate** — drop `@orbi-wallet/sdk` into any Stellar dApp and offer "Sign in with Orbi": a popup-based connect-and-sign flow (the same integration shape as Coinbase Smart Wallet). A user who already has an Orbi passkey authenticates into a brand-new dApp in two taps — no new account, no extension to install, no seed phrase, ever. One passkey, reusable across the whole ecosystem.

## How It Uses Stellar

- **Classic `G` accounts (Ed25519), not Soroban contracts.** Orbi derives a standard Stellar keypair straight from the passkey, using the WebAuthn PRF extension and HKDF — so the account that comes out is an ordinary `G...` address, recognized by every wallet, anchor, and exchange on the network. No special contract support is required anywhere in the ecosystem for Orbi users to transact with anyone else.
- **Direct submission to Horizon.** Build with `TransactionBuilder`, sign with the passkey-derived key, submit straight to Horizon — no relay, no bundler, no third party ever custodying funds or fronting fees.
- **Trustlines (`changeTrust`).** Users can add any Stellar asset by code or issuer — with bidirectional autofill backed by Horizon's `/assets` index — establishing the trustlines that let real classic-Stellar assets (stablecoins, local-currency tokens, etc.) actually be held and used.
- **Path payments on the native DEX.** Swaps are plain `path payment strict send` operations against Stellar's order books — send asset A, receive asset B, atomically, with no external AMM or bridge in the loop.
- **Multi-asset by default.** XLM plus a curated set of classic assets with real, network-correct issuer addresses (USDC, EURC, AQUA, yXLM), extensible by the user at any time via the trustline flow above.
- **Why Stellar — and why this is novel here:** Stellar is the rare network where a *fully keyless* wallet is achievable today on a plain classic account — sub-cent fees, ~5 second finality, no gas-token juggling, no contract to deploy per user. That's what makes Orbi's architecture possible at all: deriving a real Ed25519 keypair live from a WebAuthn passkey and holding it in memory for only the ~100ms it takes to sign isn't something you could bolt onto a chain that needs a contract wallet and a relayer just to get gasless UX — on Stellar it's just a `TransactionBuilder` and a signature. It's also why Stellar is already the rail real remittance corridors into the Philippines run on, so a wallet built here plugs directly into the on/off-ramps that already exist instead of inventing its own.

## Track

- **2 — Financial Inclusion & Everyday Payments**: Orbi's whole premise is removing the seed-phrase barrier — the single biggest reason everyday people never get past "create a wallet." By securing the wallet with the same Face ID / Touch ID gesture someone already uses dozens of times a day, Orbi turns holding and moving Stellar assets into something anyone can do with zero new behavior to learn — exactly the audience financial-inclusion efforts are trying to reach.
- **6 — Open Innovation (Dev Tools / Novel)**: Orbi isn't only an end-user app — it also ships `@orbi-wallet/sdk`, a drop-in "Sign in with Orbi" integration any Stellar dApp can adopt, built on a genuinely new wallet architecture: a classic Ed25519 keypair derived live from a WebAuthn passkey (PRF + HKDF), existing in memory only for the ~100ms it takes to sign, with no smart-contract account, no relay, and no browser extension anywhere in the loop. That pairing — a novel keyless-derivation model plus reusable integration tooling for the wider ecosystem — is squarely a dev-tools / novel-approach contribution.

## Tech Stack

- Framework: Next.js 16 (App Router, Turbopack)
- Stellar SDK: `@stellar/stellar-sdk` v15.1.0
- Network: Mainnet & Testnet — switchable at runtime from an in-app dropdown (persisted per device; no separate build per network)
- WebAuthn: `@simplewebauthn/browser` — passkey registration/assertion with the PRF extension
- Styling: Tailwind CSS v4
- Monorepo (npm workspaces): `app/` — the wallet · `sdk/` — `@orbi-wallet/sdk`, the third-party dApp integration package

## Setup & Run

```bash
git clone https://github.com/Novablitz404/orbi-wallet.git
cd orbi-wallet
npm install

# app/.env.local — environment variables needed:
#   NEXT_PUBLIC_STELLAR_NETWORK=testnet         # or mainnet — default network for first-time visitors
#   NEXT_PUBLIC_PASSKEY_RP_ID=orbiwallet.xyz    # WebAuthn Relying Party ID (use your own domain locally)

npm run dev:app
```

Open [http://localhost:3000](http://localhost:3000). Note: creating/using a wallet requires a real platform authenticator with PRF support — Safari 17+ / macOS Sonoma+ or Chrome 118+, with Face ID, Touch ID, or Windows Hello, served over HTTPS or `localhost`.

## Network Details

- Network: **Both** — Mainnet and Testnet, switchable at runtime via the in-app dropdown; no separate deployment per network
- Horizon endpoints (read directly — no relay in the path):
  - Mainnet — `https://horizon.stellar.org`
  - Testnet — `https://horizon-testnet.stellar.org`
- Contract IDs: none — Orbi deliberately uses classic `G` accounts, not Soroban contracts
- Curated asset issuers (mainnet):
  - USDC — `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`
  - EURC — `GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2`
  - AQUA — `GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA`
  - yXLM — `GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55`
  - (Testnet uses Circle's official testnet USDC issuer; any other asset can be added in-app via the trustline flow)

## Team

- Anjuvh Baldwin J. Yguinto
  Rachel Joy P. Pacot

## License

MIT

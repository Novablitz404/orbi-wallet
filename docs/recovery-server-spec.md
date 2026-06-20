# Orbi Recovery & Login Server — Phase 1 Spec (A+B)

> Status: **design, not built.** This is the spec for the lean server that adds
> wallet recovery, no-passkey login, and cross-platform access to Orbi without
> giving up self-custody.
>
> Host-agnostic: this drops onto **Fly.io** or **Railway** unchanged
> (Node service + Postgres + Redis-or-equiv + external KMS). The host is **not**
> the security boundary — the non-custodial guarantee comes from the server
> holding only **1 of 3** shares.

---

## 1. Goal & non-goals

**Goal.** Let a user reach their existing Orbi wallet when the passkey is the
problem:

- **Recovery** — passkey lost/deleted → rebuild the wallet, then enroll a fresh passkey.
- **No-passkey login** — a computer with no biometric/passkey → sign in another way (Google).
- **Cross-platform** — created on Apple, opened on Android (and back) — the
  passkey doesn't roam across ecosystems, but the wallet must.

**Non-goals (Phase 1).**

- Not changing the everyday path. Passkey + PRF stays the primary, fastest flow.
- Not custodial. The server can **never** sign or reconstruct a key alone.
- Not smart-contract recovery (Orbi uses classic Stellar G accounts + plain EVM EOAs).
- No SMS/email magic-link yet. **Google sign-in is the only server-backed login factor in Phase 1.**

---

## 2. The A+B model

The wallet's **master seed** is the **PRF output itself** — the same value that
today derives the Stellar Ed25519 key and the EVM secp256k1 key via HKDF. We
**split that seed** with **2-of-3 Shamir Secret Sharing** into shares **{A, B,
Server}**. Any **two** reconstruct it on the user's device for ~100ms; we then
derive the chain keys exactly as today and zero everything.

| Share | Lives where | Released / unlocked by |
|-------|-------------|------------------------|
| **Passkey share (A)** | **Re-derived from the passkey PRF** (`A = HKDF(prf_output, 'orbi-share-a')`). Costs no storage; rides iCloud Keychain / Google Password Manager with the passkey. | A passkey assertion (Face ID / Touch ID) |
| **Cloud share (B)** | The user's **own** Google Drive **`appDataFolder`** (app-private, hidden from the user's file list; `drive.appdata` scope), **encrypted** (see §3). | Google sign-in + the server-held key `K_B` |
| **Server share** | Orbi's lean server, envelope-encrypted with **GCP KMS** | A verified login (passkey assertion **or** Google), rate-limited |

### Why this exact shape (design decisions)

- **Everyday path is unchanged and fully local.** Because the seed *is* the PRF
  output and `A = HKDF(prf_output)`, a device with the passkey derives the seed
  **directly from PRF** — no server, no Google, offline-capable, exactly like
  today. The 2-of-3 split is only *exercised* on recovery / no-passkey paths.
  > A "pure" symmetric 2-of-3 (passkey holds only one opaque share) was rejected:
  > it would force a second share — Google or the server — into **every**
  > signature, destroying Orbi's local passkey UX and adding a server-availability
  > dependency to normal use.
- **No migration / no re-keying.** We split the *existing* PRF seed, so Stellar
  and EVM addresses are unchanged. Existing wallets enroll transparently (§8).
- **Honest trust note:** because `A` is PRF-derived and the seed *is* the PRF
  output, **the passkey alone reconstructs the wallet** — identical to today's
  trust model. The passkey is a strong hardware-backed factor and remains the
  trust anchor; A+B only adds non-custodial *recovery* on top.

**Reconstruction paths (any 2-of-3):**

- **Everyday (passkey present):** PRF → seed directly. Local, instant, offline.
- **Blank / no-passkey device:** Google → server releases **Server share + `K_B`**
  → decrypt B from Drive → **B + Server** → seed.
- **Lost passkey:** **B + Server** (same as above) → recover, then enroll a new passkey.
- **Server permanently dead, passkey present:** PRF → seed directly (server not needed).
- **Server hacked:** attacker holds **1 share (+ `K_B`, but not B) → cannot move funds.**

> **Residual risk (documented):** permanent **server loss *and* lost passkey** =
> unrecoverable, because the no-passkey path needs the server for both the Server
> share and `K_B`. Mitigated by server HA + backups (§9.4). This is the deliberate
> price of keeping B useless to a Google-account breach.

---

## 3. What the server stores (and never sees)

The server is **blind to the master secret.** It stores one Shamir share,
encrypted, plus identity records needed to authenticate a release.

### Stores
- `server_share_ciphertext` — the server's Shamir **Server share**, envelope-encrypted.
- `K_B_ciphertext` — the random key that **encrypts the Cloud share B in the
  user's Drive**, envelope-encrypted. Released *together with* the Server share on
  the no-passkey path. The server never holds B itself.
- User identity: `user_id`, linked `passkey_credential_ids[]`, Google `sub`.
- Rate-limit / lockout counters and audit log.

### Never sees / never stores
- The master seed.
- Share A (PRF-derived on the client) or share **B** (lives only in the user's Drive).
  The server holds `K_B` but **not B**, so it can never decrypt B alone.
- The user's Google OAuth tokens beyond the moment of verification (verify, then discard).
- Any private key material in plaintext at rest.

**Envelope encryption (GCP KMS).** `KEK (in GCP KMS) → wraps → per-user DEK →
encrypts → {Server share, K_B}`. The KEK never leaves KMS. A DB dump alone is
useless without KMS; a KMS-or-server compromise yields only **1 Shamir share +
`K_B`** — and `K_B` is worthless without **B** (which is in the user's Drive), so
funds stay safe (non-custodial).

**Why B is encrypted with a server-held `K_B` (not a PIN).** A user PIN/passphrase
would be low-entropy and brute-forceable offline if B's ciphertext leaked in a
Google breach — the exact failure we rejected earlier. Keying B off a random
server-held `K_B` means: **Google breach → encrypted B + no `K_B` → useless**;
**server breach → `K_B` + Server share but no B → useless**. An attacker needs to
compromise **both** Google *and* the server, and there is no low-entropy secret to
grind.

---

## 4. Data model (Postgres)

```sql
-- One row per Orbi wallet identity.
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Wallet public identifiers (not secret) for display / linking.
  stellar_address TEXT,
  evm_address     TEXT,
  -- Google account binding (set when the user links Google sign-in).
  google_sub      TEXT UNIQUE,
  status          TEXT NOT NULL DEFAULT 'active'  -- active | locked | disabled
);

-- Passkeys that may authorize a server-share release (one user, many devices).
CREATE TABLE passkeys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id  BYTEA NOT NULL UNIQUE,
  public_key     BYTEA NOT NULL,     -- COSE key, for assertion verification
  sign_count     BIGINT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The server's Shamir share + the Cloud-share key K_B, envelope-encrypted.
-- Exactly one per user. K_B encrypts B (which lives only in the user's Drive).
CREATE TABLE server_shares (
  user_id        UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  dek_wrapped    BYTEA NOT NULL,     -- per-user DEK, wrapped by GCP KMS KEK
  share_cipher   BYTEA NOT NULL,     -- server Shamir share, encrypted with DEK
  share_nonce    BYTEA NOT NULL,
  kb_cipher      BYTEA NOT NULL,     -- K_B (encrypts Drive share B), encrypted with DEK
  kb_nonce       BYTEA NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only audit of every release attempt.
CREATE TABLE release_audit (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID REFERENCES users(id),
  method        TEXT NOT NULL,       -- 'passkey' | 'google'
  result        TEXT NOT NULL,       -- 'ok' | 'denied' | 'rate_limited' | 'locked'
  ip            INET,
  at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Rate-limit / lockout state** lives in **Redis** (Fly Redis / Upstash / Railway
Redis), keyed per user, with TTLs:

```
ratelimit:release:{user_id}   -> sliding counter, e.g. 5 / 10 min
lockout:{user_id}             -> set on N failures, exponential backoff
challenge:{nonce}             -> short-TTL (60s) login challenge, single-use
```

> If you'd rather not run Redis in v1, these can live in Postgres with a
> `SELECT ... FOR UPDATE` counter — fine at low volume. Redis is the clean upgrade.

---

## 5. Endpoints

All endpoints are called **from `keys.orbiwallet.xyz`** (the wallet origin), never
from a dApp. Responses that carry the server share return it **encrypted to an
ephemeral client public key** (see §6), so it's never in plaintext on the wire
beyond TLS.

### Enrollment (one-time, after wallet creation / first upgraded sign-in)
```
POST /v1/enroll
  body: { user_id, stellar_address, evm_address,
          passkey: { credential_id, public_key },
          server_share_cipher,   // server's Shamir share, sealed to server enrollment key
          kb_cipher }            // K_B (random), sealed to server enrollment key
  -> 201 { ok: true }
```
The **client** does everything secret-side locally: derive seed from PRF, Shamir
2-of-3 split → keep **A** (re-derived from PRF, nothing stored), generate random
**K_B**, encrypt **B** with K_B and **write B to the user's Drive**, then ship only
the **Server share** and **K_B** to be stored (each sealed to the server's
enrollment key). The server never sees A, B, the seed, or B's plaintext.

### Login challenge (anti-replay)
```
POST /v1/challenge
  body: { user_id?, google_id_token? }
  -> 200 { nonce, expires_in: 60 }
```

> **Note:** the everyday path needs **no endpoint** — a device with the passkey
> derives the seed from PRF locally. These releases are for recovery / no-passkey
> / server-assisted reconstruction only.

### Release via passkey (server-assisted, e.g. server-dead-only-on-Drive path)
```
POST /v1/release/passkey
  body: { user_id, assertion /* WebAuthn assertion over {nonce} */, client_ephemeral_pubkey }
  -> 200 { server_share_sealed, kb_sealed }   // both sealed to client_ephemeral_pubkey
  -> 429 rate_limited | 423 locked | 401 denied
```

### Release via Google (no-passkey / cross-platform path)
```
POST /v1/release/google
  body: { google_id_token, nonce, client_ephemeral_pubkey }
  -> 200 { server_share_sealed, kb_sealed }
  -> 429 | 423 | 401
```
Server verifies the Google **ID token** (issuer, audience = Orbi's OAuth client,
expiry, `sub` matches `users.google_sub`), checks rate-limit/lockout, then seals
**both the Server share and `K_B`** to the client's ephemeral key. Client fetches
encrypted **B** from Drive, decrypts it with `K_B`, then combines **B + Server →
seed**. Token is discarded after verification.

### Link Google to an existing wallet
```
POST /v1/link/google   (authorized by a passkey assertion)
  body: { user_id, google_id_token, assertion }
  -> 200 { ok: true }   // sets users.google_sub
```

### Rotate / re-enroll (after recovery, add new passkey)
```
POST /v1/passkey/add   (authorized by a successful reconstruction proof)
  body: { user_id, passkey: { credential_id, public_key } }
  -> 201 { ok: true }
```

---

## 6. Wire security for the share

The server share must not sit in plaintext anywhere but the client's memory at
reconstruction time.

- Client generates an **ephemeral X25519 keypair** per release request.
- Server **seals** (e.g. libsodium `crypto_box_seal` / HPKE) the **Server share
  and `K_B`** to that ephemeral public key. Only that client instance can open them.
- Client opens them, decrypts **B** (Drive) with `K_B`, runs Shamir combine
  (**B + Server**), derives keys, **signs**, then **zeroes** the seed, the shares,
  `K_B`, and the ephemeral private key.
- TLS underneath; sealing defends against logging/proxy/TLS-termination leakage.

---

## 6.5 Client execution model — where Shamir + Drive run

**All secret-side work runs on `keys.orbiwallet.xyz` (the WebAuthn RP origin).**
This is mandatory, not a preference:

- The passkey **PRF only resolves on this origin**, so the seed only ever exists
  here. Shamir split/combine operates on the plaintext seed → it must run here.
  Anywhere else would mean shipping the seed across an origin boundary.
- **Origin isolation holds:** dApps (account.orbiwallet.xyz + third parties) live
  on other origins and communicate only via postMessage. They never see the seed,
  the shares, `K_B`, or the Drive token.
- **The server must not do Drive I/O.** The server holds `K_B`; if it also fetched
  **B**, it would have `K_B` + B → it could reconstruct → **custodial**. So **B's
  read/write is always client-side.** Non-negotiable for non-custody.

**The cost — and how we bound it.** Putting Drive I/O on the keys origin enlarges
the trusted computing base of the one origin that must never leak a seed. The risk
is **supply-chain on the seed origin**. Mitigations (Phase 1):

1. **No Google hosted JS in the keys origin.** OAuth via popup/redirect; the lean
   **server does the code exchange** (it already verifies the Google ID token).
   The browser then calls the **Drive REST API directly with `fetch`** — no
   third-party script enters the seed origin.
2. **Strict CSP, pinned + minimal deps, SRI**; the keys-origin bundle is treated as
   security-critical and reviewed.
3. **(9.4 hardening, not v1)** isolate Drive in a **sandboxed companion origin /
   iframe** that holds the Drive token and the *encrypted* B, and postMessages the
   **`K_B`-encrypted B ciphertext** to the keys origin. The keys origin then only
   ever sees ciphertext + holds `K_B`/the seed — Google JS and the Drive token live
   outside the seed origin entirely.

---

## 7. Rate-limiting & lockout (the reason the server exists)

A login factor (Google, or a future PIN) is only safe because the server gates it.
**Phase 1 defaults:**

- **Sliding window:** **5 release attempts / 10 min / user.**
- **Exponential backoff lockout** on consecutive failures: **1m → 5m → 30m → 24h.**
- **Per-IP** secondary limit to blunt distributed guessing.
- **Audit every attempt** (`release_audit`) and alert on anomalies.
- **Notify the user** (email/push, later) on every successful release from a new device.

Because the server holds only 1 share, even a *total* server breach leaks one
share — funds stay safe. Rate-limiting protects the **availability/abuse** surface,
not custody.

---

## 8. Migration for existing wallets

Today's wallets derive the seed from PRF and store nothing. Because A+B **splits
that same PRF seed**, enrollment changes **no keys and no addresses** — it only
generates and persists shares:

1. On next sign-in (passkey present), derive the seed from PRF as usual.
2. Client Shamir-splits it 2-of-3: **A** = `HKDF(prf, 'orbi-share-a')` (re-derivable,
   nothing stored), **B** + **Server** generated; encrypt B with a fresh random
   **K_B** and write it to the user's Drive.
3. Call `/v1/enroll` with the Server share + K_B.
4. From then on the seed is recoverable via **B + Server** when the passkey is gone;
   the everyday PRF path is untouched.

This is **opt-in and transparent** — it happens during a normal authenticated
session, with addresses unchanged, so no separate "back up your wallet" friction
beyond a one-time Google link prompt.

---

## 9. Build phases

- **9.1 — Core split + server share + passkey release (testnet).**
  Shamir lib (audited, e.g. `shamir-secret-sharing` audited build), enroll +
  release-via-passkey, envelope encryption with a KMS, Postgres schema, sealing.
- **9.2 — Cloud share (B) + Google sign-in.**
  Google OAuth client, Drive `appDataFolder` read/write for B, `/release/google`,
  `/link/google`, rate-limiting in Redis.
- **9.3 — Recovery & re-enroll flows.**
  Lost-passkey path, add-new-passkey, new-device notifications, audit surfacing.
- **9.4 — Harden before real funds.**
  External security review, KMS hardening (move KEK fully into managed KMS/HSM),
  backup/restore drills, lockout tuning, abuse monitoring.

---

## 10. Host — Railway (Phase 1)

**Decision: Railway** — fewest moving parts for v1.

| Concern | Railway setup |
|---|---|
| Service | Node service deployed from repo (real Node — full WebAuthn/crypto libs) |
| DB | Railway managed **Postgres** (single-region; fine for v1) |
| Cache / rate-limit | Railway **Redis** |
| KMS | **GCP KMS** (external — KEK lives in KMS, never in Railway) |
| Secrets | Railway variables for Google OAuth client secret + GCP service-account creds |
| Region | single region near primary users |

Railway's managed Postgres is single-region; that's acceptable because share
release isn't latency-sensitive and consistency matters more than a few ms.
**The host is not the security boundary** — the server holds only 1 Shamir share +
`K_B` (never B), so a full Railway compromise still can't move funds. If multi-region
ever becomes a real need, the service is a stateless Node app + a Postgres dump and
moves to Fly/Cloudflare **without any change to this security model.**

---

## 11. Crypto choices (Phase 1 defaults)

- **Secret sharing:** Shamir 2-of-3 over GF(256), audited library — **no hand-rolled SSS.**
- **Share A derivation:** `A = HKDF(prf_output, salt='orbi-share-a')` — re-derived,
  never stored.
- **Cloud share B at rest:** AES-256-GCM with random `K_B` (server-held,
  envelope-encrypted); B's ciphertext lives in the user's Drive `appDataFolder`.
- **Share sealing (wire):** X25519 + XSalsa20-Poly1305 (`crypto_box_seal`) or HPKE.
- **Envelope encryption at rest:** AES-256-GCM DEK, KEK in **GCP KMS**.
- **Passkey assertion:** standard WebAuthn verification (`@simplewebauthn/server` or equiv).
- **Google token:** verify ID token signature/iss/aud/exp server-side; never trust client claims.
- **Master seed:** the PRF output itself; chain keys derived unchanged (PRF→HKDF)
  for Stellar Ed25519 + EVM secp256k1. A+B only **splits/restores the seed**, it
  does not change key derivation — so addresses are identical to today.
```

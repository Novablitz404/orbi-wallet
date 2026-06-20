// Client-side recovery (A+B) — runs ONLY on the keys (RP) origin, where the PRF
// seed legitimately exists. See docs/recovery-server-spec.md.
//
// Model: the master seed (the raw PRF output, which derives BOTH the Stellar and
// EVM keys) is split with an audited Shamir library into a Server share and a
// Cloud share (B). The passkey itself reconstructs the seed directly from PRF —
// that is the everyday "share A" path and never needs this module. So the
// persisted recovery is a Server + B split (2-of-2), which is equivalent in
// resilience to the 2-of-3 {A,B,Server} framing (A is gone whenever the passkey
// is). A third independent recovery factor can be added later by raising the
// split to 3 shares.
//
// B is encrypted at rest in the user's Drive with a random K_B; the recovery
// server holds K_B (envelope-encrypted) and releases it WITH the Server share
// after a verified, rate-limited login. A Google-account breach therefore yields
// only an opaque ciphertext.
import { split, combine } from 'shamir-secret-sharing';
import _sodium from 'libsodium-wrappers';
import { startAuthentication } from '@simplewebauthn/browser';
import { addressesFromPrfOutput } from './prf-wallet';
import { requestGoogleIdToken, requestDriveAccessToken } from './google-oauth';
import { writeAppData, readAppData } from './drive';

// One wallet per Google account (for now): a fixed appDataFolder filename for B.
const SHARE_B_FILE = 'orbi-recovery-share.json';

const RECOVERY_SERVER_URL =
  process.env.NEXT_PUBLIC_RECOVERY_SERVER_URL ?? 'http://localhost:8080';

function getRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID ??
    (typeof window !== 'undefined' ? window.location.hostname : 'keys.orbiwallet.xyz');
}

// ── libsodium (sealed boxes, to open the server's release) ───────────────────
let sodiumReady: Promise<typeof _sodium> | null = null;
async function sodium() {
  if (!sodiumReady) sodiumReady = _sodium.ready.then(() => _sodium);
  return sodiumReady;
}

// ── small encoders ───────────────────────────────────────────────────────────
function toB64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}
function fromB64(b64: string): Uint8Array {
  return new Uint8Array([...atob(b64)].map((c) => c.charCodeAt(0)));
}

// ── AES-256-GCM for encrypting share B at rest (WebCrypto) ───────────────────
interface EncryptedBlob {
  iv: string;   // base64
  ct: string;   // base64 (ciphertext||tag)
}
async function aesGcmEncrypt(key: Uint8Array, data: Uint8Array): Promise<EncryptedBlob> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, data as BufferSource));
  return { iv: toB64(iv), ct: toB64(ct) };
}
async function aesGcmDecrypt(key: Uint8Array, blob: EncryptedBlob): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, ['decrypt']);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) as BufferSource },
    k,
    fromB64(blob.ct) as BufferSource,
  );
  return new Uint8Array(pt);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface EnrollResult {
  userId: string;
  /** Encrypted share B — the caller persists this to the user's Drive (9.2).
   *  In 9.1 it is returned so a test harness can hold it. */
  encryptedB: EncryptedBlob;
}

/**
 * Split the master seed, store the Server share + K_B on the recovery server,
 * and return the encrypted Cloud share B for Drive storage.
 */
export async function enrollRecovery(opts: {
  prfOutput: Uint8Array;   // master seed (NOT zeroed by caller until this returns)
  credentialId: string;    // base64url
  publicKey: string;       // base64url COSE key
  stellarAddress: string;
  evmAddress: string;
  userId?: string;
}): Promise<EnrollResult> {
  // 2-of-2 split: [serverShare, cloudB]. (Passkey = the PRF-direct "share A".)
  const shares = await split(opts.prfOutput, 2, 2);
  const serverShare = shares[0]!;
  const cloudB = shares[1]!;

  // K_B encrypts B at rest in the user's Drive.
  const kbKey = crypto.getRandomValues(new Uint8Array(32));
  const encryptedB = await aesGcmEncrypt(kbKey, cloudB);

  try {
    const res = await fetch(`${RECOVERY_SERVER_URL}/v1/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: opts.userId,
        stellar_address: opts.stellarAddress,
        evm_address: opts.evmAddress,
        passkey: { credential_id: opts.credentialId, public_key: opts.publicKey },
        server_share: toB64(serverShare),
        kb_key: toB64(kbKey),
      }),
    });
    if (!res.ok) throw new Error(`enroll failed: ${res.status}`);
    const { user_id } = (await res.json()) as { user_id: string };
    return { userId: user_id, encryptedB };
  } finally {
    serverShare.fill(0);
    cloudB.fill(0);
    kbKey.fill(0);
  }
}

/**
 * Reconstruct the master seed via the recovery server using a passkey assertion.
 * Returns the recovered PRF output; caller verifies + zeroes it.
 *
 * (In production the passkey path can reconstruct from PRF directly; this routes
 * through the server to exercise the full release machinery — and is the shape
 * the Google no-passkey path will reuse in 9.2.)
 */
export async function reconstructViaPasskey(opts: {
  userId: string;
  credentialId: string;     // base64url
  encryptedB: EncryptedBlob;
}): Promise<Uint8Array> {
  // 1. Get a single-use challenge.
  const chRes = await fetch(`${RECOVERY_SERVER_URL}/v1/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: opts.userId }),
  });
  if (!chRes.ok) throw new Error(`challenge failed: ${chRes.status}`);
  const { nonce } = (await chRes.json()) as { nonce: string };

  // 2. Passkey assertion over the challenge.
  const assertion = await startAuthentication({
    optionsJSON: {
      challenge: nonce, // base64url
      rpId: getRpId(),
      allowCredentials: [{ id: opts.credentialId, type: 'public-key' }],
      userVerification: 'required',
    },
  });

  // 3. Ephemeral X25519 keypair; the server seals the release to its public key.
  const s = await sodium();
  const eph = s.crypto_box_keypair();

  try {
    const relRes = await fetch(`${RECOVERY_SERVER_URL}/v1/release/passkey`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user_id: opts.userId,
        assertion,
        client_ephemeral_pubkey: toB64(eph.publicKey),
      }),
    });
    if (!relRes.ok) throw new Error(`release failed: ${relRes.status}`);
    const { server_share_sealed, kb_sealed } = (await relRes.json()) as {
      server_share_sealed: string;
      kb_sealed: string;
    };

    // 4. Open the sealed boxes.
    const serverShare = s.crypto_box_seal_open(fromB64(server_share_sealed), eph.publicKey, eph.privateKey);
    const kbKey = s.crypto_box_seal_open(fromB64(kb_sealed), eph.publicKey, eph.privateKey);

    // 5. Decrypt B, combine B + Server -> seed.
    const cloudB = await aesGcmDecrypt(kbKey, opts.encryptedB);
    try {
      return await combine([serverShare, cloudB]);
    } finally {
      serverShare.fill(0);
      kbKey.fill(0);
      cloudB.fill(0);
    }
  } finally {
    eph.privateKey.fill(0);
  }
}

/** Confirm a reconstructed seed yields the wallet's known addresses. */
export async function verifyRecovered(
  prfOutput: Uint8Array,
  expected: { gAddress: string; evmAddress: string },
): Promise<boolean> {
  const got = await addressesFromPrfOutput(prfOutput);
  return (
    got.gAddress === expected.gAddress &&
    got.evmAddress.toLowerCase() === expected.evmAddress.toLowerCase()
  );
}

// ── 9.2: Google sign-in + Drive share B ──────────────────────────────────────

// Single-use challenge + passkey assertion (shared by link + passkey paths).
async function passkeyAssertion(userId: string, credentialId: string) {
  const chRes = await fetch(`${RECOVERY_SERVER_URL}/v1/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!chRes.ok) throw new Error(`challenge failed: ${chRes.status}`);
  const { nonce } = (await chRes.json()) as { nonce: string };
  return startAuthentication({
    optionsJSON: {
      challenge: nonce,
      rpId: getRpId(),
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
    },
  });
}

/**
 * Link a Google account to the wallet (passkey-authorized) and back up the
 * encrypted Cloud share B to the user's Drive. Enables the no-passkey path.
 */
export async function linkGoogleAndBackup(opts: {
  userId: string;
  credentialId: string;
  encryptedB: EncryptedBlob;
}): Promise<void> {
  // 1. Identity token (no API scope) + passkey assertion authorize the link.
  const idToken = await requestGoogleIdToken();
  const assertion = await passkeyAssertion(opts.userId, opts.credentialId);
  const linkRes = await fetch(`${RECOVERY_SERVER_URL}/v1/link/google`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ user_id: opts.userId, assertion, google_id_token: idToken }),
  });
  if (!linkRes.ok) throw new Error(`link/google failed: ${linkRes.status}`);

  // 2. Drive token stays in the browser; write encrypted B to appDataFolder.
  const driveToken = await requestDriveAccessToken();
  await writeAppData(driveToken, SHARE_B_FILE, JSON.stringify(opts.encryptedB));
}

/**
 * Reconstruct the seed with NO passkey: Google sign-in releases the Server share
 * + K_B; the browser-held Drive token fetches B. Returns the recovered PRF output.
 */
export async function reconstructViaGoogle(): Promise<Uint8Array> {
  // 1. Drive token (browser-only) → fetch encrypted B.
  const driveToken = await requestDriveAccessToken();
  const raw = await readAppData(driveToken, SHARE_B_FILE);
  if (!raw) throw new Error('no Drive backup found for this Google account');
  const encryptedB = JSON.parse(raw) as EncryptedBlob;

  // 2. ID token → server release (server maps google_sub → wallet).
  const idToken = await requestGoogleIdToken();
  const s = await sodium();
  const eph = s.crypto_box_keypair();
  try {
    const relRes = await fetch(`${RECOVERY_SERVER_URL}/v1/release/google`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ google_id_token: idToken, client_ephemeral_pubkey: toB64(eph.publicKey) }),
    });
    if (!relRes.ok) throw new Error(`release/google failed: ${relRes.status}`);
    const { server_share_sealed, kb_sealed } = (await relRes.json()) as {
      server_share_sealed: string;
      kb_sealed: string;
    };

    const serverShare = s.crypto_box_seal_open(fromB64(server_share_sealed), eph.publicKey, eph.privateKey);
    const kbKey = s.crypto_box_seal_open(fromB64(kb_sealed), eph.publicKey, eph.privateKey);
    const cloudB = await aesGcmDecrypt(kbKey, encryptedB);
    try {
      return await combine([serverShare, cloudB]);
    } finally {
      serverShare.fill(0);
      kbKey.fill(0);
      cloudB.fill(0);
    }
  } finally {
    eph.privateKey.fill(0);
  }
}

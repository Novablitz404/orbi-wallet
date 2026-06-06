import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

export interface PasskeyCredential {
  credentialId: string;   // base64url — stored in localStorage
  passkeyId: string;      // hex, 20 bytes = sha256(credentialId).slice(0,20) — stored in contract
  publicKey: string;      // hex, 65 bytes uncompressed secp256r1 — stored in contract
}

export interface PasskeyAssertion {
  credentialId: string;
  signature: string;           // hex, raw r||s 64 bytes
  authenticatorData: string;   // hex
  clientDataJSON: string;      // base64url
}

/**
 * Create a new passkey (passkey / Touch ID / hardware key).
 * Returns the credential ID and public key needed to deploy the smart wallet.
 */
export async function createPasskey(
  username: string,
  displayName: string,
): Promise<PasskeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const reg = await startRegistration({
    optionsJSON: {
      challenge: bufferToBase64url(challenge),
      rp: { name: 'Orbi Wallet', id: process.env.NEXT_PUBLIC_PASSKEY_RP_ID ?? window.location.hostname },
      user: {
        id: bufferToBase64url(new TextEncoder().encode(username)),
        name: username,
        displayName,
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }], // ES256 = secp256r1
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required',
      },
      timeout: 60000,
    },
  });

  const credentialId = reg.id;
  const passkeyId = await derivePasskeyId(credentialId);
  const publicKey = await extractPublicKey(reg.response.publicKey ?? '');

  return { credentialId, passkeyId, publicKey };
}

/**
 * Authenticate with an existing passkey (sign-in flow).
 */
export async function authenticatePasskey(credentialId?: string): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const assertion = await startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64url(challenge),
      rpId: process.env.NEXT_PUBLIC_PASSKEY_RP_ID ?? window.location.hostname,
      allowCredentials: credentialId
        ? [{ id: credentialId, type: 'public-key' }]
        : [],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  return assertion.id;
}

/**
 * Sign a 32-byte challenge (the Soroban auth hash) with the passkey.
 * Returns the WebAuthn assertion needed by the smart wallet contract.
 */
export async function signWithPasskey(
  credentialId: string,
  challenge: Uint8Array,
): Promise<PasskeyAssertion> {
  const assertion = await startAuthentication({
    optionsJSON: {
      challenge: bufferToBase64url(challenge),
      rpId: process.env.NEXT_PUBLIC_PASSKEY_RP_ID ?? window.location.hostname,
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60000,
    },
  });

  const sigBytes = base64urlToBuffer(assertion.response.signature);
  const rawSig = derToRaw64(sigBytes);

  return {
    credentialId: assertion.id,
    signature: bufferToHex(rawSig),
    authenticatorData: bufferToHex(base64urlToBuffer(assertion.response.authenticatorData)),
    clientDataJSON: assertion.response.clientDataJSON,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export async function derivePasskeyId(credentialId: string): Promise<string> {
  const bytes = base64urlToBuffer(credentialId);
  const hash = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return bufferToHex(new Uint8Array(hash).slice(0, 20));
}

async function extractPublicKey(publicKeyBase64: string): Promise<string> {
  if (!publicKeyBase64) throw new Error('No public key in credential response');

  // publicKey is DER-encoded SubjectPublicKeyInfo for ES256
  const der = base64urlToBuffer(publicKeyBase64);

  // Import as CryptoKey then export as raw (65-byte uncompressed point)
  const key = await crypto.subtle.importKey(
    'spki',
    der.buffer as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['verify'],
  );
  const raw = await crypto.subtle.exportKey('raw', key);
  return bufferToHex(new Uint8Array(raw));
}

// secp256r1 group order N — used for low-S normalization.
// Soroban's secp256r1_verify rejects high-S signatures (ECDSA malleability protection).
// WebAuthn assertions whose S > N/2 must be flipped: s' = N - s.
const SECP256R1_N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const SECP256R1_N_HALF = SECP256R1_N >> 1n;

function bytesToBigInt(b: Uint8Array): bigint {
  return BigInt('0x' + Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('') || '0');
}

function bigIntTo32Bytes(n: bigint): Uint8Array {
  let hex = n.toString(16);
  if (hex.length < 64) hex = '0'.repeat(64 - hex.length) + hex;
  return new Uint8Array(hex.match(/.{2}/g)!.map(b => parseInt(b, 16)));
}

/**
 * Convert DER-encoded ECDSA signature to raw 64-byte r||s.
 * Normalizes S to low half of the curve order — required by Soroban's secp256r1_verify.
 * Ported directly from orbi_wallet's derToRaw64.
 */
function derToRaw64(der: Uint8Array): Uint8Array {
  let offset = 2; // skip SEQUENCE tag + length
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for r');
  offset++;
  const rLen = der[offset++];
  const r = der.slice(offset, offset + rLen).slice(-32);
  offset += rLen;
  if (der[offset] !== 0x02) throw new Error('Invalid DER: expected 0x02 for s');
  offset++;
  const sLen = der[offset++];
  const s = der.slice(offset, offset + sLen).slice(-32);

  // Low-S normalization
  const sBig = bytesToBigInt(s);
  const sNorm = sBig > SECP256R1_N_HALF ? bigIntTo32Bytes(SECP256R1_N - sBig) : s;

  const raw = new Uint8Array(64);
  raw.set(r, 32 - r.length);
  raw.set(sNorm, 32 + (32 - sNorm.length));
  return raw;
}

export function bufferToBase64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64urlToBuffer(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

export function bufferToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

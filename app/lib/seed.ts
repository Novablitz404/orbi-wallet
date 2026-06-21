// Master-seed resolution — the single place that turns "the wallet on this
// device" into its master PRF output (the seed that derives all chain keys).
//
// Two device types:
//  - Original device: the passkey PRF *is* the seed. Assertion → prf_output.
//  - Adopted device (recovered via Google with no original passkey): a NEW local
//    passkey was registered whose PRF *wraps* the original seed. Assertion with
//    that passkey → unwrap the stored blob → the original seed. Same address.
//
// All signing / address derivation goes through resolveMasterPrf so both device
// types behave identically. Self-contained (imports only storage) to avoid import
// cycles with prf-wallet.
import { loadWallet } from './storage';

const PRF_SALT = new TextEncoder().encode('orbi-stellar-v1'); // must match prf-wallet
const WRAP_SALT = new TextEncoder().encode('orbi-wrap-hkdf-v1');

function getRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID ??
    (typeof window !== 'undefined' ? window.location.hostname : 'keys.orbiwallet.xyz');
}

function fromBase64url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  return new Uint8Array([...atob(padded)].map((c) => c.charCodeAt(0)));
}
function toBase64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}
function toB64(buf: Uint8Array): string { return btoa(String.fromCharCode(...buf)); }
function fromB64(b64: string): Uint8Array { return new Uint8Array([...atob(b64)].map((c) => c.charCodeAt(0))); }

// Raw passkey assertion → PRF output (+ the credential id used).
async function assertPrf(credentialId?: string): Promise<{ prfOutput: Uint8Array; credentialId: string }> {
  const credIdBytes = credentialId ? fromBase64url(credentialId) : undefined;
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: getRpId(),
      allowCredentials: credIdBytes
        ? [{ id: credIdBytes.buffer.slice(credIdBytes.byteOffset, credIdBytes.byteOffset + credIdBytes.byteLength) as ArrayBuffer, type: 'public-key' as const }]
        : [],
      userVerification: 'required',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (assertion.getClientExtensionResults() as any).prf;
  if (!prf?.results?.first) throw new Error('PRF not available on this device/browser');
  return {
    prfOutput: new Uint8Array(prf.results.first as ArrayBuffer),
    credentialId: toBase64url(new Uint8Array(assertion.rawId)),
  };
}

// HKDF a passkey PRF output into a 256-bit AES wrapping key.
async function deriveWrapKey(prf: Uint8Array): Promise<CryptoKey> {
  const ikm = await crypto.subtle.importKey('raw', prf.buffer.slice(prf.byteOffset, prf.byteOffset + prf.byteLength) as ArrayBuffer, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: WRAP_SALT, info: new Uint8Array() }, ikm, 256);
  return crypto.subtle.importKey('raw', bits, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * Wrap the original recovered seed with THIS device's new passkey PRF.
 * Returns a base64 blob (iv ‖ ciphertext) to store as wallet.adopted.wrappedSeed.
 */
export async function wrapSeedForDevice(originalPrf: Uint8Array, newPrf: Uint8Array): Promise<string> {
  const key = await deriveWrapKey(newPrf);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, originalPrf as BufferSource));
  return toB64(new Uint8Array([...iv, ...ct]));
}

async function unwrapSeed(newPrf: Uint8Array, blob: string): Promise<Uint8Array> {
  const key = await deriveWrapKey(newPrf);
  const raw = fromB64(blob);
  const iv = raw.subarray(0, 12);
  const ct = raw.subarray(12);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return new Uint8Array(pt);
}

/**
 * Resolve the wallet's master PRF output on this device. Caller MUST zero the
 * returned buffer after deriving keys.
 */
export async function resolveMasterPrf(credentialId?: string): Promise<{ prfOutput: Uint8Array; credentialId: string }> {
  const wallet = loadWallet();
  const { prfOutput, credentialId: credId } = await assertPrf(credentialId);
  if (wallet?.adopted?.wrappedSeed) {
    try {
      const original = await unwrapSeed(prfOutput, wallet.adopted.wrappedSeed);
      return { prfOutput: original, credentialId: credId };
    } finally {
      prfOutput.fill(0);
    }
  }
  return { prfOutput, credentialId: credId };
}

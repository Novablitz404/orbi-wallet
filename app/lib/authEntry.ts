/**
 * Builds and signs Soroban SorobanAuthorizationEntry objects using a passkey.
 * Ported from orbi_wallet's smartWallet.ts — the working implementation.
 *
 * The signature format matches OrbiSmartWallet.__check_auth exactly:
 *   Signatures(Map<SignerKey::Secp256r1(credentialId), Signature::Secp256r1(WebAuthnSig)>)
 */

import {
  xdr,
  Address,
  Networks,
  hash,
} from '@stellar/stellar-sdk';
import { signWithPasskey, base64urlToBuffer, bufferToHex, bufferToBase64url } from './passkey';

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === 'mainnet'
    ? Networks.PUBLIC
    : Networks.TESTNET;

// ── Auth hash computation ─────────────────────────────────────────────────────

/**
 * Compute the 32-byte Soroban auth hash that the passkey must sign as the challenge.
 * SHA-256(HashIdPreimage.envelopeTypeSorobanAuthorization(...))
 *
 * Uses stellar-sdk's synchronous hash() (sha.js) — matching PasskeyKit. The
 * previous crypto.subtle approach hashed `data.buffer`, which for a Buffer that
 * is a view into a pooled ArrayBuffer includes trailing bytes → wrong hash →
 * __check_auth ClientDataJsonChallengeIncorrect (Error #6).
 */
export function computeAuthHash(
  entry: xdr.SorobanAuthorizationEntry,
): Uint8Array {
  const networkId = hash(Buffer.from(NETWORK_PASSPHRASE));
  const creds = entry.credentials().address();

  const preimage = xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId,
      nonce: creds.nonce(),
      signatureExpirationLedger: creds.signatureExpirationLedger(),
      invocation: entry.rootInvocation(),
    }),
  );

  return hash(preimage.toXDR());
}

// ── Signature ScVal builder ───────────────────────────────────────────────────

/**
 * Build the Signatures ScVal in the exact format expected by __check_auth.
 * Ported directly from orbi_wallet's buildSecp256r1SignatureScVal.
 *
 * Format:
 *   scvVec([
 *     scvMap([
 *       { key: SignerKey::Secp256r1(credentialId), val: Signature::Secp256r1(WebAuthnSig) }
 *     ])
 *   ])
 */
function buildSignaturesScVal(
  credentialId: Uint8Array,
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  rawSig64: Uint8Array,
): xdr.ScVal {
  const webAuthnSig = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('authenticator_data'),
      val: xdr.ScVal.scvBytes(Buffer.from(authenticatorData)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('client_data_json'),
      val: xdr.ScVal.scvBytes(Buffer.from(clientDataJSON)),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('signature'),
      val: xdr.ScVal.scvBytes(Buffer.from(rawSig64)),
    }),
  ]);

  // Signature::Secp256r1(WebAuthnSig) — enum variant as Vec[symbol, inner]
  const signatureVariant = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    webAuthnSig,
  ]);

  // SignerKey::Secp256r1(credentialId) — enum variant as Vec[symbol, inner]
  const signerKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Secp256r1'),
    xdr.ScVal.scvBytes(Buffer.from(credentialId)),
  ]);

  // Signatures(Map<SignerKey, Signature>) — single-field tuple struct → scvVec([inner])
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: signerKey, val: signatureVariant }),
    ]),
  ]);
}

// ── Main: sign an auth entry with passkey ─────────────────────────────────────

export interface SignedAuthEntry {
  authEntryXdr: string; // base64 — ready to POST to relay
  argsXdr: string[];    // base64
}

/**
 * Sign a SorobanAuthorizationEntry with the user's passkey.
 * The Soroban auth hash is used as the WebAuthn challenge (base64url encoded).
 *
 * This is the client-side equivalent of orbi_wallet's signTransfer().
 */
export async function signAuthEntryWithPasskey(params: {
  entry: xdr.SorobanAuthorizationEntry;
  args: xdr.ScVal[];
  credentialId: string;
  passkeyId: string;
  currentLedger: number;
}): Promise<SignedAuthEntry> {
  const { entry, args, credentialId, passkeyId, currentLedger } = params;

  // Set expiration to current ledger + 1000 (~83 minutes)
  entry.credentials().address().signatureExpirationLedger(currentLedger + 1000);

  const authHash = computeAuthHash(entry);

  // Passkey signs the auth hash as the WebAuthn challenge.
  // credentialId selects which platform credential to use (allowCredentials).
  const assertion = await signWithPasskey(credentialId, authHash);

  // The Signatures map MUST be keyed by passkeyId (sha256(credentialId)[:20]) —
  // that's what __constructor stored as the signer key. Using the raw
  // credentialId here causes __check_auth → NotFound (Error #1).
  const signerKeyBytes = hexToBuffer(passkeyId);
  const authenticatorDataBytes = hexToBuffer(assertion.authenticatorData);
  const clientDataJSONBytes = base64urlToBuffer(assertion.clientDataJSON);
  const rawSig = hexToBuffer(assertion.signature);

  const sigScVal = buildSignaturesScVal(
    signerKeyBytes,
    authenticatorDataBytes,
    clientDataJSONBytes,
    rawSig,
  );

  // Attach signature to auth entry
  entry.credentials().address().signature(sigScVal);

  return {
    authEntryXdr: Buffer.from(entry.toXDR()).toString('base64'),
    argsXdr: args.map(a => Buffer.from(a.toXDR()).toString('base64')),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

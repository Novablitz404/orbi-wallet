import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-base';
import { decode as cborDecode, Decoder, Encoder } from 'cbor-x';
import { deriveEvmAddressFromPrf } from './evm-wallet';

// Salt used for PRF evaluation — must never change (changing it changes the derived G address).
const PRF_SALT = new TextEncoder().encode('orbi-stellar-v1');
// Salt used for HKDF — separates the PRF output domain from the raw ikm.
const HKDF_SALT = new TextEncoder().encode('orbi-stellar-hkdf-v1');

function getRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID ??
    (typeof window !== 'undefined' ? window.location.hostname : 'keys.orbiwallet.xyz');
}

async function hkdfDerive(ikm: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm.buffer.slice(ikm.byteOffset, ikm.byteOffset + ikm.byteLength) as ArrayBuffer, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new Uint8Array() },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function toBase64url(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function fromBase64url(b64: string): Uint8Array {
  const padded = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

export interface PRFWalletCredential {
  credentialId: string; // base64url
  publicKey: string;    // base64url COSE public key (for server-side assertion verification / recovery)
  gAddress: string;     // G... Stellar address
  evmAddress: string;   // 0x… BotChain/EVM address (same passkey, secp256k1)
}

// Pull the COSE public key out of a registration attestationObject so the
// recovery server can verify future assertions. Decodes the first CBOR item
// after the credential id (re-encoding drops any trailing authenticator
// extension data, e.g. hmac-secret used by PRF).
function extractCosePublicKey(attestationObject: ArrayBuffer): Uint8Array {
  const att = cborDecode(new Uint8Array(attestationObject)) as { authData: Uint8Array };
  const authData = att.authData;
  const dv = new DataView(authData.buffer, authData.byteOffset, authData.byteLength);
  // rpIdHash(32) + flags(1) + signCount(4) + aaguid(16) = 53, then credIdLen(2).
  const credIdLen = dv.getUint16(53, false);
  const coseStart = 55 + credIdLen;
  const coseAndMaybeExt = authData.subarray(coseStart);
  // Decode the COSE map preserving its INTEGER keys (mapsAsObjects would turn
  // them into text keys, producing invalid COSE), then re-encode the Map to drop
  // any trailing authenticator extension data.
  const cose = new Decoder({ mapsAsObjects: false }).decode(coseAndMaybeExt);
  return new Uint8Array(new Encoder().encode(cose));
}

/**
 * Derive the public Stellar + EVM addresses from a raw PRF output. Used to
 * verify a reconstructed wallet (recovery) matches the expected addresses.
 */
export async function addressesFromPrfOutput(prfOutput: Uint8Array): Promise<{ gAddress: string; evmAddress: string }> {
  const seed = await hkdfDerive(prfOutput);
  const gAddress = Keypair.fromRawEd25519Seed(Buffer.from(seed)).publicKey();
  const evmAddress = await deriveEvmAddressFromPrf(prfOutput);
  seed.fill(0);
  return { gAddress, evmAddress };
}

// Result of creating a PRF credential, INCLUDING the raw PRF output. The PRF
// output is the master seed (it derives both chains); callers that don't need it
// — like registerPRFWallet — must zero it. Recovery enrollment needs it to split.
export interface PRFCredentialWithSeed extends PRFWalletCredential {
  prfOutput: Uint8Array;
}

/**
 * Register a new PRF-based wallet and return the credential plus the raw PRF
 * output (the master seed). Caller owns zeroing `prfOutput`.
 */
export async function createPRFCredential(): Promise<PRFCredentialWithSeed> {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Orbi Wallet', id: getRpId() },
      user: {
        // Random per-credential handle — must be unique, or platforms with
        // discoverable credentials (iCloud Keychain, etc.) will overwrite an
        // existing passkey instead of creating a new one.
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: 'Orbi Wallet',
        displayName: 'Orbi Wallet',
      },
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'preferred',
      },
      // hint the browser toward phone (hybrid) first, then on-device — this
      // surfaces the QR-code option on desktops that have no fingerprint reader
      // instead of defaulting to a USB security key prompt.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...({ hints: ['hybrid', 'client-device'] } as any),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (credential.getClientExtensionResults() as any).prf;
  if (!prf?.results?.first) {
    throw new Error(
      'Passkey created but PRF is not supported on this authenticator. On desktop, try scanning the QR code with your phone (Chrome on Android or Safari on iPhone).',
    );
  }

  const prfOutput = new Uint8Array(prf.results.first as ArrayBuffer);
  const seed = await hkdfDerive(prfOutput);

  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));
  const gAddress = keypair.publicKey();

  // Same passkey also yields the EVM address (secp256k1) from this one PRF
  // output, so picking BotChain at creation doesn't need a second tap.
  const evmAddress = await deriveEvmAddressFromPrf(prfOutput);

  const publicKey = toBase64url(
    extractCosePublicKey((credential.response as AuthenticatorAttestationResponse).attestationObject),
  );

  seed.fill(0);

  // NOTE: prfOutput is NOT zeroed here — it's the master seed the caller needs
  // (e.g. recovery enrollment). registerPRFWallet zeroes it.
  return {
    credentialId: toBase64url(new Uint8Array(credential.rawId)),
    publicKey,
    gAddress,
    evmAddress,
    prfOutput,
  };
}

/**
 * Register a new PRF-based wallet (public surface). Zeroes the PRF output.
 */
export async function registerPRFWallet(): Promise<PRFWalletCredential> {
  const { prfOutput, ...cred } = await createPRFCredential();
  prfOutput.fill(0);
  return cred;
}

/**
 * Sign in with PRF — derives the G address from the passkey.
 * Returns the G address. Caller should verify the address matches the stored wallet.
 */
export async function signInWithPRF(credentialId?: string): Promise<{ gAddress: string; evmAddress: string; credentialId: string }> {
  const credIdBytes = credentialId ? fromBase64url(credentialId) : undefined;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: getRpId(),
      allowCredentials: credIdBytes ? [{ id: credIdBytes.buffer.slice(credIdBytes.byteOffset, credIdBytes.byteOffset + credIdBytes.byteLength) as ArrayBuffer, type: 'public-key' as const }] : [],
      userVerification: 'required',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (assertion.getClientExtensionResults() as any).prf;
  if (!prf?.results?.first) {
    throw new Error('PRF not available on this device/browser');
  }

  const prfOutput = new Uint8Array(prf.results.first as ArrayBuffer);
  const seed = await hkdfDerive(prfOutput);

  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));
  const gAddress = keypair.publicKey();

  const evmAddress = await deriveEvmAddressFromPrf(prfOutput);

  seed.fill(0);
  prfOutput.fill(0);

  return {
    gAddress,
    evmAddress,
    credentialId: toBase64url(new Uint8Array(assertion.rawId)),
  };
}

/**
 * Sign a Stellar transaction XDR with PRF-derived Ed25519 key.
 * Verifies the derived address matches expectedAddress before signing.
 * The private key exists in memory for ~100ms then is zeroed.
 */
export async function signTransactionWithPRF(
  credentialId: string,
  xdr: string,
  network: 'testnet' | 'mainnet',
  expectedAddress: string,
): Promise<string> {
  const credIdBytes = fromBase64url(credentialId);

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rpId: getRpId(),
      allowCredentials: [{ id: credIdBytes.buffer.slice(credIdBytes.byteOffset, credIdBytes.byteOffset + credIdBytes.byteLength) as ArrayBuffer, type: 'public-key' as const }],
      userVerification: 'required',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (assertion.getClientExtensionResults() as any).prf;
  if (!prf?.results?.first) {
    throw new Error('PRF not available — cannot sign transaction');
  }

  const prfOutput = new Uint8Array(prf.results.first as ArrayBuffer);
  const seed = await hkdfDerive(prfOutput);

  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));

  if (keypair.publicKey() !== expectedAddress) {
    seed.fill(0);
    prfOutput.fill(0);
    throw new Error('Passkey does not match this wallet address');
  }

  const networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  tx.sign(keypair);
  const signedXdr = tx.toXDR();

  seed.fill(0);
  prfOutput.fill(0);

  return signedXdr;
}

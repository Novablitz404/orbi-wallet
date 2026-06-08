import { Keypair, TransactionBuilder, Networks } from '@stellar/stellar-base';

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
  gAddress: string;     // G... Stellar address
}

/**
 * Register a new PRF-based G wallet.
 * Creates a passkey with PRF extension, derives an Ed25519 seed via HKDF,
 * and returns the G address (public key). The private key never leaves memory.
 */
export async function registerPRFWallet(): Promise<PRFWalletCredential> {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prf = (credential.getClientExtensionResults() as any).prf;
  if (!prf?.results?.first) {
    throw new Error(
      'PRF not supported on this device. Use Safari on iOS 17+ / macOS Sonoma+, or Chrome 118+.',
    );
  }

  const prfOutput = new Uint8Array(prf.results.first as ArrayBuffer);
  const seed = await hkdfDerive(prfOutput);

  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(seed));
  const gAddress = keypair.publicKey();

  seed.fill(0);
  prfOutput.fill(0);

  return {
    credentialId: toBase64url(new Uint8Array(credential.rawId)),
    gAddress,
  };
}

/**
 * Sign in with PRF — derives the G address from the passkey.
 * Returns the G address. Caller should verify the address matches the stored wallet.
 */
export async function signInWithPRF(credentialId?: string): Promise<{ gAddress: string; credentialId: string }> {
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

  seed.fill(0);
  prfOutput.fill(0);

  return {
    gAddress,
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

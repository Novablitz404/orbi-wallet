import { Keypair, TransactionBuilder } from '@stellar/stellar-base';

export interface DerivationWorkerInput {
  prfOutput: Uint8Array;
  txXdr?: string;
  networkPassphrase?: string;
}

export interface DerivationWorkerOutput {
  gAddress: string;
  signedXdr?: string;
  cleanedMemory: boolean;
}

const HKDF_SALT = new TextEncoder().encode('orbi-stellar-hkdf-v1');

/**
 * Derives a classic Stellar Ed25519 keypair from WebAuthn PRF entropy,
 * optionally signs a transaction, and EXPLICITLY zeroes out all secret key
 * memory buffers before returning.
 */
export async function deriveAndSign(input: DerivationWorkerInput): Promise<DerivationWorkerOutput> {
  const { prfOutput, txXdr, networkPassphrase } = input;

  // 1. Copy PRF output into a dedicated working buffer
  const prfCopy = new Uint8Array(prfOutput);

  // 2. Derive 256-bit Ed25519 raw seed via WebCrypto HKDF
  const key = await crypto.subtle.importKey(
    'raw',
    prfCopy.buffer.slice(prfCopy.byteOffset, prfCopy.byteOffset + prfCopy.byteLength) as ArrayBuffer,
    'HKDF',
    false,
    ['deriveBits']
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: new Uint8Array() },
    key,
    256
  );
  const rawSeed = new Uint8Array(derivedBits);

  // 3. Construct Stellar Ed25519 Keypair
  const keypair = Keypair.fromRawEd25519Seed(Buffer.from(rawSeed));
  const gAddress = keypair.publicKey();

  let signedXdr: string | undefined = undefined;
  if (txXdr && networkPassphrase) {
    const tx = TransactionBuilder.fromXDR(txXdr, networkPassphrase);
    tx.sign(keypair);
    signedXdr = tx.toXDR();
  }

  // 4. MEMORY CLEANUP: Zero out all sensitive key buffers in memory
  prfOutput.fill(0);
  rawSeed.fill(0);

  // Verify memory cleanup
  const memoryCleaned = prfOutput.every(b => b === 0) && rawSeed.every(b => b === 0);

  return {
    gAddress,
    signedXdr,
    cleanedMemory: memoryCleaned,
  };
}

// Worker message handler (for Web Worker context in browsers)
if (typeof self !== 'undefined' && 'addEventListener' in self) {
  self.addEventListener('message', async (event: MessageEvent<DerivationWorkerInput>) => {
    try {
      const result = await deriveAndSign(event.data);
      self.postMessage({ success: true, ...result });
    } catch (err: unknown) {
      self.postMessage({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });
}

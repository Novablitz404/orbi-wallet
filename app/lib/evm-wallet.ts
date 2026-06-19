import { createWalletClient, createPublicClient, http, parseEther, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { botchain, type EvmNetwork } from './chains';

// Same PRF eval salt as the Stellar wallet, so the *same passkey* produces the
// same PRF output (lib/prf-wallet.ts uses 'orbi-stellar-v1'). The chain split
// happens at HKDF: a distinct salt derives an independent secp256k1 key, so the
// EVM 0x address is unrelated to the Stellar G address while still coming from
// one passkey tap.
const PRF_SALT = new TextEncoder().encode('orbi-stellar-v1');
const HKDF_SALT = new TextEncoder().encode('orbi-evm-hkdf-v1');

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

function toHex(buf: Uint8Array): Hex {
  return ('0x' + [...buf].map(b => b.toString(16).padStart(2, '0')).join('')) as Hex;
}

// Run a passkey assertion and return the raw PRF output. Caller is responsible
// for zeroing the returned buffer once the derived key has been consumed.
async function getPrfOutput(credentialId?: string): Promise<{ prfOutput: Uint8Array; credentialId: string }> {
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
  if (!prf?.results?.first) {
    throw new Error('PRF not available on this device/browser');
  }

  return {
    prfOutput: new Uint8Array(prf.results.first as ArrayBuffer),
    credentialId: toBase64url(new Uint8Array(assertion.rawId)),
  };
}

export interface EvmWalletCredential {
  credentialId: string; // base64url
  address: string;      // 0x… EVM address
}

/**
 * Derive the EVM 0x address directly from a raw PRF output. Pure (no passkey
 * prompt) so a single assertion can yield both the Stellar and EVM addresses —
 * the Stellar register/sign-in flows call this with the same PRF output they
 * already hold. Does not zero `prfOutput`; the caller owns that buffer.
 */
export async function deriveEvmAddressFromPrf(prfOutput: Uint8Array): Promise<string> {
  const seed = await hkdfDerive(prfOutput);
  const address = privateKeyToAccount(toHex(seed)).address;
  seed.fill(0);
  return address;
}

/**
 * Derive the EVM address for a passkey. Runs one passkey assertion, HKDFs the
 * PRF output into a secp256k1 key, and returns the 0x address. The private key
 * is zeroed immediately — only the public address leaves this function.
 */
export async function deriveEvmAddress(credentialId?: string): Promise<EvmWalletCredential> {
  const { prfOutput, credentialId: credId } = await getPrfOutput(credentialId);
  const address = await deriveEvmAddressFromPrf(prfOutput);
  prfOutput.fill(0);
  return { credentialId: credId, address };
}

/**
 * Sign and submit a native-BOT transfer on BotChain. Derives the secp256k1 key
 * from the passkey, verifies it matches expectedAddress, signs, and broadcasts
 * via JSON-RPC (no relayer). Returns the transaction hash.
 */
export async function sendEvmPayment(
  credentialId: string,
  network: EvmNetwork,
  to: string,
  amountEther: string,
  expectedAddress: string,
): Promise<Hex> {
  const { prfOutput } = await getPrfOutput(credentialId);
  const seed = await hkdfDerive(prfOutput);

  const account = privateKeyToAccount(toHex(seed));

  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    seed.fill(0);
    prfOutput.fill(0);
    throw new Error('Passkey does not match this wallet address');
  }

  const chain = botchain(network);
  const wallet = createWalletClient({ account, chain, transport: http() });

  const hash = await wallet.sendTransaction({
    to: to as Hex,
    value: parseEther(amountEther),
  });

  seed.fill(0);
  prfOutput.fill(0);

  return hash;
}

/** Read native BOT balance (in wei) for an address. */
export async function getEvmBalance(network: EvmNetwork, address: string): Promise<bigint> {
  const client = createPublicClient({ chain: botchain(network), transport: http() });
  return client.getBalance({ address: address as Hex });
}

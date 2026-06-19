import { createWalletClient, createPublicClient, http, type Hex, type LocalAccount, type TypedDataDefinition } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { getEvmChain } from './chains';

// Same PRF eval salt as the Stellar wallet, so the *same passkey* produces the
// same PRF output (lib/prf-wallet.ts uses 'orbi-stellar-v1'). The chain split
// happens at HKDF: a distinct salt derives an independent secp256k1 key, so the
// EVM 0x address is unrelated to the Stellar G address while still coming from
// one passkey tap. The resulting key is the same across every EVM chain.
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
 * Derive the secp256k1 account from the passkey, verify it matches
 * `expectedAddress`, hand it to `fn`, then zero the key material. Every signing
 * operation goes through here so the key lives in memory only for the call.
 */
async function withEvmAccount<T>(
  credentialId: string,
  expectedAddress: string,
  fn: (account: LocalAccount) => Promise<T>,
): Promise<T> {
  const { prfOutput } = await getPrfOutput(credentialId);
  const seed = await hkdfDerive(prfOutput);
  const account = privateKeyToAccount(toHex(seed));

  if (account.address.toLowerCase() !== expectedAddress.toLowerCase()) {
    seed.fill(0);
    prfOutput.fill(0);
    throw new Error('Passkey does not match this wallet address');
  }

  try {
    return await fn(account);
  } finally {
    seed.fill(0);
    prfOutput.fill(0);
  }
}

export interface EvmTxRequest {
  to: string;
  value?: string;  // wei, decimal string
  data?: string;   // 0x calldata for contract calls
  gas?: string;    // optional gas limit (decimal)
}

/**
 * Sign and submit any EVM transaction (native transfer OR contract call) on the
 * given chain, then return the tx hash. viem fills in nonce/gas/fees from the
 * RPC when omitted. Relay-free — broadcast straight to the chain's RPC.
 */
export async function sendEvmTransaction(
  credentialId: string,
  chainId: number,
  tx: EvmTxRequest,
  expectedAddress: string,
): Promise<Hex> {
  const chain = getEvmChain(chainId);
  return withEvmAccount(credentialId, expectedAddress, (account) => {
    const wallet = createWalletClient({ account, chain, transport: http() });
    return wallet.sendTransaction({
      to: tx.to as Hex,
      value: tx.value ? BigInt(tx.value) : undefined,
      data: tx.data ? (tx.data as Hex) : undefined,
      gas: tx.gas ? BigInt(tx.gas) : undefined,
    });
  });
}

/**
 * Sign an arbitrary message (EIP-191 / personal_sign). Used for dApp login
 * (SIWE). A 0x-prefixed message is treated as raw bytes (how personal_sign
 * delivers it over EIP-1193); anything else is signed as a UTF-8 string.
 */
export async function signEvmMessage(
  credentialId: string,
  message: string,
  expectedAddress: string,
): Promise<Hex> {
  const payload = /^0x[0-9a-fA-F]*$/.test(message) ? { raw: message as Hex } : message;
  return withEvmAccount(credentialId, expectedAddress, (account) =>
    account.signMessage({ message: payload }),
  );
}

/** Sign EIP-712 typed data (eth_signTypedData_v4). Used for permits, listings, etc. */
export async function signEvmTypedData(
  credentialId: string,
  typedData: TypedDataDefinition,
  expectedAddress: string,
): Promise<Hex> {
  return withEvmAccount(credentialId, expectedAddress, (account) =>
    account.signTypedData(typedData),
  );
}

/** Read native-token balance (in wei) for an address on the given chain. */
export async function getEvmBalance(chainId: number, address: string): Promise<bigint> {
  const client = createPublicClient({ chain: getEvmChain(chainId), transport: http() });
  return client.getBalance({ address: address as Hex });
}

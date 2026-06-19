import { defineChain, type Chain as ViemChain } from 'viem';

// ── EVM chain registry ──
//
// The passkey-derived secp256k1 address is identical on every EVM chain, so a
// chain is just an RPC + chainId + explorer. Adding support for a new EVM chain
// is a single entry here — nothing in the signing path is BotChain-specific.

const botchainTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.bohr.life'] } },
  blockExplorers: { default: { name: 'BOTScan', url: 'https://scan.bohr.life' } },
  testnet: true,
});

const botchainMainnet = defineChain({
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.botchain.ai'] } },
  blockExplorers: { default: { name: 'BOTScan', url: 'https://scan.botchain.ai' } },
  testnet: false,
});

/** All supported EVM chains, keyed by chainId. Add new chains here. */
export const EVM_CHAINS: Record<number, ViemChain> = {
  [botchainTestnet.id]: botchainTestnet,
  [botchainMainnet.id]: botchainMainnet,
};

export function getEvmChain(chainId: number): ViemChain {
  const chain = EVM_CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported EVM chain: ${chainId}`);
  return chain;
}

export function isSupportedEvmChain(chainId: number): boolean {
  return chainId in EVM_CHAINS;
}

export function listEvmChains(): ViemChain[] {
  return Object.values(EVM_CHAINS);
}

// The dashboard still exposes a single testnet/mainnet toggle. Until it offers
// a full chain picker, map that toggle to BotChain's two chain ids. New chains
// added above are reachable by chainId directly without touching this.
export type EvmNetwork = 'testnet' | 'mainnet';

export function defaultEvmChainId(network: EvmNetwork): number {
  return network === 'mainnet' ? botchainMainnet.id : botchainTestnet.id;
}

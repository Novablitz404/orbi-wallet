import { defineChain } from 'viem';

// ── BotChain (BOT Chain) — EVM, Geth/PoSA, https://dev-docs.botchain.ai ──
//
// Native token BOT. Standard secp256k1 EOAs (0x… addresses). EVM-compatible,
// so viem/ethers/web3 all work against the JSON-RPC endpoints below.

export const botchainTestnet = defineChain({
  id: 968,
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.bohr.life'] },
  },
  blockExplorers: {
    default: { name: 'BOTScan', url: 'https://scan.bohr.life' },
  },
  testnet: true,
});

export const botchainMainnet = defineChain({
  id: 677,
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.botchain.ai'] },
  },
  blockExplorers: {
    default: { name: 'BOTScan', url: 'https://scan.botchain.ai' },
  },
  testnet: false,
});

export type EvmNetwork = 'testnet' | 'mainnet';

export function botchain(network: EvmNetwork) {
  return network === 'mainnet' ? botchainMainnet : botchainTestnet;
}

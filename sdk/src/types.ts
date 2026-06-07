export type OrbiNetwork = 'testnet' | 'mainnet';

export interface OrbiClientConfig {
  /** Stellar network the dApp is operating on. Defaults to 'testnet'. */
  network?: OrbiNetwork;
}

export interface ConnectedWallet {
  walletAddress: string;
  credentialId: string;
  passkeyId: string;
}

export interface SignResult {
  signedXdr: string;
  walletAddress: string;
}

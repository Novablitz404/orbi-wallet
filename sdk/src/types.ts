export type OrbiNetwork = 'testnet' | 'mainnet';

export interface OrbiClientConfig {
  /** Orbi relay API URL — https://api.orbiwallet.xyz */
  apiUrl: string;
  network?: OrbiNetwork;
}

export interface QuoteResult {
  quoteId: string;
  feeStroops: number;
  feeXlm: string;
  expiresAtLedger: number;
  currentLedger: number;
  nativeSacId: string;
  feeCollectorAddress: string;
  authEntryXdr: string;
}

export interface BundleResult {
  opId: string;
}

export interface OpStatus {
  opId: string;
  status: 'pending' | 'batched' | 'confirmed' | 'failed';
  txHash: string | null;
  error: string | null;
}

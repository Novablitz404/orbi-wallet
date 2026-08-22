export type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

export interface Token {
  id: string;
  name: string;
  symbol: string;
  icon: string;
  price: number;
  change24h: number;
  holdingAmount: number;
  holdingValue: number;
  sparkline: number[]; // 7-day trend values
  marketCap: string;
  volume24h: string;
  ath: number;
  assetCode: string;
  issuer: string;
  color: string; // Theme color for progress bars & tags
  isWatchlist?: boolean;
}

export interface PortfolioPoint {
  time: string;
  value: number;
}

export type PortfolioHistory = Record<Timeframe, PortfolioPoint[]>;

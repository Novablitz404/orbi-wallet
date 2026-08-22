'use client';

import { useState } from 'react';
import PortfolioCard from './PortfolioCard';
import PortfolioChart from './PortfolioChart';
import AssetAllocation from './AssetAllocation';
import TokenList from './TokenList';
import QuickSwapModal from './QuickSwapModal';
import { Token } from './types';
import { MOCK_TOKENS } from './mockData';

export default function CryptoDashboard() {
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapToken, setSwapToken] = useState<Token | undefined>(undefined);

  function handleSwapTokenSelect(token: Token) {
    setSwapToken(token);
    setSwapModalOpen(true);
  }

  return (
    <div className="flex flex-col gap-6 font-display">
      {/* Portfolio Header & Allocation Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-6">
          <PortfolioCard />
        </div>
        <div className="lg:col-span-6">
          <AssetAllocation tokens={MOCK_TOKENS} />
        </div>
      </div>

      {/* Interactive Growth Chart */}
      <PortfolioChart />

      {/* Token List */}
      <TokenList tokens={MOCK_TOKENS} onSwapToken={handleSwapTokenSelect} />

      {/* Swap Modal */}
      <QuickSwapModal
        isOpen={swapModalOpen}
        onClose={() => setSwapModalOpen(false)}
        initialFromToken={swapToken}
      />
    </div>
  );
}

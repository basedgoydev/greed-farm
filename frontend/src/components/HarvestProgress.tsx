'use client';

import { FC } from 'react';
import { GameStatus } from '@/lib/api';

interface HarvestProgressProps {
  harvest: GameStatus['harvest'] | null;
  quorumPercentage: number;
}

export const HarvestProgress: FC<HarvestProgressProps> = ({
  harvest,
  quorumPercentage,
}) => {
  const percentage = harvest?.percentage || 0;
  const isQuorumReached = percentage >= 100;

  const formatTokens = (amount: string): string => {
    const decimals = parseInt(process.env.NEXT_PUBLIC_TOKEN_DECIMALS || '6');
    const value = Number(amount) / 10 ** decimals;
    if (value >= 1_000_000) {
      return (value / 1_000_000).toFixed(1) + 'M';
    }
    if (value >= 1_000) {
      return (value / 1_000).toFixed(1) + 'K';
    }
    return value.toFixed(0);
  };

  return (
    <div className="relative overflow-hidden card-greed p-4">
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs uppercase tracking-wider text-[#8899bb] font-medium">Harvest Progress</span>
          {isQuorumReached ? (
            <span className="flex items-center gap-1 tag tag-green text-[10px] py-0.5 px-2">
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              Quorum
            </span>
          ) : (
            <span className="text-[10px] text-[#556688]">Need {quorumPercentage}%</span>
          )}
        </div>

        {/* Progress bar */}
        <div className="relative h-3 progress-bar-bg border border-greed-border rounded-full mb-3">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${
              isQuorumReached ? 'progress-bar-fill' : 'progress-bar-fill-gold'
            }`}
            style={{ width: `${Math.min(100, percentage)}%` }}
          />
        </div>

        {/* Stats row */}
        <div className="flex justify-between items-center">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-[#556688]">Eligible</p>
            <p className="text-sm font-bold text-white font-mono">
              {formatTokens(harvest?.currentEligible || '0')}
            </p>
          </div>
          <div className="text-center">
            <p className={`text-2xl font-bold font-mono ${
              isQuorumReached ? 'text-greed-green' : 'text-greed-gold'
            }`}>
              {percentage.toFixed(0)}%
            </p>
          </div>
          <div className="text-right">
            <p className="text-[9px] uppercase tracking-wider text-[#556688]">Required</p>
            <p className="text-sm font-bold text-white font-mono">
              {quorumPercentage}%
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
